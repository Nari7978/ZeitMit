// Time zones. Every moment is stored as UTC unix seconds; dates and clock times belong to a time zone (an IANA name
// such as "Europe/Berlin"): the companion's for her hours, each person's own for what they read. Daylight-saving
// changes are exact: a clock time that doesn't exist (the clocks jump forward) has no moment, one that happens twice
// (the clocks go back) has two.

export const DEFAULT_TZ = 'Europe/Berlin';

const formats = new Map<string, Intl.DateTimeFormat>();
function partsFormat(tz: string) {
  let f = formats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formats.set(tz, f);
  }
  return f;
}

/** Whether `tz` is a time zone this runtime knows. */
export function validTz(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    partsFormat(tz);
    return true;
  } catch {
    return false;
  }
}

/**
 * Seconds the zone is ahead of UTC at that moment (Berlin: 3600 in winter, 7200 in summer). Clocks only change on a
 * quarter hour, so the answer is kept per quarter hour: working out free times calls this a lot.
 */
const offsets = new Map<string, number>();
export function offsetAt(unix: number, tz: string) {
  const bucket = Math.floor(unix / 900) * 900;
  const key = tz + '|' + bucket;
  let o = offsets.get(key);
  if (o === undefined) {
    if (offsets.size > 20000) offsets.clear();
    const p: Record<string, number> = {};
    for (const x of partsFormat(tz).formatToParts(new Date(bucket * 1000))) if (x.type !== 'literal') p[x.type] = +x.value;
    o = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second) / 1000 - bucket;
    offsets.set(key, o);
  }
  return o;
}

/** The local date (YYYY-MM-DD), minute of the day and weekday (0 = Mon) of a moment. */
export function wall(unix: number, tz: string) {
  const w = unix + offsetAt(unix, tz);
  const d = new Date(w * 1000);
  return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes(), weekday: (d.getUTCDay() + 6) % 7 };
}

export const dateIn = (unix: number, tz: string) => wall(unix, tz).date;
export const addDays = (date: string, n: number) => new Date(Date.parse(date + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const weekdayOf = (date: string) => (new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7;
export const minutes = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
export const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const realDate = (date: unknown): date is string => {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(date + 'T12:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date; // no 30 February
};

/**
 * Every moment at which the local clock shows `date` and minute `min` (up to 1440 + …, counted from that date's
 * midnight): one normally, none in a spring-forward gap, two in the hour that repeats when the clocks go back.
 */
export function localMoments(date: string, min: number, tz: string): number[] {
  const asUtc = Date.parse(date + 'T00:00:00Z') / 1000 + min * 60;
  const out: number[] = [];
  for (const o of new Set([offsetAt(asUtc - 86400, tz), offsetAt(asUtc + 86400, tz)])) {
    const m = asUtc - o;
    if (offsetAt(m, tz) === o && !out.includes(m)) out.push(m);
  }
  return out.sort((a, b) => a - b);
}

/**
 * The moment for a local date and minute. `strict`: null when that clock time doesn't exist (spring forward); otherwise
 * a missing time moves forward by the gap, like the clock does. A time that happens twice gives the earlier moment,
 * or the later one with `later`.
 */
export function localToUnix(date: string, min: number, tz: string, mode: 'earlier' | 'later' | 'strict' = 'earlier'): number | null {
  const day = frame(date, tz);
  // Most days have no clock change: plain arithmetic from midnight.
  if (day.steady && min >= 0 && min <= 1440) return day.start + min * 60;
  const m = localMoments(date, min, tz);
  if (m.length) return mode === 'later' ? m[m.length - 1] : m[0];
  if (mode === 'strict') return null;
  const asUtc = Date.parse(date + 'T00:00:00Z') / 1000 + min * 60;
  return asUtc - offsetAt(asUtc - 86400, tz);
}

/** A local day's first moment and whether its offset stays the same all day (no clock change). Cached. */
const frames = new Map<string, { start: number; steady: boolean }>();
function frame(date: string, tz: string) {
  const key = tz + '|' + date;
  let f = frames.get(key);
  if (!f) {
    if (frames.size > 4000) frames.clear();
    const asUtc = Date.parse(date + 'T00:00:00Z') / 1000;
    const before = offsetAt(asUtc - 86400, tz);
    const after = offsetAt(asUtc + 2 * 86400, tz);
    const starts = localMoments(date, 0, tz);
    const start = starts.length ? starts[0] : asUtc - before;
    f = { start, steady: before === after && offsetAt(start, tz) === before && offsetAt(start + 86400, tz) === before };
    frames.set(key, f);
  }
  return f;
}

const labels = new Map<string, Intl.DateTimeFormat[]>();
/** "Tue 10 Nov", "18:00" and "Tue 10 Nov · 18:00" in that zone, as notifications and the API show them. */
export function whenIn(unix: number, tz: string = DEFAULT_TZ) {
  let f = labels.get(tz);
  if (!f) {
    f = [
      new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }),
      new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    ];
    labels.set(tz, f);
  }
  const d = new Date(unix * 1000);
  const day = f[0].format(d).replace(',', '');
  const time = f[1].format(d);
  return { day, time, full: `${day} · ${time}` };
}

/** The zone's short name at that moment ("CET", "CEST", "GMT+5:30"): shown where a clock time could be ambiguous. */
export function zoneName(unix: number, tz: string, locale = 'en-GB') {
  return new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(unix * 1000)).find((p) => p.type === 'timeZoneName')?.value ?? tz;
}
