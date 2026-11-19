package app.zeitmit.calls

import android.annotation.SuppressLint
import android.app.Activity
import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import org.json.JSONObject

/**
 * An incoming video date while the app isn't on screen: a free-now request ("instant") or the other person waiting in
 * the call ("ring"). It rings like a phone call until it's answered or runs out: full screen over the lock screen, a
 * call notification with Accept / Decline while the phone is in use, and the app itself on top of other apps when
 * "Display over other apps" is allowed (like a ride request).
 */
internal object IncomingCalls {
  const val EXTRA_ACTION = "zeitmit.call.action"
  const val EXTRA_CALL = "zeitmit.call.data"
  const val PI_FLAGS = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
  private const val NOTIF_TAG = "zeitmit_incoming"
  /** A ring shows this long (seconds), like the app's own ring. */
  private const val RING_S = 30L

  fun now() = System.currentTimeMillis() / 1000

  fun notifId(bookingId: String) = "incoming:$bookingId".hashCode()

  /** The app is on screen (or in its floating window): it shows incoming video dates itself, and rings. */
  fun appVisible(): Boolean = try {
    ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
  } catch (e: Exception) {
    false
  }

  /** A push. True when it was one of ours: an incoming video date shown (or too late to), or a ringing one called off. */
  fun onPush(ctx: Context, data: Map<String, String>): Boolean {
    val body = data["body"]?.let { try { JSONObject(it) } catch (e: Exception) { null } } ?: return false
    when (body.optString("kind")) {
      "call-off" -> {
        val id = body.optString("bookingId")
        if (id.isNotEmpty()) {
          cancel(ctx, id)
          JsEvents.emit("onAction", mapOf("type" to "callOff", "bookingId" to id))
        }
        return true
      }
      "instant", "ring" -> Unit
      else -> return false
    }
    if (appVisible()) return false
    val until = untilOf(body)
    if (until <= now()) return true
    show(ctx, body, until)
    return true
  }

  private fun untilOf(body: JSONObject): Long =
    if (body.optString("kind") == "instant") body.optLong("expiresAt", now() + 120)
    else {
      val at = body.optLong("at", now())
      minOf(at + RING_S, body.optLong("endsAt", at + RING_S))
    }

  @SuppressLint("MissingPermission")
  private fun show(ctx: Context, body: JSONObject, until: Long) {
    Channels.ensure(ctx)
    val kind = body.optString("kind")
    val id = body.optString("bookingId")
    val who = body.optString("who").ifEmpty { "ZeitMit" }
    val n = notifId(id)
    val open = PendingIntent.getActivity(ctx, n, launch(ctx, body, "open"), PI_FLAGS)
    val answer = PendingIntent.getActivity(ctx, n + 1, launch(ctx, body, "accept"), PI_FLAGS)
    val decline = PendingIntent.getBroadcast(
      ctx, n + 2,
      Intent(ctx, ActionReceiver::class.java).setAction(ActionReceiver.DECLINE).putExtra("bookingId", id).putExtra("kind", kind),
      PI_FLAGS,
    )
    val instant = kind == "instant"
    val title = if (instant) Texts.get(ctx, "instantTitle", "who" to who)
      else Texts.get(ctx, if (body.optString("why") == "ping") "ringPingTitle" else "ringJoinTitle", "who" to who)
    val text = if (instant) {
      Texts.get(ctx, "instantBody", "length" to Texts.length(ctx, body.optInt("minutes", 30)), "earn" to Texts.euros(body.optLong("earn", 0L)))
    } else Texts.get(ctx, "ringBody")
    val b = NotificationCompat.Builder(ctx, Channels.INCOMING)
      .setSmallIcon(R.drawable.zeitmit_call_small)
      .setContentTitle(title)
      .setContentText(text)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setAutoCancel(false)
      .setContentIntent(open)
      .setFullScreenIntent(open, true)
      .setTimeoutAfter(maxOf(1L, until - now()) * 1000L)
      .setSound(Channels.ringUri(ctx), AudioManager.STREAM_RING)
      .setVibrate(Channels.BUZZ)
      .setColor(Channels.PINK)
    if (fullScreenAllowed(ctx)) {
      // The phone's own incoming-call look (Android 12+): Decline and a video Answer button.
      val person = Person.Builder().setName(who).setImportant(true).build()
      b.setStyle(NotificationCompat.CallStyle.forIncomingCall(person, decline, answer).setIsVideo(true))
    } else {
      b.addAction(0, Texts.get(ctx, if (instant) "decline" else "notNow"), decline)
      b.addAction(0, Texts.get(ctx, if (instant) "accept" else "join"), answer)
    }
    val notification = b.build()
    notification.flags = notification.flags or Notification.FLAG_INSISTENT
    try {
      NotificationManagerCompat.from(ctx).notify(NOTIF_TAG, n, notification)
    } catch (e: Exception) {
      Log.w(TAG, "Couldn't show the incoming video date", e)
    }
    // In use and allowed over other apps: the app opens on top, like a ride request. (Locked: the full-screen intent.)
    if (canDrawOverlays(ctx) && screenUnlocked(ctx)) {
      try {
        ctx.startActivity(launch(ctx, body, "open"))
      } catch (e: Exception) {
        Log.w(TAG, "Couldn't open over other apps", e)
      }
    }
  }

  fun cancel(ctx: Context, bookingId: String) {
    try {
      NotificationManagerCompat.from(ctx).cancel(NOTIF_TAG, notifId(bookingId))
    } catch (e: Exception) {
      Log.w(TAG, "Couldn't stop the ringing", e)
    }
  }

  private fun launch(ctx: Context, body: JSONObject, action: String): Intent {
    val i = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: Intent()
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    i.putExtra(EXTRA_ACTION, action)
    i.putExtra(EXTRA_CALL, body.toString())
    return i
  }

  /** The app was opened for an incoming video date: over the lock screen, and the app picks it up (takeAction). */
  fun fromIntent(activity: Activity, intent: Intent?) {
    if (intent == null) return
    val action = intent.getStringExtra(EXTRA_ACTION) ?: return
    val data = intent.getStringExtra(EXTRA_CALL) ?: return
    intent.removeExtra(EXTRA_ACTION)
    intent.removeExtra(EXTRA_CALL)
    val body = try { JSONObject(data) } catch (e: Exception) { return }
    Lock.show(activity)
    body.put("action", action)
    Store.setPending(activity, body.toString())
    if (action == "accept") cancel(activity, body.optString("bookingId"))
    JsEvents.emit("onAction", mapOf("type" to "launch"))
  }

  fun canDrawOverlays(ctx: Context): Boolean = Settings.canDrawOverlays(ctx)

  fun fullScreenAllowed(ctx: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
      ctx.getSystemService(NotificationManager::class.java)?.canUseFullScreenIntent() == true

  private fun screenUnlocked(ctx: Context): Boolean {
    val pm = ctx.getSystemService(PowerManager::class.java)
    val km = ctx.getSystemService(KeyguardManager::class.java)
    return pm?.isInteractive == true && km?.isKeyguardLocked != true
  }
}
