package app.zeitmit.calls

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Buttons on the notifications: Decline / Not now, Hang up, Turn off (Free now), and the Free now check-in alarm. */
class ActionReceiver : BroadcastReceiver() {
  companion object {
    const val DECLINE = "app.zeitmit.calls.DECLINE"
    const val HANG_UP = "app.zeitmit.calls.HANG_UP"
    const val FREE_NOW_OFF = "app.zeitmit.calls.FREE_NOW_OFF"
    const val CHECK_IN = "app.zeitmit.calls.CHECK_IN"
  }

  override fun onReceive(ctx: Context, intent: Intent) {
    when (intent.action) {
      DECLINE -> {
        val id = intent.getStringExtra("bookingId") ?: return
        val kind = intent.getStringExtra("kind") ?: ""
        IncomingCalls.cancel(ctx, id)
        if (!CallService.running) Lock.clear(Pip.activity())
        JsEvents.emit("onAction", mapOf("type" to "decline", "bookingId" to id, "kind" to kind))
        // A free-now request is declined right here, without opening the app (a ring is just left).
        if (kind == "instant") {
          val pending = goAsync()
          Http.inBackground(ctx, "POST", "/companion/bookings/$id/decline", "{}") { _, _ -> pending.finish() }
        }
      }
      HANG_UP -> {
        JsEvents.emit("onAction", mapOf("type" to "hangUp", "bookingId" to (intent.getStringExtra("bookingId") ?: "")))
        CallService.stop(ctx)
      }
      FREE_NOW_OFF -> {
        FreeNowService.stop(ctx)
        JsEvents.emit("onAction", mapOf("type" to "freeNowOff"))
        val pending = goAsync()
        Http.inBackground(ctx, "DELETE", "/companion/free-now") { _, _ -> pending.finish() }
      }
      CHECK_IN -> {
        val pending = goAsync()
        FreeNowService.checkIn(ctx) { pending.finish() }
      }
    }
  }
}
