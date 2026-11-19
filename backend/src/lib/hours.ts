// A companion's hours: ONE calendar for in-person dates and video dates.
//
// - Weekly hours and hours for specific dates are ranges of the companion's local clock time. "18:00"–"02:00" runs past midnight
//   into the next day: a range belongs to the day it starts on. Each range is open for both kinds of date (the
//   default), for in-person dates only, or for video dates only.
// - On a date with its own hours, those replace that weekday's weekly hours (none at all: a day off).
// - Blocked periods (breaks, time off) close time whatever the hours say, until the companion removes them.
// - Only CONFIRMED bookings (and ones under way or done) take time: requests don't, so several people can ask for
//   overlapping times and the companion picks. A booking of either kind blocks the time for both.
//
// So the free time for a kind = its open hours − blocks − confirmed bookings, as UTC intervals. Start times and lengths
// go in 15-minute steps; there are no fixed slots. Time zones and daylight saving: see ./time.
import { VIDEO_ACT, type Env } from '../types';
import { addDays, clock, dateIn, DEFAULT_TZ, localToUnix, minutes, wall, weekdayOf } from './time';
import { now, parseJson } from './util';

export type Kind = 'meet' | 'video';
export type HourKind = 'both' | Kind;
export const KINDS: Kind[] = ['meet', 'video'];
export const HOUR_KINDS: HourKind[] = ['both', 'meet', 'video'];
export const kindOf = (act: string): Kind => (act === VIDEO_ACT ? 'video' : 'meet');
/** The kinds a companion offers: in person with any activity but video dates, video with video dates. */
export const kindsOf = (acts: string[]): Kind[] => KINDS.filter((k) => acts.some((a) => kindOf(a) === k));

/** Start times and lengths go in 15-minute steps. */
export const STEP_MIN = 15;
export const STEP_S = STEP_MIN * 60;
/** Booking lengths in minutes: at least an hour in person, half an hour on video; at most 8 hours. */
export const MIN_MINUTES: Record<Kind, number> = { meet: 60, video: 30 };
export const MAX_MINUTES = 8 * 60;
/** A request sent well ahead must be accepted at least 3 hours before its start, and within 24 hours of being sent. */
export const ACCEPT_BEFORE_S = 3 * 3600;
export const EXPIRE_AFTER_S = 24 * 3600;
/**
 * Short notice (closer than that): the companion answers within `window` (10 minutes for a video date, 30 minutes in
 * person) and at least `before` the start (10 minutes, or an hour to get there).
 */
export const SHORT_REPLY: Record<Kind, { window: number; before: number }> = { video: { window: 600, before: 600 }, meet: { window: 1800, before: 3600 } };
/**
 * How far ahead a companion can be booked, per kind (minutes): what they chose in their listing, from these. The
 * shortest is the answer time plus the gap before the start: 20 minutes for a video date, 1½ hours in person.
 */
export const NOTICE_OPTIONS: Record<Kind, number[]> = { video: [20, 60, 240], meet: [90, 240, 1440] };
export const DEFAULT_NOTICE: Record<Kind, number> = { video: 20, meet: 90 };
/** Moving a booking to another time still needs 3½ hours' notice, so the other side has at least half an hour to answer. */
export const LEAD_S = ACCEPT_BEFORE_S + 30 * 60;
/** A companion's notice for a kind in seconds (a stored value that isn't an option falls back to the default). */
export const noticeS = (kind: Kind, minutes?: number | null) => (NOTICE_OPTIONS[kind].includes(minutes ?? -1) ? minutes! : DEFAULT_NOTICE[kind]) * 60;
/** Customers book up to 7 days ahead. */
export const HORIZON_S = 7 * 86400;
/**
 * Free now: a companion who switched it on (for one of FREE_NOW_HOURS) can be booked for a video date that starts as
 * soon as they accept. They have INSTANT_REPLY_S to answer; it counts only while their app checked in within
 * FREE_NOW_AWAY_S; FREE_NOW_MISSES requests in a row left unanswered switch it off.
 */
export const FREE_NOW_HOURS = [1, 2, 3];
export const INSTANT_REPLY_S = 120;
export const FREE_NOW_AWAY_S = 600;
/** The same for a check-in from the background (Android, the app closed): a sleeping phone checks in less often. */
export const FREE_NOW_AWAY_BG_S = 1800;
export const FREE_NOW_MISSES = 3;
/** Companions plan specific dates and blocks up to 60 days ahead. */
export const PLAN_DAYS = 60;
export const MAX_RANGES = 6;

