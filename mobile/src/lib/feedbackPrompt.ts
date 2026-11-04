// "How did it go?" after a meet-up: which one to ask about, and a pop-up on the home screen once per meet-up.
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useIsFocused } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useStore } from '../store';

const KEY = 'zeitmit.feedbackPopped';
const DAY = 86400;
type Ended = { id: string; status: string; startsAt: number; dur: number; feedback?: boolean };

/** The latest finished meet-up (within `days` of its end) that hasn't been answered yet. */
export function feedbackDue<T extends Ended>(list: T[], days = 7): T | undefined {
  const now = Date.now() / 1000;
  return list
    .filter((b) => b.status === 'completed' && !b.feedback && b.startsAt + b.dur * 3600 <= now && b.startsAt + b.dur * 3600 > now - days * DAY)
    .sort((a, b) => b.startsAt - a.startsAt)[0];
}

let popped: string[] | null = null;
async function loadPopped() {
  if (popped) return popped;
  try {
    const raw = Platform.OS === 'web' ? globalThis.localStorage?.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    popped = raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    popped = [];
  }
  return popped;
}
async function markPopped(id: string) {
  const list = [...(await loadPopped()).filter((x) => x !== id), id].slice(-30);
  popped = list;
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, JSON.stringify(list));
    else await SecureStore.setItemAsync(KEY, JSON.stringify(list));
  } catch {
    // Not saved: it may pop up once more, which is harmless.
  }
}

/**
 * On the home screen (Discover for customers, Overview for companions): opens the private "How did it go?" sheet by
 * itself once per meet-up, a moment after the screen shows, for meet-ups that ended in the last 3 days. Never on top
 * of another sheet; after that the card on the home screen and the booking keep asking.
 */
export function useFeedbackPopup(side: 'customer' | 'companion') {
  const focused = useIsFocused();
  const due = useStore((s) => feedbackDue<Ended>(side === 'customer' ? s.bookings : s.comp.done, 3)?.id);
  useEffect(() => {
    if (!focused || !due) return;
    let gone = false;
    const t = setTimeout(async () => {
      const done = await loadPopped();
      const s = useStore.getState();
      if (gone || done.includes(due) || s.sheet !== null || s.session !== 'in') return;
      s.openFeedback(due);
      void markPopped(due);
    }, 900);
    return () => { gone = true; clearTimeout(t); };
  }, [focused, due]);
}
