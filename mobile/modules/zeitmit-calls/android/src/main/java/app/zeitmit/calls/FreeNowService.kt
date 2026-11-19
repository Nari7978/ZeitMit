package app.zeitmit.calls

import android.app.AlarmManager
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.text.format.DateFormat
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.util.Date

/**
 * Free now with the app closed, like being online in a ride app: an ongoing "Free now for video dates until 23:30"
 * notification (with Turn off) keeps the phone reachable and checks in with ZeitMit about every 2 minutes, even while
 * the phone sleeps. It stops at the end time, when turned off (here or in the app), or after missed requests.
 */
class FreeNowService : Service() {
  companion object {
    private const val ID = 0x3101
    private const val EVERY_MS = 2 * 60 * 1000L

    fun start(ctx: Context, until: Long) {
      Store.setFreeNowUntil(ctx, until)
      if (until <= IncomingCalls.now()) return stop(ctx)
      try {
        ContextCompat.startForegroundService(ctx, Intent(ctx, FreeNowService::class.java))
      } catch (e: Exception) {
        Log.w(TAG, "Couldn't keep Free now on in the background", e)
      }
    }

    fun stop(ctx: Context) {
      Store.setFreeNowUntil(ctx, 0L)
      try {
        ctx.getSystemService(AlarmManager::class.java)?.cancel(checkInIntent(ctx))
        ctx.stopService(Intent(ctx, FreeNowService::class.java))
      } catch (e: Exception) {
        Log.w(TAG, "Couldn't stop Free now", e)
      }
    }

    private fun checkInIntent(ctx: Context): PendingIntent = PendingIntent.getBroadcast(
      ctx, 0x3102, Intent(ctx, ActionReceiver::class.java).setAction(ActionReceiver.CHECK_IN), IncomingCalls.PI_FLAGS,
    )

    /** The next check-in in about 2 minutes, even while the phone sleeps (the system may bundle it with others). */
    private fun scheduleNext(ctx: Context) {
      try {
        ctx.getSystemService(AlarmManager::class.java)
          ?.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + EVERY_MS, checkInIntent(ctx))
      } catch (e: Exception) {
        Log.w(TAG, "Couldn't plan the next check-in", e)
      }
    }

    /** Tells ZeitMit this phone can still ring. Stops when Free now is over or was switched off elsewhere. */
    fun checkIn(ctx: Context, done: (() -> Unit)? = null) {
      val app = ctx.applicationContext
      val until = Store.freeNowUntil(app)
      if (until <= IncomingCalls.now()) {
        stop(app)
        done?.invoke()
        return
      }
      Http.inBackground(app, "POST", "/companion/free-now/seen", "{\"bg\":true}") { code, text ->
        try {
          when {
            code in 200..299 -> {
              val json = try { JSONObject(text ?: "{}") } catch (e: Exception) { JSONObject() }
              val on = if (json.isNull("until")) 0L else json.optLong("until", 0L)
              if (on <= IncomingCalls.now()) {
                stop(app)
                JsEvents.emit("onAction", mapOf("type" to "freeNowOff"))
              } else {
                Store.setFreeNowUntil(app, on)
                scheduleNext(app)
              }
            }
            code == 401 || code == 403 || code == 404 -> stop(app)
            else -> scheduleNext(app) // no connection right now: try again
          }
        } finally {
          done?.invoke()
        }
      }
    }
  }

  private val handler = Handler(Looper.getMainLooper())

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val until = Store.freeNowUntil(this)
    if (until <= IncomingCalls.now()) {
      stopSelf()
      return START_NOT_STICKY
    }
    Channels.ensure(this)
    try {
      val n = notification(until)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        ServiceCompat.startForeground(this, ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
      } else {
        startForeground(ID, n)
      }
    } catch (e: Exception) {
      Log.w(TAG, "Couldn't show Free now", e)
      stopSelf()
      return START_NOT_STICKY
    }
    checkIn(this)
    handler.removeCallbacksAndMessages(null)
    handler.postDelayed({ stop(this) }, (until - IncomingCalls.now()) * 1000L)
    return START_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacksAndMessages(null)
    super.onDestroy()
  }

  private fun notification(until: Long): Notification {
    val back = (packageManager.getLaunchIntentForPackage(packageName) ?: Intent())
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val open = PendingIntent.getActivity(this, 0x3103, back, IncomingCalls.PI_FLAGS)
    val off = PendingIntent.getBroadcast(this, 0x3104, Intent(this, ActionReceiver::class.java).setAction(ActionReceiver.FREE_NOW_OFF), IncomingCalls.PI_FLAGS)
    val time = DateFormat.getTimeFormat(this).format(Date(until * 1000L))
    return NotificationCompat.Builder(this, Channels.FREE_NOW)
      .setSmallIcon(R.drawable.zeitmit_call_small)
      .setContentTitle(Texts.get(this, "freeNowTitle"))
      .setContentText(Texts.get(this, "freeNowBody", "time" to time))
      .setOngoing(true)
      .setSilent(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(open)
      .setColor(Channels.PINK)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .addAction(0, Texts.get(this, "turnOff"), off)
      .build()
  }
}
