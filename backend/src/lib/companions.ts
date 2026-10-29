import type { Env } from '../types';
import { berlinParts, now, parseJson, windowOf } from './util';

export type CompanionRow = {
  user_id: string; display_name: string; age: number | null; show_age: number; pronouns: string | null; gender: string;
  area: string; dist: string; hue: number; photo_note: string; tagline: string; bio: string; rate: number;
  interests: string; languages: string; activities: string; boundaries: string; lgbtq: number; status: string;
  id_verified: number; rating: number | null; review_count: number; photo_id: string | null; id_photo_id: string | null;
};

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

/** Longest booking the app offers, in hours. */
export const MAX_HOURS = 4;

export type DaySlots = { date: string; times: string[]; fit: number[] };

/**
 * Open slots for the next 7 days: weekly windows minus existing bookings, at least 1h from now.
 * `fit[i]` is the longest booking (1–4 hours) that can start at `times[i]` without running into another one.
 * Requests (including a checkout in progress), confirmed bookings and meet-ups already under way block their time;
 * cancelled ones don't, so a cancelled time is bookable again straight away.
 */
export async function slotsFor(env: Env, companionId: string): Promise<DaySlots[]> {
  const [win, busy] = await Promise.all([
    env.DB.prepare('SELECT day, win FROM availability WHERE companion_id = ?').bind(companionId).all<{ day: number; win: string }>(),
    env.DB.prepare("SELECT starts_at, duration_h FROM bookings WHERE companion_id = ? AND status IN ('pending', 'confirmed', 'completed') AND starts_at > ?")
      .bind(companionId, now() - MAX_HOURS * 3600)
      .all<{ starts_at: number; duration_h: number }>(),
  ]);
  const open = new Set(win.results.map((w) => `${w.day}-${w.win}`));
  const free = (from: number, to: number) => !busy.results.some((b) => from < b.starts_at + b.duration_h * 3600 && to > b.starts_at);
  const days: DaySlots[] = [];
  for (let i = 0; i < 7; i++) {
    const date = berlinDate(now() + i * 86400);
    const times: string[] = [];
    const fit: number[] = [];
    for (const t of TIMES) {
      const start = berlinToUnix(date, t);
      if (start < now() + 3600) continue;
      const { day, hour } = berlinParts(start);
      if (!open.has(`${day}-${windowOf(hour)}`)) continue;
      let h = 0;
      while (h < MAX_HOURS && free(start, start + (h + 1) * 3600)) h++;
      if (!h) continue;
      times.push(t);
      fit.push(h);
    }
    days.push({ date, times, fit });
  }
  return days;
}
