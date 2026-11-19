package app.zeitmit.calls

import android.content.Context
import java.util.Locale

/** Notification texts in the app's language (the app sends them, see setTexts), with English until it has. */
internal object Texts {
  private val DEFAULTS = mapOf(
    "instantTitle" to "Video date request from {who}",
    "instantBody" to "{length} · You earn {earn} · Answer within 2 minutes",
    "ringJoinTitle" to "{who} is waiting in your video date",
    "ringPingTitle" to "{who} is pinging you",
    "ringBody" to "Join your video date now",
    "accept" to "Accept",
    "decline" to "Decline",
    "join" to "Join now",
    "notNow" to "Not now",
    "channelIncoming" to "Incoming video dates",
    "channelOngoing" to "Video date in progress",
    "channelFreeNow" to "Free now",
    "ongoingTitle" to "Video date with {who}",
    "ongoingBody" to "Tap to go back to the call",
    "hangUp" to "Hang up",
    "freeNowTitle" to "Free now for video dates",
    "freeNowBody" to "Until {time} · Your phone rings for requests",
    "turnOff" to "Turn off",
    "min" to "{n} min",
    "hour" to "1 hour",
    "hours" to "{n} hours",
    "halfHours" to "{n}½ hours",
    "hm" to "{h} h {m} min",
  )

  fun get(ctx: Context, key: String, vararg args: Pair<String, String>): String {
    val stored = Store.texts(ctx).optString(key, "")
    var s = if (stored.isNotEmpty()) stored else DEFAULTS[key] ?: key
    for ((k, v) in args) s = s.replace("{$k}", v)
    return s
  }

  /** "45 min", "1 hour", "1½ hours", "1 h 15 min" (like the app's lengthLabel). */
  fun length(ctx: Context, minutes: Int): String {
    val h = minutes / 60
    val m = minutes % 60
    return when {
      h == 0 -> get(ctx, "min", "n" to "$m")
      m == 0 -> if (h == 1) get(ctx, "hour") else get(ctx, "hours", "n" to "$h")
      m == 30 -> get(ctx, "halfHours", "n" to "$h")
      else -> get(ctx, "hm", "h" to "$h", "m" to "$m")
    }
  }

  /** "€25" or "€25.50", like the app. */
  fun euros(cents: Long): String =
    if (cents % 100 == 0L) "€${cents / 100}" else "€" + String.format(Locale.US, "%.2f", cents / 100.0)
}
