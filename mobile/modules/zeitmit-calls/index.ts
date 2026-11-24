// ZeitMit's video dates on Android (native code in ./android): a call keeps running in the background with its
// floating window, incoming video dates ring full screen like phone calls with the app closed, and Free now stays
// online with an ongoing notification. Elsewhere (web, iPhone, older builds without it) every call here does nothing.
import { Platform } from 'react-native';
import { requireOptionalNativeModule, type EventSubscription } from 'expo';

/** What this phone allows, for "Make sure requests reach you". */
export type CallAccess = { overlay: boolean; fullScreen: boolean; battery: boolean; pip: boolean; brand: string };
/** From the native side: the app was opened for an incoming call (take it), Decline / Hang up / Turn off, a call off. */
export type CallAction = { type: 'launch' | 'decline' | 'hangUp' | 'freeNowOff' | 'callOff'; bookingId?: string; kind?: string };
/** The incoming video date the app was opened for, from its push: `action` open (show it) or accept (answered). */
export type LaunchedCall = {
  action: 'open' | 'accept'; kind: 'instant' | 'ring'; bookingId: string; who?: string; why?: 'join' | 'ping';
  at?: number; endsAt?: number; expiresAt?: number; minutes?: number; earn?: number;
};

type Native = {
  configure(api: string, token: string | null): void;
  setTexts(json: string): void;
  startCall(bookingId: string, who: string): boolean;
  stopCall(): void;
  isInPip(): boolean;
  startFreeNow(until: number): void;
  stopFreeNow(): void;
  endIncoming(bookingId: string): void;
  lockScreen(on: boolean): void;
  takeAction(): string | null;
  access(): CallAccess;
  openSettings(which: string): void;
  delay(ms: number): Promise<void>;
  addListener(event: 'onAction', fn: (e: CallAction) => void): EventSubscription;
  addListener(event: 'onPip', fn: (e: { inPip: boolean }) => void): EventSubscription;
};

/**
 * Browser checks only (a web build made with EXPO_PUBLIC_FAKE_CALLS=1; real builds leave this out): a pretend Android
 * phone whose answers live in localStorage ("zeitmit.fakeCalls"), so the screens that ask for them can be tried.
 * Opening a setting allows it, as if the person had switched it on there.
 */
function fakeNative(): Native {
  const KEY = 'zeitmit.fakeCalls';
  const read = (): CallAccess => ({ overlay: false, fullScreen: false, battery: false, pip: true, brand: 'xiaomi', ...JSON.parse(globalThis.localStorage?.getItem(KEY) || '{}') });
  const noop = () => undefined;
  return {
    configure: noop, setTexts: noop, startCall: () => false, stopCall: noop, isInPip: () => false, startFreeNow: noop, stopFreeNow: noop,
    endIncoming: noop, lockScreen: noop, takeAction: () => null, access: read,
    openSettings: (which: string) => { if (which !== 'app') globalThis.localStorage?.setItem(KEY, JSON.stringify({ ...read(), [which]: true })); },
    delay: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    addListener: () => ({ remove() {} }),
  } as unknown as Native;
}

const native = Platform.OS === 'android' ? requireOptionalNativeModule<Native>('ZeitmitCalls')
  : process.env.EXPO_PUBLIC_FAKE_CALLS === '1' ? fakeNative() : null;

const safe = <T>(fn: () => T, fallback: T): T => {
  if (!native) return fallback;
  try {
    return fn();
  } catch {
    return fallback;
  }
};
const none = { remove() {} };

export const nativeCalls = {
  /** This build has it (Android 1.3.8+). */
  available: !!native,
  configure: (api: string, token: string | null) => safe(() => native!.configure(api, token), undefined),
  setTexts: (texts: Record<string, string>) => safe(() => native!.setTexts(JSON.stringify(texts)), undefined),
  startCall: (bookingId: string, who: string) => safe(() => native!.startCall(bookingId, who), false),
  stopCall: () => safe(() => native!.stopCall(), undefined),
  isInPip: () => safe(() => native!.isInPip(), false),
  startFreeNow: (until: number) => safe(() => native!.startFreeNow(until), undefined),
  stopFreeNow: () => safe(() => native!.stopFreeNow(), undefined),
  endIncoming: (bookingId: string) => safe(() => native!.endIncoming(bookingId), undefined),
  lockScreen: (on: boolean) => safe(() => native!.lockScreen(on), undefined),
  takeAction: (): LaunchedCall | null => safe(() => {
    const s = native!.takeAction();
    return s ? (JSON.parse(s) as LaunchedCall) : null;
  }, null),
  access: (): CallAccess | null => safe(() => native!.access(), null),
  openSettings: (which: 'overlay' | 'fullScreen' | 'battery' | 'app') => safe(() => native!.openSettings(which), undefined),
  /** Waits `ms`, also while the app is in the background (JavaScript timers pause there on Android). */
  delay: (ms: number): Promise<void> => (native ? native.delay(ms).catch(() => undefined) : new Promise((r) => setTimeout(r, ms))),
  onAction: (fn: (e: CallAction) => void): { remove(): void } => safe(() => native!.addListener('onAction', fn), none),
  onPip: (fn: (inPip: boolean) => void): { remove(): void } => safe(() => native!.addListener('onPip', (e) => fn(!!e.inPip)), none),
};
