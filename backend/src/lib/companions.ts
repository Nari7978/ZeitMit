import { FREE_CANCEL_HOURS, REPLY_HOURS, VIDEO_ACT, VIDEO_GRACE_MIN, type Env } from '../types';
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

/**
 * Video dates and in-person dates each have their own hours (weekly windows and specific dates) and their own notice,
 * but one clock: a booking of either kind blocks the companion for both, since nobody can be in two dates at once.
 */
export type Kind = 'meet' | 'video';
export const KINDS: Kind[] = ['meet', 'video'];
export const kindOf = (act: string): Kind => (act === VIDEO_ACT ? 'video' : 'meet');
/** The kinds a companion offers: in person with any activity but video dates, video with video dates. */
export const kindsOf = (acts: string[]): Kind[] => KINDS.filter((k) => acts.some((a) => kindOf(a) === k));
/** How soon a booking can start: a video date needs no travel; in person, there's time to reply and get there. */
export const LEAD_S: Record<Kind, number> = { video: 15 * 60, meet: 2 * 3600 };
/** Where each kind's hours are kept. */
export const HOURS_TABLES: Record<Kind, { weekly: string; dates: string }> = {
  meet: { weekly: 'availability', dates: 'availability_dates' },
  video: { weekly: 'availability_video', dates: 'availability_dates_video' },
};
export const kindParam = (k: unknown): Kind => (k === 'video' ? 'video' : 'meet');

/** When an in-person request expires unanswered: REPLY_HOURS after it was sent, at the latest an hour before the start. */
export const replyBy = (b: { created_at: number; starts_at: number }) => Math.min(b.created_at + REPLY_HOURS * 3600, b.starts_at - 3600);

/**
 * Until when a customer can cancel a confirmed booking for free: FREE_CANCEL_HOURS before the start, and a video date
 * (confirmed the moment it's booked) also in its first VIDEO_GRACE_MIN minutes. Later, the companion keeps their pay.
 */
export const freeUntil = (b: { activity: string; created_at: number; starts_at: number }) =>
  Math.max(b.starts_at - FREE_CANCEL_HOURS * 3600, b.activity === VIDEO_ACT ? Math.min(b.created_at + VIDEO_GRACE_MIN * 60, b.starts_at) : 0);

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
 * by midnight). So the next free time starts right where the last booking ends. Each start is at least `lead`
 * seconds from now with at least an hour free; `fit` is the longest booking (in half hours, up to 8) that fits from
 * there. `firstOnly` stops at each day's first open time (for lists: when someone is next free).
 */
