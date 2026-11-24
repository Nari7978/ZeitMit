package app.zeitmit.calls

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ContentResolver
import android.content.Context
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build

/** The notification channels: incoming video dates ring (the phone's ring volume), the ongoing call is silent. */
internal object Channels {
  const val INCOMING = "zeitmit_incoming_v1"
  const val ONGOING = "zeitmit_ongoing_v1"
  /** Free now's ongoing notification until 1.3.10 (Free now shows none since): removed from the phone's settings. */
  private const val OLD_FREE_NOW = "zeitmit_free_now_v1"
  /** Buzz, buzz, pause, like the app's own ring. */
  val BUZZ = longArrayOf(0, 500, 300, 500, 1200)
  const val PINK = 0xFFFF4F8B.toInt()

  fun ringUri(ctx: Context): Uri =
    Uri.parse("${ContentResolver.SCHEME_ANDROID_RESOURCE}://${ctx.packageName}/${R.raw.zeitmit_ring}")

  fun ensure(ctx: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
    if (nm.getNotificationChannel(INCOMING) == null) {
      val ch = NotificationChannel(INCOMING, Texts.get(ctx, "channelIncoming"), NotificationManager.IMPORTANCE_HIGH)
      ch.setSound(
        ringUri(ctx),
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build(),
      )
      ch.enableVibration(true)
      ch.vibrationPattern = BUZZ
      ch.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      ch.setShowBadge(false)
      nm.createNotificationChannel(ch)
    }
    if (nm.getNotificationChannel(ONGOING) == null) {
      val ch = NotificationChannel(ONGOING, Texts.get(ctx, "channelOngoing"), NotificationManager.IMPORTANCE_LOW)
      ch.setSound(null, null)
      ch.setShowBadge(false)
      ch.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      nm.createNotificationChannel(ch)
    }
    if (nm.getNotificationChannel(OLD_FREE_NOW) != null) nm.deleteNotificationChannel(OLD_FREE_NOW)
  }

  /** The app's language changed: the channel names follow (their sound and importance stay). */
  fun rename(ctx: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
    for ((id, key) in listOf(INCOMING to "channelIncoming", ONGOING to "channelOngoing")) {
      val ch = nm.getNotificationChannel(id) ?: continue
      ch.name = Texts.get(ctx, key)
      nm.createNotificationChannel(ch)
    }
  }
}
