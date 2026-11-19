package app.zeitmit.calls

import android.app.Activity
import android.os.Build
import android.view.WindowManager

/**
 * Over the lock screen: while an incoming video date rings (opened from its notification) and during a video date,
 * like a phone call. Off again afterwards, so the rest of the app needs the phone unlocked.
 */
internal object Lock {
  @Suppress("DEPRECATION")
  fun show(a: Activity) {
    a.runOnUiThread {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
        a.setShowWhenLocked(true)
        a.setTurnScreenOn(true)
      } else {
        a.window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
      }
    }
  }

  @Suppress("DEPRECATION")
  fun clear(a: Activity?) {
    if (a == null) return
    a.runOnUiThread {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
        a.setShowWhenLocked(false)
        a.setTurnScreenOn(false)
      } else {
        a.window.clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
      }
    }
  }
}
