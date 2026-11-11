// Expo push notifications: permission, token registration and opening the right screen on tap. The phone's own
// permission dialog only comes after someone chose to turn notifications on (TurnOnNotifications, Settings, the
// companion Overview), never by itself over another screen.
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
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

/** On: allowed. Ask: the phone's dialog can still be shown. Off: blocked, only the phone's settings turn it on. */
export type PushAccess = 'on' | 'ask' | 'off';

/** Push needs a real phone (browsers and simulators have nothing to ask for). */
const pushable = () => Platform.OS !== 'web' && Device.isDevice;

/** Whether this phone lets ZeitMit send notifications. Never asks. */
export async function pushAccess(): Promise<PushAccess> {
  if (!pushable()) return 'on';
  try {
    const p = await Notifications.getPermissionsAsync();
    return p.status === 'granted' ? 'on' : p.canAskAgain ? 'ask' : 'off';
  } catch {
    return 'on';
  }
}

/** Sends this phone's Expo push token to the API if notifications are allowed. Never asks. */
export async function registerForPush() {
  if (!pushable()) return;
  try {
    if (Platform.OS === 'android') {
      // Every push uses this channel, video date rings too (high priority): a push sent to a channel an installed app
      // version never created wouldn't show at all. (Apps for Android 13+ creating a channel doesn't ask anything.)
      await Notifications.setNotificationChannelAsync('default', { name: 'ZeitMit', importance: Notifications.AndroidImportance.HIGH, lightColor: '#FF4F8B' });
    }
    if ((await Notifications.getPermissionsAsync()).status !== 'granted') return;
    const projectId = (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId;
    const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    useStore.getState().setPushToken(data);
  } catch {
    // No push credentials yet (e.g. Firebase not configured for this build): in-app notifications still work.
  }
}

/**
 * Turns notifications on, after someone chose to: the phone's own dialog while it can still be shown, otherwise the
 * phone's settings for ZeitMit. Registers the push token once they're allowed. True if they're on now.
 */
export async function turnOnPush(): Promise<boolean> {
  if (!pushable()) return true;
  try {
    const access = await pushAccess();
    if (access === 'off') {
      await Linking.openSettings();
      return false;
    }
    if (access === 'ask' && (await Notifications.requestPermissionsAsync()).status !== 'granted') return false;
    await registerForPush();
    return true;
  } catch {
    return false;
  }
}

/** This phone's notification access, checked again whenever the app comes back (it may have changed in settings). */
export function usePushAccess() {
  const [access, setAccess] = useState<PushAccess | null>(null);
  const check = useCallback(async () => setAccess(await pushAccess()), []);
  useEffect(() => {
    void check();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void check(); });
    return () => sub.remove();
  }, [check]);
  const turnOn = useCallback(async () => {
    const on = await turnOnPush();
    await check();
    return on;
  }, [check]);
  return { access, turnOn };
}

const ASKED = 'zeitmit.pushAsked';
/** Whether ZeitMit's own "Turn on notifications" screen has opened by itself on this phone (it does once). */
export const pushAsked = {
  async load() {
    try {
      return (Platform.OS === 'web' ? globalThis.localStorage?.getItem(ASKED) : await SecureStore.getItemAsync(ASKED)) === '1';
    } catch {
      return false;
    }
  },
  async save() {
    try {
      if (Platform.OS === 'web') globalThis.localStorage?.setItem(ASKED, '1');
      else await SecureStore.setItemAsync(ASKED, '1');
    } catch {
      // Not saved: the screen may open once more, which is harmless.
    }
  },
};

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
