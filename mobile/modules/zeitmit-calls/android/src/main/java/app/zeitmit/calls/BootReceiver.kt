package app.zeitmit.calls

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** The phone restarted or the app was updated (both clear the alarms): Free now, if still on, carries on checking in. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    Channels.ensure(ctx) // after an update from 1.3.10 or older: the old Free now notification channel goes
    if (Store.freeNowUntil(ctx) <= IncomingCalls.now()) return
    val pending = goAsync()
    FreeNow.checkIn(ctx) { pending.finish() }
  }
}