export function openTimes(cal: CalDay[], windows: Set<string>, custom: Map<string, Range[]>, busy: Busy[], t: number, lead: number, firstOnly = false): DaySlots[] {
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
        if (start < t + lead) continue;
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

/** Blocking times, whatever the kind: requests (a checkout in progress too), confirmed bookings, meet-ups under way and suggested new times. */
const BUSY_SQL = `SELECT companion_id, starts_at, duration_h FROM bookings WHERE status IN ('pending', 'confirmed', 'completed') AND starts_at > ?1 AND starts_at < ?2 AND id <> ?3
  UNION ALL
  SELECT companion_id, resched_at, duration_h FROM bookings WHERE status IN ('pending', 'confirmed') AND resched_at > ?1 AND resched_at < ?2 AND id <> ?3`;

const busyOf = (env: Env, companionId: string, t: number, except: string) =>
  env.DB.prepare(BUSY_SQL.replace(/AND id <> \?3/g, 'AND id <> ?3 AND companion_id = ?4')).bind(t - MAX_HOURS * 3600, t + 8 * 86400, except, companionId)
    .all<Busy>().then((r) => r.results);

/** One kind's weekly windows ("0-eve") and specific dates for a companion. */
async function hoursOf(env: Env, companionId: string, kind: Kind, from: string) {
  const { weekly, dates } = HOURS_TABLES[kind];
  const [win, own] = await Promise.all([
    env.DB.prepare(`SELECT day, win FROM ${weekly} WHERE companion_id = ?`).bind(companionId).all<{ day: number; win: string }>(),
    env.DB.prepare(`SELECT date, ranges FROM ${dates} WHERE companion_id = ? AND date >= ?`).bind(companionId, from).all<{ date: string; ranges: string }>(),
  ]);
  return {
    windows: new Set(win.results.map((w) => `${w.day}-${w.win}`)),
    custom: new Map(own.results.map((d) => [d.date, parseJson<Range[]>(d.ranges, [])])),
  };
}

/**
 * Open slots of one kind for the next 7 days (see openTimes): that kind's weekly windows (or, on dates with their own
 * hours, those hours) minus every booking. Cancelled bookings don't block, so a cancelled time is bookable again
 * straight away. `except` leaves one booking out (its own time and suggestion), for picking a new time for it.
 */
export async function slotsFor(env: Env, companionId: string, except = '', kind: Kind = 'meet'): Promise<DaySlots[]> {
  const t = now();
  const cal = calendar(t);
  const [h, busy] = await Promise.all([hoursOf(env, companionId, kind, cal[0].date), busyOf(env, companionId, t, except)]);
  return openTimes(cal, h.windows, h.custom, busy, t, LEAD_S[kind]);
}

export type Times = Record<Kind, DaySlots[] | null>;

/** Open slots of each kind the companion offers (null for a kind they don't offer), from one look at their bookings. */
export async function timesFor(env: Env, companionId: string, acts?: string[]): Promise<Times> {
  const t = now();
  const cal = calendar(t);
  const offered = kindsOf(acts ?? parseJson<string[]>(
    (await env.DB.prepare('SELECT activities FROM companions WHERE user_id = ?').bind(companionId).first<{ activities: string }>())?.activities, [],
  ));
  const [busy, ...hours] = await Promise.all([busyOf(env, companionId, t, ''), ...offered.map((k) => hoursOf(env, companionId, k, cal[0].date))]);
  const out: Times = { meet: null, video: null };
  offered.forEach((k, i) => { out[k] = openTimes(cal, hours[i].windows, hours[i].custom, busy, t, LEAD_S[k]); });
  return out;
}

/** When someone is next free (unix, or null within 7 days), whether that's today, and the weekdays (0=Mon) with an open time. */
export type Free = { next: number | null; today: boolean; days: number[] };

/**
 * When each companion is next free, for lists and filters, from the same rules as their open times (bookings
 * included): per kind they offer (`free.meet`, `free.video`; null when not offered), and for either kind at the top
 * level (`next` is the sooner one, `today` and `days` count both).
 */
export async function nextFreeAll(env: Env) {
  const t = now();
  const cal = calendar(t);
  const weekly = (k: Kind) => env.DB.prepare(`SELECT companion_id, day, win FROM ${HOURS_TABLES[k].weekly}`).all<{ companion_id: string; day: number; win: string }>();
  const dates = (k: Kind) => env.DB.prepare(`SELECT companion_id, date, ranges FROM ${HOURS_TABLES[k].dates} WHERE date >= ? AND date <= ?`).bind(cal[0].date, cal[6].date)
    .all<{ companion_id: string; date: string; ranges: string }>();
  const [wm, wv, dm, dv, busy] = await Promise.all([
    weekly('meet'), weekly('video'), dates('meet'), dates('video'),
    env.DB.prepare(BUSY_SQL).bind(t - MAX_HOURS * 3600, t + 8 * 86400, '').all<Busy & { companion_id: string }>(),
  ]);
  const group = <T,>(rows: (T & { companion_id: string })[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.companion_id, [...(m.get(r.companion_id) ?? []), r]);
    return m;
  };
  const hours = { meet: { windows: group(wm.results), dates: group(dm.results) }, video: { windows: group(wv.results), dates: group(dv.results) } };
  const blocks = group(busy.results);
  const freeOf = (id: string, k: Kind): Free => {
    const days = openTimes(
      cal,
      new Set((hours[k].windows.get(id) ?? []).map((w) => `${w.day}-${w.win}`)),
      new Map((hours[k].dates.get(id) ?? []).map((d) => [d.date, parseJson<Range[]>(d.ranges, [])])),
      blocks.get(id) ?? [],
      t,
      LEAD_S[k],
      true,
    );
    const first = days.findIndex((d) => d.times.length);
    return {
      next: first < 0 ? null : startAt(cal[first], days[first].times[0]),
      today: days[0].times.length > 0,
      days: days.flatMap((d, i) => (d.times.length ? [cal[i].weekday] : [])),
    };
  };
  return (row: Pick<CompanionRow, 'user_id' | 'activities'>) => {
    const offered = kindsOf(parseJson<string[]>(row.activities, []));
    const free: Record<Kind, Free | null> = { meet: null, video: null };
    for (const k of offered) free[k] = freeOf(row.user_id, k);
    const all = offered.map((k) => free[k]!);
    const nexts = all.map((f) => f.next).filter((n): n is number => n !== null);
    return {
      next: nexts.length ? Math.min(...nexts) : null,
      today: all.some((f) => f.today),
      days: [...new Set(all.flatMap((f) => f.days))].sort((a, b) => a - b),
      free,
    };
  };
}
