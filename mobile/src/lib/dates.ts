// Companions' own hours for specific dates: Berlin dates, the weekly windows as hours, and the same rules as the API
// (backend/src/lib/companions.ts cleanRanges).
import { locale, t } from '../i18n';

export type Range = [string, string];
/** How far ahead hours can be set for a date (customers can book 7 days ahead). */
export const CUSTOM_DAYS_AHEAD = 60;
export const MAX_RANGES = 3;
const FIRST = 6 * 60;
const LAST = 24 * 60;

export const minutes = (time: string) => +time.slice(0, 2) * 60 + +time.slice(3, 5);
export const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Today in Berlin, YYYY-MM-DD. */
export const berlinToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
/** The date `n` days after `date` (both YYYY-MM-DD). */
export const addDays = (date: string, n: number) => new Date(Date.parse(date + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
/** 0 = Monday … 6 = Sunday. */
export const weekdayOf = (date: string) => (new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7;
const labelFormats = new Map<string, Intl.DateTimeFormat>();
/** "Sat, 8 Nov" in the app's language. */
export function dateLabel(date: string) {
  const l = locale();
  let f = labelFormats.get(l);
  if (!f) labelFormats.set(l, (f = new Intl.DateTimeFormat(l, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })));
  return f.format(new Date(date + 'T12:00:00Z'));
}

const WINDOW_HOURS: Record<string, [number, number]> = { am: [9 * 60, 12 * 60], pm: [12 * 60, 17 * 60], eve: [17 * 60, LAST] };

/** One weekday's weekly windows as hours (morning 09–12, afternoon 12–17, evening 17–24), joined where they touch. */
export function weeklyRanges(avail: string[], weekday: string): Range[] {
  const out: [number, number][] = [];
  for (const w of ['am', 'pm', 'eve']) {
    if (!avail.includes(`${weekday}-${w}`)) continue;
    const [a, b] = WINDOW_HOURS[w];
    const last = out[out.length - 1];
    if (last && last[1] === a) last[1] = b;
    else out.push([a, b]);
  }
  return out.map(([a, b]) => [clock(a), clock(b)]);
}

/** "18:00–22:00, 23:00–24:00", or "Day off". */
export const rangesText = (ranges: Range[]) => (ranges.length ? ranges.map(([a, b]) => `${a}–${b}`).join(', ') : t('Day off'));

/** What's wrong with these hours, or null. */
export function rangeProblem(ranges: Range[]): string | null {
  if (!ranges.length) return 'Add some hours, or choose Day off.';
  const sorted = [...ranges].sort((a, b) => minutes(a[0]) - minutes(b[0]));
  for (const [a, b] of sorted) {
    if (minutes(a) < FIRST || minutes(b) > LAST || minutes(a) % 30 || minutes(b) % 30) return 'Times go in half hours, from 06:00 to midnight.';
    if (minutes(b) - minutes(a) < 60) return 'Each time range needs at least an hour.';
  }
  for (let i = 1; i < sorted.length; i++) if (minutes(sorted[i][0]) < minutes(sorted[i - 1][1])) return 'Time ranges can’t overlap.';
  return null;
}

/** Two more hours where there's room: after the last range, else before the first; null when the day is full. */
export function nextRange(ranges: Range[]): Range | null {
  const sorted = [...ranges].sort((a, b) => minutes(a[0]) - minutes(b[0]));
  const end = sorted.length ? minutes(sorted[sorted.length - 1][1]) : 18 * 60;
  if (end + 60 <= LAST) return [clock(end), clock(Math.min(LAST, end + 120))];
  const start = sorted.length ? minutes(sorted[0][0]) : FIRST;
  if (start - 60 >= FIRST) return [clock(Math.max(FIRST, start - 120)), clock(start)];
  return null;
}
