package app.zeitmit.calls

import android.app.Activity
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.os.Build
import android.util.Log
import android.util.Rational
import androidx.annotation.RequiresApi
import androidx.core.app.OnPictureInPictureModeChangedProvider
import androidx.core.app.PictureInPictureModeChangedInfo
import androidx.core.util.Consumer
import java.lang.ref.WeakReference

/**
 * The floating window: during a video date, leaving the app shrinks the call into a small window over the home screen
 * and other apps (Android 12+ by itself, 8–11 on leaving), with a Hang up button. Tapping it brings the call back.
 */
internal object Pip {
  @Volatile var inPip = false
    private set
  @Volatile private var wanted = false
  private var ref: WeakReference<Activity>? = null

  fun activity(): Activity? = ref?.get()

  private val listener = Consumer<PictureInPictureModeChangedInfo> { info -> changed(info.isInPictureInPictureMode) }

  fun attach(a: Activity) {
    ref = WeakReference(a)
    (a as? OnPictureInPictureModeChangedProvider)?.addOnPictureInPictureModeChangedListener(listener)
    apply(a)
  }

  fun detach(a: Activity) {
    (a as? OnPictureInPictureModeChangedProvider)?.removeOnPictureInPictureModeChangedListener(listener)
    if (ref?.get() === a) ref = null
  }

  fun changed(v: Boolean) {
    if (inPip == v) return
    inPip = v
    JsEvents.emit("onPip", mapOf("inPip" to v))
  }

  /** A video date started (true) or ended. */
  fun enable(on: Boolean) {
    wanted = on
    activity()?.let { a -> a.runOnUiThread { apply(a) } }
  }

  private fun supported(a: Activity) =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && a.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

  @RequiresApi(Build.VERSION_CODES.O)
  private fun params(a: Activity): PictureInPictureParams {
    val hangUp = PendingIntent.getBroadcast(
      a, 0x2102, Intent(a, ActionReceiver::class.java).setAction(ActionReceiver.HANG_UP), IncomingCalls.PI_FLAGS,
    )
    val label = Texts.get(a, "hangUp")
    val b = PictureInPictureParams.Builder()
      .setAspectRatio(Rational(9, 16))
      .setActions(listOf(RemoteAction(Icon.createWithResource(a, R.drawable.zeitmit_hang_up), label, label, hangUp)))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      b.setAutoEnterEnabled(wanted)
      b.setSeamlessResizeEnabled(true)
    }
    return b.build()
  }

  private fun apply(a: Activity) {
    if (!supported(a)) return
    try {
      a.setPictureInPictureParams(params(a))
    } catch (e: Exception) {
      Log.w(TAG, "Floating window settings", e)
    }
  }

  /** Android 8–11: leaving the app during a video date opens the floating window (12+ does it by itself). */
  fun onUserLeaveHint(a: Activity) {
    if (!wanted || !supported(a) || Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return
    try {
      a.enterPictureInPictureMode(params(a))
    } catch (e: Exception) {
      Log.w(TAG, "Floating window", e)
    }
  }
}
