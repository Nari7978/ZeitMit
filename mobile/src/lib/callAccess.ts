// What an Android phone has to allow so video date requests ring even with ZeitMit closed: notifications, full-screen
// calls (Android 14+), showing over other apps, and not being stopped to save battery. Shared by the screen that asks
// for it when the app opens (screens/AllowCalls.tsx, opened by app/_layout.tsx) and the Free now card's checklist.
import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { nativeCalls, type CallAccess } from '../../modules/zeitmit-calls';
import { pushAccess, turnOnPush, type PushAccess } from './push';

export type ReachKey = 'notifications' | 'fullScreen' | 'overlay' | 'battery';
export const REACH_KEYS: ReachKey[] = ['notifications', 'fullScreen', 'overlay', 'battery'];

/** Phone brands that stop apps in the background unless they're allowed to start by themselves ("Autostart"). */
export const STRICT_BRANDS: Record<string, string> = {
  xiaomi: 'Xiaomi', redmi: 'Xiaomi', poco: 'Xiaomi', oppo: 'Oppo', realme: 'Realme', oneplus: 'OnePlus', vivo: 'Vivo',
  iqoo: 'Vivo', huawei: 'Huawei', honor: 'Honor', meizu: 'Meizu', tecno: 'Tecno', infinix: 'Infinix',
};

const allowedFrom = (access: CallAccess | null, push: PushAccess | null): Record<ReachKey, boolean> => ({
  notifications: push === null || push === 'on',
  fullScreen: access?.fullScreen ?? true,
  overlay: access?.overlay ?? true,
  battery: access?.battery ?? true,
});

/**
 * The phone's answers, checked again whenever the app comes back (from the phone's settings, say). `allow` opens the
 * phone's own dialog or settings page for one of them.
 */
export function useReach() {
  const [access, setAccess] = useState<CallAccess | null>(() => nativeCalls.access());
  const [push, setPush] = useState<PushAccess | null>(null);
  const check = useCallback(async () => {
    setAccess(nativeCalls.access());
    setPush(await pushAccess());
  }, []);
  useEffect(() => {
    void check();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') void check(); });
    return () => sub.remove();
  }, [check]);
  const allow = useCallback(async (key: ReachKey | 'app') => {
    if (key === 'notifications') await turnOnPush();
    else nativeCalls.openSettings(key);
    await check();
  }, [check]);
  return { access, allowed: allowedFrom(access, push), allow, brand: access ? STRICT_BRANDS[access.brand] ?? null : null };
}

/** Whether something is still missing on this phone (for deciding, as the app opens, whether to ask). */
export async function reachMissing() {
  const access = nativeCalls.access();
  if (!access) return false;
  const allowed = allowedFrom(access, await pushAccess());
  return REACH_KEYS.some((k) => !allowed[k]);
}

const ASKED = 'zeitmit.reachAsked';
/** When the screen last opened by itself: it opens again only 12 hours later while something is still missing. */
export const reachAsked = {
  async load() {
    try {
      const v = Platform.OS === 'web' ? globalThis.localStorage?.getItem(ASKED) : await SecureStore.getItemAsync(ASKED);
      return Number(v) || 0;
    } catch {
      return 0;
    }
  },
  async save() {
    try {
      if (Platform.OS === 'web') globalThis.localStorage?.setItem(ASKED, String(Date.now()));
      else await SecureStore.setItemAsync(ASKED, String(Date.now()));
    } catch {
      // Not saved: it may ask once more, which is harmless.
    }
  },
};
export const REACH_ASK_EVERY_MS = 12 * 3600 * 1000;
