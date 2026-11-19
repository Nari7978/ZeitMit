package app.zeitmit.calls

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

/** Hooks into the app's activity: the floating window, and opening for an incoming video date. */
class ZeitmitCallsPackage : Package {
  override fun createReactActivityLifecycleListeners(activityContext: Context): List<ReactActivityLifecycleListener> =
    listOf(CallsLifecycle())
}

internal class CallsLifecycle : ReactActivityLifecycleListener {
  private val main = Handler(Looper.getMainLooper())

  override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
    Pip.attach(activity)
    IncomingCalls.fromIntent(activity, activity.intent)
  }

  override fun onResume(activity: Activity) {
    Pip.changed(activity.isInPictureInPictureMode)
  }

  override fun onPause(activity: Activity) {
    // In case the activity doesn't report it: the floating window shows a moment after pausing.
    main.postDelayed({ Pip.changed(activity.isInPictureInPictureMode) }, 600)
  }

  override fun onUserLeaveHint(activity: Activity) {
    Pip.onUserLeaveHint(activity)
  }

  override fun onNewIntent(intent: Intent?): Boolean {
    Pip.activity()?.let { IncomingCalls.fromIntent(it, intent) }
    return false
  }

  override fun onDestroy(activity: Activity) {
    Pip.detach(activity)
  }
}
