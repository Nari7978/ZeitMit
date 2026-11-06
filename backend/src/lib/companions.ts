import type { Env } from '../types';
import { now, parseJson } from './util';

export type CompanionRow = {
  user_id: string; display_name: string; age: number | null; show_age: number; pronouns: string | null; gender: string;
  area: string; dist: string; hue: number; photo_note: string; tagline: string; bio: string; rate: number;
  interests: string; languages: string; activities: string; boundaries: string; lgbtq: number; status: string;
  id_verified: number; rating: number | null; review_count: number; photo_id: string | null; id_photo_id: string | null;
  gallery: string;
};

/** Besides the profile photo, companions show this many more photos (the application needs the minimum). */
export const GALLERY_MIN = 3;
export const GALLERY_MAX = 6;

/** API shape, mirroring the mobile app's `Companion` type. */
export function toCompanion(r: CompanionRow) {
  return {
    id: r.user_id,
    name: r.display_name,
    age: r.show_age ? r.age : null,
    pron: r.pronouns ?? undefined,
    g: r.gender,
    area: r.area,
    dist: r.dist,
    rating: r.rating,
    reviews: r.review_count,
    rate: r.rate,
    verified: !!r.id_verified,
    lgbtq: !!r.lgbtq,
    hue: r.hue,
    photo: r.photo_note,
    tagline: r.tagline,
    interests: parseJson<string[]>(r.interests, []),
    langs: parseJson<[string, string][]>(r.languages, []),
    acts: parseJson<string[]>(r.activities, []),
    ok: parseJson<string[]>(r.boundaries, []),
    bio: r.bio,
    status: r.status,
    photoUrl: r.photo_id ? `/photos/${r.photo_id}` : null,
    gallery: parseJson<string[]>(r.gallery, []).map((id) => `/photos/${id}`),
    showAge: !!r.show_age,
  };
}

/** Unix time for a Berlin-local date (YYYY-MM-DD) and HH:MM, handling CET/CEST. */
export function berlinToUnix(date: string, time: string) {
  const guess = Date.parse(`${date}T${time}:00Z`) / 1000;
  const off = (u: number) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(u * 1000))
      .reduce<Record<string, string>>((a, x) => ((a[x.type] = x.value), a), {});
    return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) / 1000 - u);
  };
  return guess - off(guess - off(guess));
}

export function berlinDate(unix: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(unix * 1000));
}

/** Booking lengths: 1 to 8 hours in half-hour steps. */
export const MIN_HOURS = 1;
export const MAX_HOURS = 8;
export const validLength = (h: unknown): h is number => typeof h === 'number' && h >= MIN_HOURS && h <= MAX_HOURS && Number.isInteger(h * 2);
/** "1 hour", "2½ hours": the same wording as the app. */
export const hoursText = (h: number) => `${Math.floor(h)}${h % 1 ? '½' : ''} ${h === 1 ? 'hour' : 'hours'}`;

/** `custom`: the companion set their own hours for this date (start times every half hour within them). */
export type DaySlots = { date: string; times: string[]; fit: number[]; custom?: boolean };

/** How far ahead companions can set hours for specific dates (customers book up to 7 days ahead). */
export const CUSTOM_DAYS_AHEAD = 60;
export const MAX_RANGES = 3;
export type Range = [string, string];
export const minutes = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * Checks a companion's hours for one date: up to 3 ranges in half hours between 06:00 and midnight ("24:00"), each at
 * least an hour, not overlapping. Returns them sorted; throws a message for the app otherwise.
 */
