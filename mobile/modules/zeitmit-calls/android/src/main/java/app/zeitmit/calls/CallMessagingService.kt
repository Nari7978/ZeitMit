package app.zeitmit.calls

import android.util.Log
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService

/**
 * Every push comes here first: incoming video dates ring full screen when the app isn't on screen, and a push that
 * calls one off stops its ringing. Everything else goes on to expo-notifications as before.
 */
class CallMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val ours = try {
      IncomingCalls.onPush(applicationContext, remoteMessage.data)
    } catch (e: Throwable) {
      Log.w(TAG, "Incoming video date", e)
      false
    }
    if (!ours) super.onMessageReceived(remoteMessage)
  }
}
