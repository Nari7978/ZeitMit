package app.zeitmit.calls

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Keeps a video date running while the app is in the background or the screen is locked (camera and microphone), with
 * an ongoing "Video date with Mia" notification: tap it to go back, or Hang up.
 */
class CallService : Service() {
  companion object {
    private const val ID = 0x2101
    @Volatile var running = false
      private set

    fun start(ctx: Context, bookingId: String, who: String): Boolean = try {
      ContextCompat.startForegroundService(ctx, Intent(ctx, CallService::class.java).putExtra("bookingId", bookingId).putExtra("who", who))
      true
    } catch (e: Exception) {
      Log.w(TAG, "Couldn't keep the video date running", e)
      false
    }

    fun stop(ctx: Context) {
      try {
        ctx.stopService(Intent(ctx, CallService::class.java))
      } catch (e: Exception) {
        Log.w(TAG, "Couldn't stop the video date service", e)
      }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val bookingId = intent?.getStringExtra("bookingId") ?: ""
    val who = intent?.getStringExtra("who") ?: ""
    Channels.ensure(this)
    try {
      val n = notification(bookingId, who)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        ServiceCompat.startForeground(this, ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
      } else {
        startForeground(ID, n)
      }
      running = true
    } catch (e: Exception) {
      Log.w(TAG, "Couldn't start the video date service", e)
      stopSelf()
    }
    return START_NOT_STICKY
  }

  /** The app was swiped away: the call went with it. */
  override fun onTaskRemoved(rootIntent: Intent?) {
    stopSelf()
  }

  override fun onDestroy() {
    running = false
    super.onDestroy()
  }

  private fun notification(bookingId: String, who: String): Notification {
    val back = (packageManager.getLaunchIntentForPackage(packageName) ?: Intent())
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val open = PendingIntent.getActivity(this, 0x2103, back, IncomingCalls.PI_FLAGS)
    val hangUp = PendingIntent.getBroadcast(
      this, 0x2104, Intent(this, ActionReceiver::class.java).setAction(ActionReceiver.HANG_UP).putExtra("bookingId", bookingId), IncomingCalls.PI_FLAGS,
    )
    val name = who.ifEmpty { "ZeitMit" }
    return NotificationCompat.Builder(this, Channels.ONGOING)
      .setSmallIcon(R.drawable.zeitmit_call_small)
      .setContentTitle(Texts.get(this, "ongoingTitle", "who" to name))
      .setContentText(Texts.get(this, "ongoingBody"))
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setOngoing(true)
      .setSilent(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(open)
      .setColor(Channels.PINK)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setStyle(NotificationCompat.CallStyle.forOngoingCall(Person.Builder().setName(name).build(), hangUp).setIsVideo(true))
      .build()
  }
}