export function cleanRanges(ranges: unknown): Range[] {
  if (!Array.isArray(ranges)) throw new Error('Send the hours as a list.');
  if (ranges.length > MAX_RANGES) throw new Error(`Add up to ${MAX_RANGES} time ranges.`);
  const ok = (t: unknown): t is string => typeof t === 'string' && /^([01]\d|2[0-4]):(00|30)$/.test(t) && minutes(t) >= 6 * 60 && minutes(t) <= 24 * 60;
  const out = ranges.map((r) => {
    if (!Array.isArray(r) || r.length !== 2 || !ok(r[0]) || !ok(r[1])) throw new Error('Times go in half hours, from 06:00 to midnight.');
    if (minutes(r[1]) - minutes(r[0]) < MIN_HOURS * 60) throw new Error('Each time range needs at least an hour.');
    return [r[0], r[1]] as Range;
  }).sort((a, b) => minutes(a[0]) - minutes(b[0]));
  for (let i = 1; i < out.length; i++) if (minutes(out[i][0]) < minutes(out[i - 1][1])) throw new Error('Time ranges can’t overlap.');
  return out;
}

/** Weekly windows as Berlin times of day, in minutes: morning, afternoon, evening (as in the app). */
export const WINDOWS = { am: [9 * 60, 12 * 60], pm: [12 * 60, 17 * 60], eve: [17 * 60, 24 * 60] } as const;

/** One of the next 7 Berlin dates, with its noon and the following midnight as unix times. */
export type CalDay = { date: string; weekday: number; noon: number; midnight: number };

