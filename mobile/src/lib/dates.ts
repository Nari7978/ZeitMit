// Dates and times as the app shows them (in this phone's time zone, lib/tz.ts), and companions' hours under the same
// rules as the API (backend/src/lib/hours.ts cleanRanges): up to 6 ranges a day in 15-minute steps, each at least
// 30 minutes, an end at or before the start running into the next day, each open for both kinds of date or one.
import { locale, t } from '../i18n';
import { TZ } from './tz';

/** Which kinds of date a range of hours is open for. */
export type HourKind = 'both' | 'meet' | 'video';
export type Range = { from: string; to: string; kind: HourKind };
export type WeekRange = Range & { day: number };
/** How far ahead a date's hours can be set or time blocked (customers can book 7 days ahead). */
export const PLAN_DAYS = 60;
export const MAX_RANGES = 6;
export const STEP_MIN = 15;

export const minutes = (time: string) => +time.slice(0, 2) * 60 + +time.slice(3, 5);
/** "HH:MM" for minutes of a day; 1440 is "24:00" (an end at midnight), later ones are the next day's clock. */
export const clock = (m: number) => {
  const x = m > 1440 ? m - 1440 : m;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};
/** Minutes a range lasts: an end at or before the start runs into the next day ("18:00"–"18:00" is a whole day). */
export const span = (r: { from: string; to: string }) => {
  const a = minutes(r.from), b = minutes(r.to);
  return b > a ? b - a : b + 1440 - a;
};
/** The range ends after midnight, on the next day. */
export const pastMidnight = (r: { from: string; to: string }) => minutes(r.from) + span(r) > 1440;

/** What's wrong with one day's ranges, or null. */
export function rangeProblem(ranges: Range[]): string | null {
  if (ranges.length > MAX_RANGES) return `Add up to ${MAX_RANGES} time ranges a day.`;
  const sorted = [...ranges].sort((a, b) => minutes(a.from) - minutes(b.from));
  for (const r of sorted) {
    if (minutes(r.from) % STEP_MIN || minutes(r.to) % STEP_MIN) return 'Times go in 15-minute steps, like 18:00 or 22:15.';
    if (span(r) < 30) return 'Each time range needs at least 30 minutes.';
  }
  for (let i = 1; i < sorted.length; i++) if (minutes(sorted[i].from) < minutes(sorted[i - 1].from) + span(sorted[i - 1])) return 'Time ranges can’t overlap.';
  return null;
}

/** Two more hours where there's room: after the last range, else before the first; null when the day is full. */
export function nextRange(ranges: Range[]): Range | null {
  const sorted = [...ranges].sort((a, b) => minutes(a.from) - minutes(b.from));
  if (!sorted.length) return { from: '18:00', to: '22:00', kind: 'both' };
  const last = sorted[sorted.length - 1];
  const end = minutes(last.from) + span(last);
  if (end + 30 <= 1440) return { from: clock(end), to: clock(Math.min(1440, end + 120)), kind: last.kind };
  const first = minutes(sorted[0].from);
  if (first >= 30) return { from: clock(Math.max(0, first - 120)), to: clock(first), kind: sorted[0].kind };
  return null;
}

/** "18:00–24:00", "18:00–02:00": a range (an end before the start is on the next day). */
export const rangeText = (r: { from: string; to: string }) => `${r.from}–${r.to}`;
export const KIND_SHORT: Record<HourKind, string> = { both: 'In person & video', meet: 'In person only', video: 'Video only' };
/** "18:00–22:00, 23:00–02:00", the kind added when it isn't both; or "Day off". */
export const rangesText = (ranges: Range[], kinds = false) =>
  (ranges.length ? ranges.map((r) => rangeText(r) + (kinds && r.kind !== 'both' ? ` (${t(r.kind === 'video' ? 'video' : 'in person')})` : '')).join(', ') : t('Day off'));

// ---------- Moments, dates and labels (this phone's time zone unless another is given) ----------

const partFmts = new Map<string, Intl.DateTimeFormat>();
const partsIn = (unix: number, tz: string) => {
  let f = partFmts.get(tz);
  if (!f) partFmts.set(tz, (f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })));
  return Object.fromEntries(f.formatToParts(new Date(unix * 1000)).map((x) => [x.type, x.value]));
};
/** A moment as a date (YYYY-MM-DD) and clock time (HH:MM). */
export function localAt(unix: number, tz = TZ) {
  const p = partsIn(unix, tz);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}
/** Today, YYYY-MM-DD. */
export const localToday = (tz = TZ) => localAt(Date.now() / 1000, tz).date;
/** The date `n` days after `date` (both YYYY-MM-DD). */
export const addDays = (date: string, n: number) => new Date(Date.parse(date + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
/** 0 = Monday … 6 = Sunday. */
export const weekdayOf = (date: string) => (new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7;
/** The moment a date and clock time happens (its first time when the clocks go back). */
export function localUnix(date: string, time: string, tz = TZ) {
  const guess = Date.parse(`${date}T${time}:00Z`) / 1000;
  const off = (u: number) => { const p = localAt(u, tz); return Date.parse(`${p.date}T${p.time}:00Z`) / 1000 - u; };
  return guess - off(guess - off(guess));
}
const labelFormats = new Map<string, Intl.DateTimeFormat>();
/** "Sat, 8 Nov" in the app's language. */
export function dateLabel(date: string) {
  const l = locale();
  let f = labelFormats.get(l);
  if (!f) labelFormats.set(l, (f = new Intl.DateTimeFormat(l, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })));
  return f.format(new Date(date + 'T12:00:00Z'));
}
const weekdays = new Map<string, Intl.DateTimeFormat>();
const weekdayShort = (date: string) => {
  const l = locale();
  let f = weekdays.get(l);
  if (!f) weekdays.set(l, (f = new Intl.DateTimeFormat(l, { weekday: 'short', timeZone: 'UTC' })));
  return f.format(new Date(date + 'T12:00:00Z'));
};
/** "16:30" today, otherwise "Tomorrow · 01:00": until when something holds. */
export function untilLabel(unix: number) {
  const p = localAt(unix);
  return p.date === localToday() ? p.time : whenFree(p.date, p.time);
}
/** "Today · 18:30", "Tomorrow · 09:00", "Sat, 8 Nov · 17:00": when someone is next free. */
export function whenFree(date: string, time: string) {
  const today = localToday();
  return date === today ? `Today · ${time}` : date === addDays(today, 1) ? `Tomorrow · ${time}` : `${dateLabel(date)} · ${time}`;
}
/** The same for a moment. */
export const whenAt = (unix: number) => { const p = localAt(unix); return whenFree(p.date, p.time); };
/**
 * "Free today · 18:30", "Free tomorrow · 09:00", "Free Sat · 17:00": the short form for cards. For a video date
 * time: "Video today · 21:00".
 */
export function freeTag(date: string, time: string, video = false) {
  const today = localToday();
  const w = video ? 'Video' : 'Free';
  return date === today ? `${w} today · ${time}` : date === addDays(today, 1) ? `${w} tomorrow · ${time}` : `${w} ${weekdayShort(date)} · ${time}`;
}