export const ceilStep = (u: number) => Math.ceil(u / STEP_S) * STEP_S;
export const floorStep = (u: number) => Math.floor(u / STEP_S) * STEP_S;

/**
 * When a request expires. Sent well ahead: 24 hours after it was sent, or 3 hours before its start if that's sooner.
 * Short notice: within SHORT_REPLY's window and before its gap to the start. The later of the two, so the rules meet
 * without a jump. The database works out the same (bookings.expires_at, migration 0022).
 */
export const expiryOf = (b: { created_at: number; starts_at: number; kind: Kind; instant?: number | boolean }) => (b.instant ? b.created_at + INSTANT_REPLY_S : Math.max(
  Math.min(b.created_at + EXPIRE_AFTER_S, b.starts_at - ACCEPT_BEFORE_S),
  Math.min(b.created_at + SHORT_REPLY[b.kind].window, b.starts_at - SHORT_REPLY[b.kind].before),
));
/** Whether a request can still be accepted at moment `t` (up to and including its expiry). */
export const canAccept = (b: { created_at: number; starts_at: number; kind: Kind; instant?: number | boolean }, t: number) => t <= expiryOf(b);

/** "1 hour", "2½ hours", "1 hour 15 minutes", "45 minutes": the same wording as the app. */
export function lengthText(min: number) {
  const h = Math.floor(min / 60), m = min % 60;
  if (h && m === 30) return `${h}½ hours`;
  const hours = h ? `${h} ${h === 1 ? 'hour' : 'hours'}` : '';
  const mins = m ? `${m} minutes` : '';
  return [hours, mins].filter(Boolean).join(' ');
}

// ---------- Ranges ----------

export type Range = { from: string; to: string; kind: HourKind };
export type WeekRange = Range & { day: number };
export type Interval = [number, number];

/** Minutes a range lasts: "to" at or before "from" runs into the next day ("18:00"–"18:00" is a whole day). */
export const span = (r: { from: string; to: string }) => {
  const a = minutes(r.from), b = minutes(r.to);
  return b > a ? b - a : b + 1440 - a;
};

const FROM_RE = /^([01]\d|2[0-3]):(00|15|30|45)$/;
const TO_RE = /^(([01]\d|2[0-3]):(00|15|30|45)|24:00)$/;

/**
 * Checks one day's ranges: up to 6, in 15-minute steps (from "00:00" to "23:45", ending by "24:00" or past midnight),
 * each at least 30 minutes and at most a day, not overlapping. Takes { from, to, kind } or ["18:00", "22:00", kind?]
 * (older apps send pairs: both kinds). Returns them sorted; throws a message for the app otherwise.
 */
export function cleanRanges(raw: unknown): Range[] {
  if (!Array.isArray(raw)) throw new Error('Send the hours as a list.');
  if (raw.length > MAX_RANGES) throw new Error(`Add up to ${MAX_RANGES} time ranges a day.`);
  const out = raw.map((r): Range => {
    const [from, to, kind] = Array.isArray(r) ? r : [r?.from, r?.to, r?.kind];
    if (typeof from !== 'string' || !FROM_RE.test(from) || typeof to !== 'string' || !TO_RE.test(to)) throw new Error('Times go in 15-minute steps, like 18:00 or 22:15.');
    const k = kind ?? 'both';
    if (!HOUR_KINDS.includes(k)) throw new Error('Pick both, in person or video for each time range.');
    if (span({ from, to }) < 30) throw new Error('Each time range needs at least 30 minutes.');
    return { from, to, kind: k };
  }).sort((a, b) => minutes(a.from) - minutes(b.from));
  for (let i = 1; i < out.length; i++) {
    if (minutes(out[i].from) < minutes(out[i - 1].from) + span(out[i - 1])) throw new Error('Time ranges can’t overlap.');
  }
  return out;
}

const MASK: Record<HourKind, number> = { meet: 1, video: 2, both: 3 };
const MASK_KIND: (HourKind | null)[] = [null, 'meet', 'video', 'both'];

/**
 * The same hours as ranges that don't overlap, joined where they touch with the same kind (at most a day each):
 * what's stored and shown. Overlapping ranges of different kinds become one open for both where they meet.
 */