/** The next 7 days. Timezone maths is slow, so it's done once per request, not per start time. */
export function calendar(t = now()): CalDay[] {
  // Step from noon so a daylight-saving change never skips or repeats a date.
  const first = berlinToUnix(berlinDate(t), '12:00');
  return Array.from({ length: 7 }, (_, i) => {
    const date = berlinDate(first + i * 86400);
    const noon = berlinToUnix(date, '12:00');
    return { date, weekday: (new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7, noon, midnight: berlinToUnix(berlinDate(noon + 86400), '00:00') };
  });
}

/** Unix time of a start on that day. Starts are from 06:00, after any clock change, so noon's offset holds. */
export const startAt = (d: CalDay, time: string) => d.noon + (minutes(time) - 12 * 60) * 60;

type Busy = { starts_at: number; duration_h: number };

/**
 * Open start times for the next 7 days, every half hour: within the companion's own hours on dates that have them
 * (a booking ends by the range's end), otherwise within the weekly windows, joined where they touch (a booking ends
 * by midnight). So the next free time starts right where the last booking ends. Each start is at least an hour from
 * now with at least an hour free; `fit` is the longest booking (in half hours, up to 8) that fits from there.
 * `firstOnly` stops at each day's first open time (for lists: when someone is next free).
 */
export function openTimes(cal: CalDay[], windows: Set<string>, custom: Map<string, Range[]>, busy: Busy[], t: number, firstOnly = false): DaySlots[] {
  const free = (from: number, to: number) => !busy.some((b) => from < b.starts_at + b.duration_h * 3600 && to > b.starts_at);
  const most = firstOnly ? MIN_HOURS : MAX_HOURS;
  return cal.map((d) => {
    const own = custom.get(d.date);
    const spans: { from: number; to: number; end: number }[] = [];
    if (own) {
      for (const [a, b] of own) spans.push({ from: minutes(a), to: minutes(b), end: b === '24:00' ? d.midnight : startAt(d, b) });
    } else {
      for (const w of ['am', 'pm', 'eve'] as const) {
        if (!windows.has(`${d.weekday}-${w}`)) continue;
        const [a, b] = WINDOWS[w];
        const last = spans[spans.length - 1];
        if (last && last.to === a) last.to = b;
        else spans.push({ from: a, to: b, end: d.midnight });
      }
    }
    const times: string[] = [];
    const fit: number[] = [];
    for (const s of spans) {
      for (let m = s.from; m + MIN_HOURS * 60 <= s.to && !(firstOnly && times.length); m += 30) {
        const time = clock(m);
        const start = startAt(d, time);
        if (start < t + 3600) continue;
        let h = 0;
        while (h < most && start + (h + 0.5) * 3600 <= s.end && free(start, start + (h + 0.5) * 3600)) h += 0.5;
        if (h < MIN_HOURS) continue;
        times.push(time);
        fit.push(h);
      }
    }
    return own ? { date: d.date, times, fit, custom: true } : { date: d.date, times, fit };
  });
}

/** Blocking times: requests (a checkout in progress too), confirmed bookings, meet-ups under way and suggested new times. */
const BUSY_SQL = `SELECT companion_id, starts_at, duration_h FROM bookings WHERE status IN ('pending', 'confirmed', 'completed') AND starts_at > ?1 AND starts_at < ?2 AND id <> ?3
  UNION ALL
  SELECT companion_id, resched_at, duration_h FROM bookings WHERE status IN ('pending', 'confirmed') AND resched_at > ?1 AND resched_at < ?2 AND id <> ?3`;

/**
 * Open slots for the next 7 days (see openTimes): weekly windows (or, on dates with their own hours, those hours) minus
 * existing bookings. Cancelled bookings don't block, so a cancelled time is bookable again straight away.
 * `except` leaves one booking out (its own time and suggestion), for picking a new time for it.
 */
export async function slotsFor(env: Env, companionId: string, except = ''): Promise<DaySlots[]> {
  const t = now();
  const cal = calendar(t);
  const [win, dates, busy] = await Promise.all([
    env.DB.prepare('SELECT day, win FROM availability WHERE companion_id = ?').bind(companionId).all<{ day: number; win: string }>(),
    env.DB.prepare('SELECT date, ranges FROM availability_dates WHERE companion_id = ? AND date >= ?').bind(companionId, cal[0].date)
      .all<{ date: string; ranges: string }>(),
    env.DB.prepare(BUSY_SQL.replace(/AND id <> \?3/g, 'AND id <> ?3 AND companion_id = ?4')).bind(t - MAX_HOURS * 3600, t + 8 * 86400, except, companionId)
      .all<Busy>(),
  ]);
  const windows = new Set(win.results.map((w) => `${w.day}-${w.win}`));
  const custom = new Map(dates.results.map((d) => [d.date, parseJson<Range[]>(d.ranges, [])]));
  return openTimes(cal, windows, custom, busy.results, t);
}

/**
 * When each companion is next free, for lists and filters, from the same rules as their open times (bookings
 * included): `next` is the first open start (unix) in the next 7 days, `days` the weekdays (0=Mon) with an open time.
 */
export async function nextFreeAll(env: Env) {
  const t = now();
  const cal = calendar(t);
  const [win, own, busy] = await Promise.all([
    env.DB.prepare('SELECT companion_id, day, win FROM availability').all<{ companion_id: string; day: number; win: string }>(),
    env.DB.prepare('SELECT companion_id, date, ranges FROM availability_dates WHERE date >= ? AND date <= ?').bind(cal[0].date, cal[6].date)
      .all<{ companion_id: string; date: string; ranges: string }>(),
    env.DB.prepare(BUSY_SQL).bind(t - MAX_HOURS * 3600, t + 8 * 86400, '').all<Busy & { companion_id: string }>(),
  ]);
  const group = <T,>(rows: (T & { companion_id: string })[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.companion_id, [...(m.get(r.companion_id) ?? []), r]);
    return m;
  };
  const windows = group(win.results), dates = group(own.results), blocks = group(busy.results);
  return (companionId: string) => {
    const days = openTimes(
      cal,
      new Set((windows.get(companionId) ?? []).map((w) => `${w.day}-${w.win}`)),
      new Map((dates.get(companionId) ?? []).map((d) => [d.date, parseJson<Range[]>(d.ranges, [])])),
      blocks.get(companionId) ?? [],
      t,
      true,
    );
    const first = days.findIndex((d) => d.times.length);
    return {
      next: first < 0 ? null : startAt(cal[first], days[first].times[0]),
      today: days[0].times.length > 0,
      days: days.flatMap((d, i) => (d.times.length ? [cal[i].weekday] : [])).sort((a, b) => a - b),
    };
  };
}
