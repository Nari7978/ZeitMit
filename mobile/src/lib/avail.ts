// When a companion can be booked (GET /companions/:id/availability): for each kind of date they offer, the free
// intervals (unix) left after their hours, blocked time and confirmed bookings, plus the rules. Kept current: changes
// arrive live the moment a booking is confirmed or cancelled or the companion changes their hours; it's also reloaded
// when the screen comes back into view, after a reconnect and, while the live connection is down, every 30 seconds.
// The server checks every request again (backend/src/lib/hours.ts); this only offers what it would accept.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api } from '../api';
import { useStore } from '../store';
import type { Kind } from '../data';
import { useLive } from './live';
import { addDays, localAt, localToday } from './dates';
import { TZ, offsetMin } from './tz';

export type Interval = [number, number];
/** One kind of date: the shortest and longest booking (minutes) and the free intervals. */
export type KindFree = { min: number; max: number; open: Interval[] };
export type Availability = {
  /** The companion's time zone (their hours are set in it). */
  tz: string; now: number; earliest: number; latest: number; step: number;
  kinds: Record<Kind, KindFree | null>;
};

/** Rules (as on the server): starts and lengths in 15-minute steps, from 3½ hours ahead. */
export const STEP_S = 15 * 60;
export const LEAD_S = 3.5 * 3600;
/** A request has to be accepted within 24 hours, and at least 3 hours before its start. */
export const ACCEPT_BEFORE_S = 3 * 3600;
export const EXPIRE_AFTER_S = 24 * 3600;
export const deadlineFor = (startsAt: number, sentAt = Date.now() / 1000) => Math.min(sentAt + EXPIRE_AFTER_S, startsAt - ACCEPT_BEFORE_S);

const ceilStep = (u: number) => Math.ceil(u / STEP_S) * STEP_S;
/** The earliest start right now: the server's, moved on as time passes. */
export const earliestNow = (a: Availability) => Math.max(a.earliest, ceilStep(Date.now() / 1000 + LEAD_S));

/** Minutes free from `start` until the end of its free interval (0 when it isn't free). */
export function freeFrom(open: Interval[], start: number) {
  const iv = open.find(([s, e]) => s <= start && start < e);
  return iv ? Math.floor((iv[1] - start) / 60) : 0;
}

/** Starts (unix) in 15-minute steps from `from` to before `to` with at least `min` minutes free. */
export function startsBetween(open: Interval[], min: number, from: number, to: number) {
  const out: number[] = [];
  for (const [s, e] of open) {
    for (let u = ceilStep(Math.max(s, from)); u < Math.min(e, to) && u + min * 60 <= e; u += STEP_S) out.push(u);
  }
  return out;
}

/** The first start with at least `min` minutes free, or null. */
export function firstStart(a: Availability, kind: Kind, min?: number) {
  const k = a.kinds[kind];
  if (!k) return null;
  return startsBetween(k.open, min ?? k.min, earliestNow(a), a.latest)[0] ?? null;
}

/** Midnight at the start of a date (in this phone's zone). */
const dayStart = (date: string) => {
  const guess = Date.parse(`${date}T00:00:00Z`) / 1000;
  return guess - offsetMin(guess - offsetMin(guess) * 60) * 60;
};

/** One day as this phone shows it: its starts for a kind, and its free and taken stretches. */
export type Day = {
  date: string; from: number; to: number; starts: number[];
  /** Free stretches that day (clipped to it); everything else that day can't be booked. */
  free: Interval[];
  /** The clocks change that day: its times are shown with their UTC offset. */
  dst: boolean;
};

/** The 7 days from today (bookings go up to 7 days ahead) for one kind and length. */
export function daysOf(a: Availability, kind: Kind, min?: number): Day[] {
  const k = a.kinds[kind];
  const today = localToday();
  const from0 = earliestNow(a);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i);
    const from = dayStart(date), to = dayStart(addDays(date, 1));
    const open = k?.open ?? [];
    const starts = k ? startsBetween(open, min ?? k.min, Math.max(from, from0), Math.min(to, a.latest)) : [];
    const free = open.filter(([s, e]) => e > Math.max(from, from0) && s < to).map(([s, e]): Interval => [Math.max(s, from, from0), Math.min(e, to)]);
    return { date, from, to, starts, free, dst: offsetMin(from) !== offsetMin(to - 1) };
  }).filter((d) => d.from < a.latest);
}

/** "18:00" in this phone's zone (with "UTC+1" on a day the clocks change, so the twice-happening hour is clear). */
export const timeOf = (unix: number, dst = false) => {
  const t = localAt(unix).time;
  if (!dst) return t;
  const m = offsetMin(unix), a = Math.abs(m);
  return `${t} UTC${m < 0 ? '−' : '+'}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, '0')}` : ''}`;
};

/** A companion's availability, kept current. `a` is null until loaded. */
export function useAvailability(cid: string | undefined) {
  const [a, setA] = useState<Availability | null>(null);
  const loaded = useRef(false);
  const reload = useCallback(async () => {
    if (!cid) return;
    try {
      setA(await api<Availability>('GET', `/companions/${cid}/availability`));
      loaded.current = true;
    } catch (e) {
      if (!loaded.current) useStore.getState().showToast((e as Error).message);
    }
  }, [cid]);
  const live = useLive(cid ? `/live/slots/${cid}` : null, (e) => {
    if (e.type === 'slots' && e.availability) setA(e.availability as Availability);
  }, () => void reload());
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  useEffect(() => {
    const t = setInterval(() => { if (!live.current && AppState.currentState === 'active') void reload(); }, 30000);
    return () => clearInterval(t);
  }, [reload, live]);
  return { a, reload };
}

/** The companion's zone, when it isn't this phone's: "Times are your time. Noah is in Berlin." */
export const otherZone = (a: Availability | null) => (a && a.tz !== TZ && offsetMin(a.now, a.tz) !== offsetMin(a.now, TZ) ? a.tz : null);
