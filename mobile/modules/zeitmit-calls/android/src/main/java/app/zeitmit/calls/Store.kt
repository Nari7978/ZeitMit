package app.zeitmit.calls

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

internal const val TAG = "ZeitmitCalls"

/**
 * What the native side keeps between app starts: the session (to decline or turn Free now off without opening the
 * app), the app's texts in its language, until when Free now is on, and an incoming call the app was opened for.
 */
internal object Store {
  private fun prefs(ctx: Context): SharedPreferences =
    ctx.applicationContext.getSharedPreferences("zeitmit_calls", Context.MODE_PRIVATE)

  fun setSession(ctx: Context, api: String, token: String?) {
    val e = prefs(ctx).edit().putString("api", api)
    if (token.isNullOrEmpty()) e.remove("token") else e.putString("token", token)
    e.apply()
  }

  fun api(ctx: Context): String? = prefs(ctx).getString("api", null)

  fun token(ctx: Context): String? = prefs(ctx).getString("token", null)

  fun setTexts(ctx: Context, json: String) {
    prefs(ctx).edit().putString("texts", json).apply()
  }

  fun texts(ctx: Context): JSONObject =
    try { JSONObject(prefs(ctx).getString("texts", null) ?: "{}") } catch (e: Exception) { JSONObject() }

  fun setFreeNowUntil(ctx: Context, until: Long) {
    prefs(ctx).edit().putLong("freeNowUntil", until).apply()
  }

  fun freeNowUntil(ctx: Context): Long = prefs(ctx).getLong("freeNowUntil", 0L)

  fun setPending(ctx: Context, json: String) {
    prefs(ctx).edit().putString("pending", json).commit()
  }

  /** The incoming call the app was opened for (from its notification), once. */
  fun takePending(ctx: Context): String? {
    val p = prefs(ctx)
    val v = p.getString("pending", null)
    if (v != null) p.edit().remove("pending").commit()
    return v
  }
}
