import type { Env } from '../types';
import { berlinParts, now, parseJson, windowOf } from './util';

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

/** Bookable start times, as in the app (Berlin local time). */
export const TIMES = ['09:30', '11:00', '12:30', '14:00', '15:30', '17:00', '18:30', '20:00'];

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

/**
 * Open slots for the next 7 days: weekly windows (or, on dates with their own hours, those hours) minus existing
 * bookings, at least 1h from now.
 * `fit[i]` is the longest booking (1–8 hours, in half hours) that can start at `times[i]` without running into
 * another one or past midnight.
 * Requests (including a checkout in progress), confirmed bookings, meet-ups already under way and suggested new times
 * block their time; cancelled ones don't, so a cancelled time is bookable again straight away.
 * `except` leaves one booking out (its own time and suggestion), for picking a new time for it.
 * On a date with its own hours, start times are every half hour within them and a booking ends by the range's end.
 */
export async function slotsFor(env: Env, companionId: string, except = ''): Promise<DaySlots[]> {
  const [win, dates, busy] = await Promise.all([
    env.DB.prepare('SELECT day, win FROM availability WHERE companion_id = ?').bind(companionId).all<{ day: number; win: string }>(),
    env.DB.prepare('SELECT date, ranges FROM availability_dates WHERE companion_id = ? AND date >= ?').bind(companionId, berlinDate(now()))
      .all<{ date: string; ranges: string }>(),
    env.DB.prepare(
      `SELECT starts_at, duration_h FROM bookings WHERE companion_id = ?1 AND id <> ?3 AND status IN ('pending', 'confirmed', 'completed') AND starts_at > ?2
       UNION ALL
       SELECT resched_at, duration_h FROM bookings WHERE companion_id = ?1 AND id <> ?3 AND status IN ('pending', 'confirmed') AND resched_at > ?2`,
    ).bind(companionId, now() - MAX_HOURS * 3600, except)
      .all<{ starts_at: number; duration_h: number }>(),
  ]);
  const open = new Set(win.results.map((w) => `${w.day}-${w.win}`));
  const custom = new Map(dates.results.map((d) => [d.date, parseJson<Range[]>(d.ranges, [])]));
  const free = (from: number, to: number) => !busy.results.some((b) => from < b.starts_at + b.duration_h * 3600 && to > b.starts_at);
  const days: DaySlots[] = [];
  // Step from noon so a daylight-saving change never skips or repeats a date.
  const noon = berlinToUnix(berlinDate(now()), '12:00');
  for (let i = 0; i < 7; i++) {
    const date = berlinDate(noon + i * 86400);
    const times: string[] = [];
    const fit: number[] = [];
    const own = custom.get(date);
    if (own) {
      const midnight = berlinToUnix(berlinDate(berlinToUnix(date, '12:00') + 86400), '00:00');
      for (const [from, to] of own) {
        const end = to === '24:00' ? midnight : berlinToUnix(date, to);
        for (let m = minutes(from); m + MIN_HOURS * 60 <= minutes(to); m += 30) {
          const t = clock(m);
          const start = berlinToUnix(date, t);
          if (start < now() + 3600) continue;
          let h = 0;
          while (h < MAX_HOURS && start + (h + 0.5) * 3600 <= end && free(start, start + (h + 0.5) * 3600)) h += 0.5;
          if (h < MIN_HOURS) continue;
          times.push(t);
          fit.push(h);
        }
      }
      days.push({ date, times, fit, custom: true });
      continue;
    }
    for (const t of TIMES) {
      const start = berlinToUnix(date, t);
      if (start < now() + 3600) continue;
      const { day, hour } = berlinParts(start);
      if (!open.has(`${day}-${windowOf(hour)}`)) continue;
      const midnight = berlinToUnix(berlinDate(start + 86400), '00:00');
      let h = 0;
      while (h < MAX_HOURS && start + (h + 0.5) * 3600 <= midnight && free(start, start + (h + 0.5) * 3600)) h += 0.5;
      if (h < MIN_HOURS) continue;
      times.push(t);
      fit.push(h);
    }
    days.push({ date, times, fit });
  }
  return days;
}
