package app.zeitmit.calls

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

/** Events for the app while it runs (from notifications, the floating window and pushes). */
internal object JsEvents {
  @Volatile var module: WeakReference<ZeitmitCallsModule>? = null

  fun emit(name: String, body: Map<String, Any?>) {
    try {
      module?.get()?.send(name, body)
    } catch (e: Throwable) {
      Log.w(TAG, "Event $name", e)
    }
  }
}

/**
 * ZeitMit's video dates on Android: keeping a call running in the background with its floating window, incoming video
 * dates ringing full screen like phone calls, and Free now staying online with the app closed.
 */
class ZeitmitCallsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  internal fun send(name: String, body: Map<String, Any?>) {
    sendEvent(name, body)
  }

  override fun definition() = ModuleDefinition {
    Name("ZeitmitCalls")

    Events("onAction", "onPip")

    OnCreate {
      JsEvents.module = WeakReference(this@ZeitmitCallsModule)
      try {
        Channels.ensure(context)
      } catch (e: Exception) {
        Log.w(TAG, "Channels", e)
      }
    }

    OnDestroy {
      if (JsEvents.module?.get() === this@ZeitmitCallsModule) JsEvents.module = null
    }

    /** The API and the session, to answer from notifications without opening the app (null: signed out). */
    Function("configure") { api: String, token: String? ->
      Store.setSession(context, api, token)
    }

    /** The notification texts in the app's language (JSON). */
    Function("setTexts") { json: String ->
      Store.setTexts(context, json)
      Channels.rename(context)
    }

    /** A video date is on: it keeps running in the background, leaving the app opens the floating window. */
    Function("startCall") { bookingId: String, who: String ->
      Pip.enable(true)
      Pip.activity()?.let { Lock.show(it) }
      CallService.start(context, bookingId, who)
    }

    Function("stopCall") {
      Pip.enable(false)
      CallService.stop(context)
      Lock.clear(Pip.activity())
    }

    Function("isInPip") {
      Pip.inPip
    }

    Function("startFreeNow") { until: Double ->
      FreeNow.start(context, until.toLong())
    }

    Function("stopFreeNow") {
      FreeNow.stop(context)
    }

    /** The app shows this incoming video date itself now: the phone's ringing stops. */
    Function("endIncoming") { bookingId: String ->
      IncomingCalls.cancel(context, bookingId)
    }

    /** Over the lock screen or not (an incoming video date that was declined or ran out: not any more). */
    Function("lockScreen") { on: Boolean ->
      val a = Pip.activity()
      if (a != null) {
        if (on) Lock.show(a) else if (!CallService.running) Lock.clear(a)
      }
    }

    /** The incoming video date the app was opened for (JSON with `action`: open or accept), once. */
    Function("takeAction") {
      Store.takePending(context)
    }

    /** What this phone allows, for the "Make sure requests reach you" list. */
    Function("access") {
      val pm = context.getSystemService(PowerManager::class.java)
      mapOf(
        "overlay" to IncomingCalls.canDrawOverlays(context),
        "fullScreen" to IncomingCalls.fullScreenAllowed(context),
        "battery" to (pm?.isIgnoringBatteryOptimizations(context.packageName) ?: true),
        "pip" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && context.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)),
        "brand" to Build.MANUFACTURER.lowercase(),
      )
    }

    /** The phone's settings page for one of them: overlay, fullScreen, battery, or the app's page. */
    Function("openSettings") { which: String ->
      openSettings(context, which)
    }

    /** A timer that also runs while the app is in the background (the call reconnects with it). */
    AsyncFunction("delay") { ms: Int, promise: Promise ->
      Handler(Looper.getMainLooper()).postDelayed({ promise.resolve() }, ms.toLong())
    }
  }

  private fun openSettings(ctx: Context, which: String) {
    val pkg = Uri.parse("package:${ctx.packageName}")
    val intent = when (which) {
      "overlay" -> Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, pkg)
      "fullScreen" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, pkg) else null
      "battery" -> Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg)
      else -> null
    } ?: Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg)
    try {
      ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (e: Exception) {
      try {
        ctx.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      } catch (e2: Exception) {
        Log.w(TAG, "No settings page", e2)
      }
    }
  }
}