export function normalize(ranges: Range[]): Range[] {
  const rs = ranges.map((r) => ({ a: minutes(r.from), b: minutes(r.from) + span(r), m: MASK[r.kind] }));
  const xs = [...new Set(rs.flatMap((r) => [r.a, r.b]))].sort((a, b) => a - b);
  const segs: { a: number; b: number; m: number }[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i], b = xs[i + 1];
    if (a >= 1440) break; // ranges start on this day
    const m = rs.reduce((acc, r) => (r.a <= a && r.b >= b ? acc | r.m : acc), 0);
    if (!m) continue;
    const last = segs[segs.length - 1];
    if (last && last.b === a && last.m === m && b - last.a <= 1440) last.b = b;
    else segs.push({ a, b, m });
  }
  return segs.map((s) => ({ from: clock(s.a), to: s.b === 1440 ? '24:00' : clock(s.b % 1440), kind: MASK_KIND[s.m]! }));
}

/** Adds or takes away open time (`mask`: 1 in person, 2 video, 3 both) on one day's ranges: for older apps' controls. */
export function changeCoverage(ranges: Range[], from: number, to: number, mask: number, on: boolean): Range[] {
  const segs = normalize(ranges).map((r) => ({ a: minutes(r.from), b: minutes(r.from) + span(r), m: MASK[r.kind] }));
  const xs = [...new Set([from, to, ...segs.flatMap((s) => [s.a, s.b])])].sort((a, b) => a - b);
  const out: Range[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i], b = xs[i + 1];
    let m = segs.reduce((acc, s) => (s.a <= a && s.b >= b ? acc | s.m : acc), 0);
    if (a >= from && b <= to) m = on ? m | mask : m & ~mask;
    const kind = MASK_KIND[m];
    if (kind && a < 1440) out.push({ from: clock(a), to: b === 1440 ? '24:00' : clock(b % 1440), kind });
  }
  return normalize(out);
}

// ---------- Intervals ----------

