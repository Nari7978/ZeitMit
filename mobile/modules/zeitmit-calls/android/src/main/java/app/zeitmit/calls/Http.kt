package app.zeitmit.calls

import android.content.Context
import android.util.Log
import java.net.HttpURLConnection
import java.net.URL

/** Small calls to the ZeitMit API with the stored session, for answers given without opening the app. */
internal object Http {
  fun call(ctx: Context, method: String, path: String, body: String? = null): Pair<Int, String?> {
    val api = Store.api(ctx) ?: return 0 to null
    val token = Store.token(ctx) ?: return 0 to null
    var conn: HttpURLConnection? = null
    return try {
      conn = URL(api + path).openConnection() as HttpURLConnection
      conn.requestMethod = method
      conn.connectTimeout = 8_000
      conn.readTimeout = 8_000
      conn.setRequestProperty("Authorization", "Bearer $token")
      conn.setRequestProperty("X-ZeitMit-Api", "3")
      conn.setRequestProperty("Accept", "application/json")
      if (body != null) {
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
      }
      val code = conn.responseCode
      val stream = if (code in 200..299) conn.inputStream else conn.errorStream
      code to stream?.bufferedReader()?.use { it.readText() }
    } catch (e: Exception) {
      Log.w(TAG, "$method $path failed", e)
      0 to null
    } finally {
      conn?.disconnect()
    }
  }

  fun inBackground(ctx: Context, method: String, path: String, body: String? = null, done: ((Int, String?) -> Unit)? = null) {
    val app = ctx.applicationContext
    Thread {
      val (code, text) = call(app, method, path, body)
      try { done?.invoke(code, text) } catch (e: Exception) { Log.w(TAG, "after $method $path", e) }
    }.start()
  }
}
