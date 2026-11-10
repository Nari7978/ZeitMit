// Expo push notifications: permission, token registration and opening the right screen on tap.
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useStore } from '../store';
import { showRing, useRing } from './ring';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      const d = (n.request.content.data ?? {}) as Record<string, unknown>;
      // A video date ringing while the app is open: the app shows the call itself (RingBanner), with the sound. Not
      // at all while you're in that call already.
      if (d.kind === 'ring') {
        const inCall = useRing.getState().inCall === d.bookingId;
        if (!inCall) showRing(d);
        return { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: !inCall, shouldSetBadge: false };
      }
      return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };
    },
  });
}

/** Asks for permission (once) and sends this phone's Expo push token to the API. */
export async function registerForPush() {
  if (Platform.OS === 'web' || !Device.isDevice) return;
  try {
    if (Platform.OS === 'android') {
      // Every push uses this channel, video date rings too (high priority): a push sent to a channel an installed app
      // version never created wouldn't show at all.
      await Notifications.setNotificationChannelAsync('default', { name: 'ZeitMit', importance: Notifications.AndroidImportance.HIGH, lightColor: '#FF4F8B' });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;
    const projectId = (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId;
    const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    useStore.getState().setPushToken(data);
  } catch {
    // No push credentials yet (e.g. Firebase not configured for this build): in-app notifications still work.
  }
}

/**
 * Calls `onGo` with the notification's target ("chat:…", "tab:…") when the user taps it, including the tap
 * that opened the app. Each tap is followed once (the launch tap is cleared after use).
 */
const followed = new Set<string>();
export function onNotificationTap(onGo: (go: string) => void) {
  if (Platform.OS === 'web') return () => {};
  const handle = (r: Notifications.NotificationResponse | null) => {
    if (!r) return;
    const key = r.notification.request.identifier + ':' + r.actionIdentifier;
    if (followed.has(key)) return;
    followed.add(key);
    const go = r.notification.request.content.data?.go;
    if (typeof go === 'string' && go) onGo(go);
  };
  try {
    handle(Notifications.getLastNotificationResponse());
    Notifications.clearLastNotificationResponse();
  } catch {
    // older native module: no launch tap to follow
  }
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}
