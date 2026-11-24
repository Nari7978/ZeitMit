package app.zeitmit.calls

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.util.Log
import org.json.JSONObject

/**
 * Free now with the app closed, without a notification: ZeitMit checks in about every 2 minutes from an alarm that
 * also fires while the phone sleeps (less often in deep sleep; the server counts these check-ins for 30 minutes), so
 * the companion stays listed. Requests ring by push (CallMessagingService) whether or not the app is running. It stops
 * at the end time, when switched off in the app, or when ZeitMit says it's off (missed requests, switched off by
 * support). After the phone restarts or the app is updated it carries on (BootReceiver). Phones that limit apps in
 * the background can delay or stop the check-ins: the app asks to allow it (no battery limits, Autostart).
 */
internal object FreeNow {
  private const val EVERY_MS = 2 * 60 * 1000L

  fun start(ctx: Context, until: Long) {
    Channels.ensure(ctx) // (also removes the old Free now notification channel)
    Store.setFreeNowUntil(ctx, until)
    if (until <= IncomingCalls.now()) return stop(ctx)
    checkIn(ctx)
  }

  fun stop(ctx: Context) {
    Store.setFreeNowUntil(ctx, 0L)
    try {
      ctx.getSystemService(AlarmManager::class.java)?.cancel(checkInIntent(ctx))
    } catch (e: Exception) {
      Log.w(TAG, "Couldn't stop the Free now check-ins", e)
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

  /** Tells ZeitMit this phone can still ring, and plans the next check-in. Stops when Free now is over or off. */
  fun checkIn(ctx: Context, done: (() -> Unit)? = null) {
    val app = ctx.applicationContext
    if (Store.freeNowUntil(app) <= IncomingCalls.now()) {
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
