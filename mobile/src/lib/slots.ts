// A companion's open times, kept current: changes arrive live the moment someone books or cancels, or the companion
// changes their availability. Also reloaded when the screen comes back into view, after a reconnect and, while the
// live connection is down, every 30 seconds.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api } from '../api';
import { useStore } from '../store';
import { useLive } from './live';

/** One day: open start times and, for each, the longest booking (hours) that fits before the next one. */
export type DaySlots = { date: string; times: string[]; fit?: number[] };

/** Longest booking (hours) that can start at `time` on this day; 0 when the time isn't open. */
export function fitAt(day: DaySlots | undefined, time: string | null) {
  const i = day && time ? day.times.indexOf(time) : -1;
  return i < 0 ? 0 : day!.fit?.[i] ?? 4;
}

export function useSlots(cid: string | undefined) {
  const [slots, setSlots] = useState<DaySlots[] | null>(null);
  const loaded = useRef(false);
  const reload = useCallback(async () => {
    if (!cid) return;
    try {
      setSlots(await api<DaySlots[]>('GET', `/companions/${cid}/slots`));
      loaded.current = true;
    } catch (e) {
      if (!loaded.current) useStore.getState().showToast((e as Error).message);
    }
  }, [cid]);
  const live = useLive(cid ? `/live/slots/${cid}` : null, (e) => {
    if (e.type === 'slots' && Array.isArray(e.slots)) setSlots(e.slots as DaySlots[]);
  }, () => void reload());
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  useEffect(() => {
    const t = setInterval(() => { if (!live.current && AppState.currentState === 'active') void reload(); }, 30000);
    return () => clearInterval(t);
  }, [reload, live]);
  return { slots, reload };
}
