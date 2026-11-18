// Free now for video dates: the companion's open app checks in while it's on (it only counts while the app does), and
// a request rings with a ringtone and vibration while the app is open (with the app closed, the push rings instead).
import { useEffect } from 'react';
import { AppState, Vibration } from 'react-native';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useStore } from '../store';

/** How often the open app checks in while Free now is on (the server lets it count for 10 minutes after). */
const SEEN_EVERY_MS = 2 * 60 * 1000;

/**
 * Checks in now and every couple of minutes while Free now is on and the app is in front; once more each time the app
 * comes back to the front. Closed or in the background, it stops, so after 10 minutes customers stop seeing it.
 */
export function useFreeNowCheckIn() {
  const on = useStore((s) => !!s.comp.freeNow?.until && s.comp.freeNow.until > Date.now() / 1000);
  useEffect(() => {
    if (!on) return;
    const { freeNowSeen } = useStore.getState();
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      void freeNowSeen();
      timer = setInterval(() => void freeNowSeen(), SEEN_EVERY_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState !== 'background') start();
    const sub = AppState.addEventListener('change', (s) => (s === 'active' ? start() : s === 'background' ? stop() : undefined));
    return () => {
      stop();
      sub.remove();
    };
  }, [on]);
}

/** Buzz, buzz, pause, repeated while a request rings (iPhones keep their own rhythm). */
const BUZZ = [0, 500, 300, 500, 1200];
let player: AudioPlayer | null = null;

/** Starts the ringtone (looped) and the vibration. Without sound on this phone, it still vibrates. */
export function startRinging() {
  try { Vibration.vibrate(BUZZ, true); } catch { /* no vibration here */ }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    if (!player) player = createAudioPlayer(require('../../assets/sounds/request-ring.wav'));
    player.loop = true;
    void player.seekTo(0);
    player.play();
  } catch { /* no sound here */ }
}

/** Stops the ringtone and the vibration. */
export function stopRinging() {
  try { Vibration.cancel(); } catch { /* no vibration here */ }
  try { player?.pause(); } catch { /* nothing playing */ }
}
