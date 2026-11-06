// A companion's open times, kept current: changes arrive live the moment someone books or cancels, or the companion
// changes their availability. Also reloaded when the screen comes back into view, after a reconnect and, while the
// live connection is down, every 30 seconds.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api } from '../api';
import { useStore } from '../store';
import type { Kind } from '../data';
import { useLive } from './live';

/** One day: open start times and, for each, the longest booking (hours) that fits before the next one. */
/** `custom`: the companion set their own hours for this date, so its times aren't the usual grid. */
export type DaySlots = { date: string; times: string[]; fit?: number[]; custom?: boolean };

/** Longest booking (hours) that can start at `time` on this day; 0 when the time isn't open. */
export function fitAt(day: DaySlots | undefined, time: string | null) {
  const i = day && time ? day.times.indexOf(time) : -1;
  return i < 0 ? 0 : day!.fit?.[i] ?? 4;
}

/** The first open time in the next 7 days: what "Book now" books. Null when nothing is open. */
export function nextFree(slots: DaySlots[] | null | undefined) {
  for (const d of slots ?? []) if (d.times.length) return { date: d.date, time: d.times[0], fit: d.fit?.[0] ?? MIN_FIT };
  return null;
}
const MIN_FIT = 1;

/** Open times of each kind the companion offers (null for a kind they don't offer). */
export type Times = Record<Kind, DaySlots[] | null>;

/** A companion's open times for both kinds, kept current. `times` is null until loaded. */
export function useSlots(cid: string | undefined) {
  const [times, setTimes] = useState<Times | null>(null);
  const loaded = useRef(false);
  const reload = useCallback(async () => {
    if (!cid) return;
    try {
      setTimes(await api<Times>('GET', `/companions/${cid}/times`));
      loaded.current = true;
    } catch (e) {
      if (!loaded.current) useStore.getState().showToast((e as Error).message);
    }
  }, [cid]);
  const live = useLive(cid ? `/live/slots/${cid}` : null, (e) => {
    if (e.type === 'slots' && ('meet' in e || 'video' in e)) setTimes({ meet: (e.meet as DaySlots[] | null) ?? null, video: (e.video as DaySlots[] | null) ?? null });
  }, () => void reload());
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  useEffect(() => {
    const t = setInterval(() => { if (!live.current && AppState.currentState === 'active') void reload(); }, 30000);
    return () => clearInterval(t);
  }, [reload, live]);
  return { times, reload };
}
