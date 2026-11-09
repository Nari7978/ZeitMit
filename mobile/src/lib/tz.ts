// The time zone the app shows times in: this phone's. The server stores moments as UTC and writes its texts in the
// zone the app reports (PATCH /me { timezone }); a companion's hours are in their own zone, named when it differs.
const guess = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin';
  } catch {
    return 'Europe/Berlin';
  }
};
export const TZ = guess();

/** "Berlin", "New York": a zone's city, for labels. */
export const cityOf = (tz: string) => (tz.split('/').pop() ?? tz).replace(/_/g, ' ');

const parts = new Map<string, Intl.DateTimeFormat>();
/** Minutes a zone is ahead of UTC at a moment (Berlin: 60 in winter, 120 in summer). */
export function offsetMin(unix: number, tz = TZ) {
  let f = parts.get(tz);
  if (!f) parts.set(tz, (f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })));
  const p = Object.fromEntries(f.formatToParts(new Date(unix * 1000)).map((x) => [x.type, x.value]));
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) / 1000 - Math.floor(unix / 60) * 60) / 60);
}

/** "UTC+2", "UTC+5:30": tells apart the two 02:30s on the night the clocks go back. */
export function offsetLabel(unix: number, tz = TZ) {
  const m = offsetMin(unix, tz);
  const a = Math.abs(m);
  return `UTC${m < 0 ? '−' : '+'}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, '0')}` : ''}`;
}