/** Joins overlapping and touching intervals. */
export function union(list: Interval[]): Interval[] {
  const s = [...list].sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** `list` minus every interval in `cuts`. */
export function subtract(list: Interval[], cuts: Interval[]): Interval[] {
  let out = list;
  for (const [c0, c1] of cuts) {
    const next: Interval[] = [];
    for (const [a, b] of out) {
      if (c1 <= a || c0 >= b) next.push([a, b]);
      else {
        if (a < c0) next.push([a, c0]);
        if (c1 < b) next.push([c1, b]);
      }
    }
    out = next;
  }
  return out;
}

/** Whether [s, e) lies inside one free interval. */
export const fits = (free: Interval[], s: number, e: number) => free.some(([a, b]) => a <= s && e <= b);

/** The longest booking (minutes, in 15-minute steps, at most 8 hours) that can start at `s`; 0 when `s` isn't free. */
export function fitAt(free: Interval[], s: number) {
  const iv = free.find(([a, b]) => a <= s && s < b);
  return iv ? Math.min(MAX_MINUTES, Math.floor((iv[1] - s) / STEP_S) * STEP_MIN) : 0;
}

/** The first start (on the 15-minute grid, from `earliest`, before `latest`) with room for `min` minutes, or null. */
export function firstStart(free: Interval[], min: number, earliest: number, latest: number) {
  for (const [a, b] of free) {
    const s = ceilStep(Math.max(a, earliest));
    if (s >= latest) return null;
    if (s + min * 60 <= b) return s;
  }
  return null;
}

// ---------- A companion's hours ----------

export type Hours = { tz: string; week: WeekRange[]; days: Map<string, Range[]>; blocks: Interval[] };

/** Stored forms: week [[day, "18:00", "02:00", kind], …], a date's hours [["18:00", "22:00", kind], …]. */
export const parseWeek = (json: string | null | undefined): WeekRange[] =>
  parseJson<unknown[]>(json, []).flatMap((r) => (Array.isArray(r) && r.length >= 3 ? [{ day: +r[0], from: String(r[1]), to: String(r[2]), kind: (HOUR_KINDS.includes(r[3]) ? r[3] : 'both') as HourKind }] : []));
export const parseDay = (json: string | null | undefined): Range[] =>
  parseJson<unknown[]>(json, []).flatMap((r) => (Array.isArray(r) && r.length >= 2 ? [{ from: String(r[0]), to: String(r[1]), kind: (HOUR_KINDS.includes(r[2]) ? r[2] : 'both') as HourKind }] : []));
export const weekJson = (w: WeekRange[]) => JSON.stringify(w.map((r) => [r.day, r.from, r.to, r.kind]));
export const dayJson = (d: Range[]) => JSON.stringify(d.map((r) => [r.from, r.to, r.kind]));

/** The ranges that apply on a date: its own hours if it has them, else its weekday's weekly hours. */
export const rangesOn = (h: Hours, date: string) => h.days.get(date) ?? h.week.filter((r) => r.day === weekdayOf(date));

/**
 * Open hours of one kind between `from` and `to` (unix), as moments in the companion's zone. A range that starts in a clock
 * time that doesn't exist (spring forward) starts when the clock jumps; one that ends in a repeated hour (the clocks go
 * back) ends at its later occurrence.
 */
export function openHours(h: Hours, kind: Kind, from: number, to: number): Interval[] {
  const out: Interval[] = [];
  const last = dateIn(to, h.tz);
  for (let d = addDays(dateIn(from, h.tz), -1); d <= last; d = addDays(d, 1)) {
    for (const r of rangesOn(h, d)) {
      if (r.kind !== 'both' && r.kind !== kind) continue;
      const a = minutes(r.from), end = a + span(r);
      const s = localToUnix(d, a, h.tz)!;
      const e = end <= 1440 ? localToUnix(d, end, h.tz, 'later')! : localToUnix(addDays(d, 1), end - 1440, h.tz, 'later')!;
      if (e > from && s < to && e > s) out.push([Math.max(s, from), Math.min(e, to)]);
    }
  }
  return union(out);
}

/** Free time for a kind: open hours minus blocks minus confirmed bookings, within [from, to). */
export const freeTime = (h: Hours, kind: Kind, from: number, to: number, busy: Interval[]) =>
  subtract(subtract(openHours(h, kind, from, to), h.blocks), busy);

/** Bookings that hold their time: confirmed ones, and ones under way or done (until their end). */
export const HOLDING = "('confirmed', 'completed')";

/** Confirmed bookings of a companion overlapping [from, to), leaving one booking out (when moving it). */
export async function busyOf(env: Env, companionId: string, from: number, to: number, except = ''): Promise<Interval[]> {
  const r = await env.DB.prepare(`SELECT starts_at, ends_at FROM bookings WHERE companion_id = ?1 AND status IN ${HOLDING} AND starts_at < ?3 AND ends_at > ?2 AND id <> ?4`)
    .bind(companionId, from, to, except).all<{ starts_at: number; ends_at: number }>();
  return r.results.map((b) => [b.starts_at, b.ends_at]);
}

/** UTC dates that cover [from, to) in any zone (±14 hours), for loading dates' own hours. */
const utcDates = (from: number, to: number) => [new Date((from - 86400) * 1000).toISOString().slice(0, 10), new Date((to + 86400) * 1000).toISOString().slice(0, 10)];

/**
 * A companion's hours (weekly, dates around the window, blocks in it), time zone, activities and how far ahead they can
 * be booked per kind (seconds).
 */
export async function loadHours(env: Env, companionId: string, from: number, to: number): Promise<Hours & { acts: string[]; notice: Record<Kind, number> } | null> {
  const [d0, d1] = utcDates(from, to);
  const [c, days, blocks] = await env.DB.batch([
    env.DB.prepare('SELECT c.timezone, c.activities, c.notice_video, c.notice_meet, w.ranges FROM companions c LEFT JOIN hours_week w ON w.companion_id = c.user_id WHERE c.user_id = ?').bind(companionId),
    env.DB.prepare('SELECT date, ranges FROM hours_days WHERE companion_id = ? AND date >= ? AND date <= ?').bind(companionId, d0, d1),
    env.DB.prepare('SELECT starts_at, ends_at FROM hours_blocks WHERE companion_id = ? AND ends_at > ? AND starts_at < ?').bind(companionId, from, to),
  ]);
  const row = (c.results as { timezone: string | null; activities: string; notice_video: number | null; notice_meet: number | null; ranges: string | null }[])[0];
  if (!row) return null;
  return {
    tz: row.timezone || DEFAULT_TZ,
    notice: { video: noticeS('video', row.notice_video), meet: noticeS('meet', row.notice_meet) },
    acts: parseJson<string[]>(row.activities, []),
    week: parseWeek(row.ranges),
    days: new Map((days.results as { date: string; ranges: string }[]).map((d) => [d.date, parseDay(d.ranges)])),
    blocks: (blocks.results as { starts_at: number; ends_at: number }[]).map((b) => [b.starts_at, b.ends_at]),
  };
}

/** One kind of date: lengths (minutes), how far ahead it can be booked (`lead`, seconds; `earliest`) and the free time. */
export type KindFree = { min: number; max: number; lead: number; earliest: number; open: Interval[] };
export type Availability = {
  tz: string; now: number; earliest: number; latest: number; step: number;
  kinds: Record<Kind, KindFree | null>;
  /** Free now for a video date: until when, and the longest one that fits (minutes); null when not. */
  freeNow: FreeNow | null;
};
export type FreeNow = { until: number; max: number };

/** What the free-now state is worked out from, per companion (see freeNowRows). */
type FreeNowRow = { user_id: string; free_now_until: number | null; free_now_seen: number | null; free_now_bg?: number; activities: string; next_start: number | null; busy: number };

/**
 * Free now for a video date, from the companion's switch: on, their app checked in lately, they offer video dates, and
 * they aren't busy (in a booking now, or answering another free-now request). The longest video date fits before the
 * switch ends and before their next booking, after the 2 minutes to answer, in 15-minute steps; under 30 minutes, no.
 */
function freeNowFrom(r: FreeNowRow, t: number): FreeNow | null {
  const away = r.free_now_bg ? FREE_NOW_AWAY_BG_S : FREE_NOW_AWAY_S;
  if (!r.free_now_until || r.free_now_until <= t || !r.free_now_seen || r.free_now_seen < t - away || r.busy) return null;
  if (!parseJson<string[]>(r.activities, []).includes(VIDEO_ACT)) return null;
  const end = Math.min(r.free_now_until, r.next_start ?? Infinity) - INSTANT_REPLY_S;
  const max = Math.min(MAX_MINUTES, Math.floor((end - t) / 60 / STEP_MIN) * STEP_MIN);
  return max >= MIN_MINUTES.video ? { until: r.free_now_until, max } : null;
}

/**
 * The rows freeNowFrom needs: one companion (`id`), or everyone with the switch on. `except`: a free-now request that
 * doesn't count as keeping them busy (the one being sent), along with any sent after it.
 */
async function freeNowRows(env: Env, t: number, id?: string, except?: { id: string; created_at: number }) {
  const r = await env.DB.prepare(
    `SELECT c.user_id, c.free_now_until, c.free_now_seen, c.free_now_bg, c.activities,
       (SELECT MIN(b.starts_at) FROM bookings b WHERE b.companion_id = c.user_id AND b.status IN ${HOLDING} AND b.starts_at > ?1) AS next_start,
       EXISTS (SELECT 1 FROM bookings b WHERE b.companion_id = c.user_id AND (
         (b.status IN ${HOLDING} AND b.starts_at <= ?1 AND b.ends_at > ?1)
         OR (b.status = 'pending' AND b.paid = 1 AND b.instant = 1 AND b.expires_at >= ?1 AND b.id <> ?3
             AND (b.created_at < ?4 OR (b.created_at = ?4 AND b.id < ?3))))) AS busy
     FROM companions c WHERE c.status = 'approved' AND c.free_now_until > ?1 ${id ? 'AND c.user_id = ?2' : ''}`,
  ).bind(t, id ?? '', except?.id ?? '', except?.created_at ?? Number.MAX_SAFE_INTEGER).all<FreeNowRow>();
  return r.results;
}

/** Whether one companion is free now for a video date (and for how long). */
export async function freeNowOf(env: Env, companionId: string, t = now(), except?: { id: string; created_at: number }) {
  const [r] = await freeNowRows(env, t, companionId, except);
  return r ? freeNowFrom(r, t) : null;
}

/** Everyone free now for a video date, by companion id (for the list). */
export async function freeNowAll(env: Env, t = now()) {
  const out = new Map<string, FreeNow>();
  for (const r of await freeNowRows(env, t)) {
    const f = freeNowFrom(r, t);
    if (f) out.set(r.user_id, f);
  }
  return out;
}

/**
 * What a customer can book with a companion: for each kind they offer, the free intervals (bookings start from that
 * kind's `earliest`: the companion's notice for it, before `latest`, and can run up to 8 hours past it), plus the rules.
 * `except` leaves one booking out and `moving` asks for 3½ hours' notice at least (to move a booking).
 */
export async function availabilityOf(env: Env, companionId: string, except = '', moving = false): Promise<Availability | null> {
  const t = now();
  const latest = t + HORIZON_S;
  const to = latest + MAX_MINUTES * 60;
  const [h, busy, freeNow] = await Promise.all([loadHours(env, companionId, t, to), busyOf(env, companionId, t, to, except), freeNowOf(env, companionId, t)]);
  if (!h) return null;
  const kinds: Record<Kind, KindFree | null> = { meet: null, video: null };
  for (const k of kindsOf(h.acts)) {
    const lead = Math.max(h.notice[k], moving ? LEAD_S : 0);
    const earliest = ceilStep(t + lead);
    kinds[k] = { min: MIN_MINUTES[k], max: MAX_MINUTES, lead, earliest, open: freeTime(h, k, earliest, to, busy) };
  }
  // The soonest of the kinds (what app versions from before per-kind notice go by; they ask 3½ hours themselves).
  const earliest = Math.min(...KINDS.map((k) => kinds[k]?.earliest ?? Infinity), ceilStep(t + LEAD_S));
  return { tz: h.tz, now: t, earliest, latest, step: STEP_MIN, kinds, freeNow };
}

/** "20 minutes", "1½ hours", "1 day": how far ahead, for messages. */
export const noticeText = (s: number) => (s >= 86400 && s % 86400 === 0 ? (s === 86400 ? '1 day' : `${s / 86400} days`) : lengthText(Math.round(s / 60)));

/**
 * Validates a booking's start and length for a kind (grid, lengths, notice, horizon). `lead`: the notice needed, in
 * seconds (the companion's for that kind; 3½ hours to move a booking). Returns a message, or null.
 */
export function ruleProblem(kind: Kind, start: number, min: number, lead: number, t = now()) {
  if (!Number.isInteger(min) || min % STEP_MIN || min < MIN_MINUTES[kind] || min > MAX_MINUTES) {
    return kind === 'video' ? 'Choose 30 minutes to 8 hours, in 15-minute steps.' : 'Choose 1 to 8 hours, in 15-minute steps.';
  }
  if (!Number.isInteger(start) || start % STEP_S) return 'Start times go in 15-minute steps, like 18:00 or 22:15.';
  if (start < t + lead) return `Pick a time at least ${noticeText(lead)} from now.`;
  if (start >= t + HORIZON_S) return 'You can book up to 7 days ahead.';
  return null;
}

export type Free = { next: number | null; today: boolean; days: number[] };

/** When someone is next free for a kind, whether that's today (the companion's date) and the weekdays with a start, from free time. */
function freeSummary(free: Interval[], min: number, earliest: number, latest: number, tz: string, today: string): Free {
  const next = firstStart(free, min, earliest, latest);
  const dates = new Set<string>();
  for (const [a, b] of free) {
    const lo = ceilStep(Math.max(a, earliest));
    const hi = Math.min(floorStep(b - min * 60), latest - 1);
    if (hi < lo) continue;
    for (let d = dateIn(lo, tz), last = dateIn(hi, tz); d <= last; d = addDays(d, 1)) dates.add(d);
  }
  return { next, today: dates.has(today), days: [...new Set([...dates].map(weekdayOf))].sort((x, y) => x - y) };
}

/**
 * When each companion is next free, for lists and filters (bookings, blocks and dates counted): per kind they offer
 * (`free.meet`, `free.video`; null when not offered) and for either kind at the top level.
 */
export async function nextFreeAll(env: Env) {
  const t = now();
  const latest = t + HORIZON_S;
  const to = latest + MAX_MINUTES * 60;
  const [d0, d1] = utcDates(t, to);
  const [cs, days, blocks, busy] = await env.DB.batch([
    env.DB.prepare('SELECT c.user_id, c.timezone, c.activities, c.notice_video, c.notice_meet, w.ranges FROM companions c LEFT JOIN hours_week w ON w.companion_id = c.user_id WHERE c.status = \'approved\''),
    env.DB.prepare('SELECT companion_id, date, ranges FROM hours_days WHERE date >= ? AND date <= ?').bind(d0, d1),
    env.DB.prepare('SELECT companion_id, starts_at, ends_at FROM hours_blocks WHERE ends_at > ? AND starts_at < ?').bind(t, to),
    env.DB.prepare(`SELECT companion_id, starts_at, ends_at FROM bookings WHERE status IN ${HOLDING} AND starts_at < ? AND ends_at > ?`).bind(to, t),
  ]);
  const group = <T,>(rows: unknown[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows as (T & { companion_id: string })[]) m.set(r.companion_id, [...(m.get(r.companion_id) ?? []), r]);
    return m;
  };
  const dayRows = group<{ date: string; ranges: string }>(days.results);
  const blockRows = group<{ starts_at: number; ends_at: number }>(blocks.results);
  const busyRows = group<{ starts_at: number; ends_at: number }>(busy.results);
  const out = new Map<string, { next: number | null; today: boolean; days: number[]; free: Record<Kind, Free | null> }>();
  for (const c of cs.results as { user_id: string; timezone: string | null; activities: string; notice_video: number | null; notice_meet: number | null; ranges: string | null }[]) {
    const tz = c.timezone || DEFAULT_TZ;
    const notice: Record<Kind, number> = { video: noticeS('video', c.notice_video), meet: noticeS('meet', c.notice_meet) };
    const h: Hours = {
      tz, week: parseWeek(c.ranges),
      days: new Map((dayRows.get(c.user_id) ?? []).map((d) => [d.date, parseDay(d.ranges)])),
      blocks: (blockRows.get(c.user_id) ?? []).map((b) => [b.starts_at, b.ends_at]),
    };
    const taken: Interval[] = (busyRows.get(c.user_id) ?? []).map((b) => [b.starts_at, b.ends_at]);
    const today = dateIn(t, tz);
    const free: Record<Kind, Free | null> = { meet: null, video: null };
    for (const k of kindsOf(parseJson<string[]>(c.activities, []))) {
      const earliest = ceilStep(t + notice[k]);
      free[k] = freeSummary(freeTime(h, k, earliest, to, taken), MIN_MINUTES[k], earliest, latest, tz, today);
    }
    const all = KINDS.map((k) => free[k]).filter((f): f is Free => !!f);
    const nexts = all.map((f) => f.next).filter((n): n is number => n !== null);
    out.set(c.user_id, {
      next: nexts.length ? Math.min(...nexts) : null,
      today: all.some((f) => f.today),
      days: [...new Set(all.flatMap((f) => f.days))].sort((a, b) => a - b),
      free,
    });
  }
  const none = { next: null, today: false, days: [], free: { meet: null, video: null } };
  return (companionId: string) => out.get(companionId) ?? none;
}

// ---------- For app versions from before flexible times ----------

/** A day of start times every half hour with the longest booking (hours) from each: how older apps show times. */
export type DaySlots = { date: string; times: string[]; fit: number[]; custom?: boolean };

/** Half-hour start times with room for an hour, per date (7 dates from today in the companion's zone), from free time. */
export function legacyDays(free: Interval[], tz: string, earliest: number, latest: number, own?: Set<string>): DaySlots[] {
  const today = dateIn(now(), tz);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const byDate = new Map<string, DaySlots>(dates.map((d) => [d, own?.has(d) ? { date: d, times: [], fit: [], custom: true } : { date: d, times: [], fit: [] }]));
  for (const [a, b] of free) {
    for (let s = Math.ceil(Math.max(a, earliest) / 1800) * 1800; s + 3600 <= b && s < latest; s += 1800) {
      const w = wall(s, tz);
      if (w.min % 30) continue;
      const day = byDate.get(w.date);
      if (!day) continue;
      day.times.push(clock(w.min));
      day.fit.push(Math.min(8, Math.floor((b - s) / 1800) / 2));
    }
  }
  return dates.map((d) => byDate.get(d)!);
}

/** Older apps' open times: one list (in person, or video for a video-only companion) and per kind. */
export function legacyViews(a: Availability, h?: { days: Map<string, Range[]> }) {
  const own = h ? new Set(h.days.keys()) : undefined;
  const days = (k: Kind) => (a.kinds[k] ? legacyDays(a.kinds[k]!.open, a.tz, a.kinds[k]!.earliest, a.latest, own) : null);
  const meet = days('meet'), video = days('video');
  return { slots: meet ?? video ?? [], meet, video };
}
