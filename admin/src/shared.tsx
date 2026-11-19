// Small pieces the admin pages share: the page context, Berlin times, and a person's round picture or initial.
import { photoSrc } from './api';

export type Ctx = { say: (m: string) => void; refresh: () => void };

const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', ...o });
/** "14:05" in Berlin. */
export const clock = (u: number) => fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(u * 1000));
/** "14:05:09" in Berlin. */
export const clockS = (u: number) => fmt({ hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(u * 1000));
/** "Tue 18 Nov" in Berlin. */
export const day = (u: number) => fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(u * 1000)).replace(',', '');
/** "Oct 2026" in Berlin. */
export const month = (u: number) => fmt({ month: 'short', year: 'numeric' }).format(new Date(u * 1000));
/** "4:09" (minutes and seconds). */
export const mmss = (s: number) => { const x = Math.max(0, Math.floor(s)); return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`; };
/** "45 s", "31 min", "2 h 5 min". */
export const length = (s: number) => {
  if (s < 60) return `${Math.max(0, Math.round(s))} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
};
/** "just now", "6 min ago", "3 h ago", "2 days ago". */
export const ago = (u: number, now = Date.now() / 1000) => {
  const m = Math.max(0, Math.round((now - u) / 60));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

const TINTS = ['var(--blush)', 'var(--lilac)', 'var(--mint-soft)', 'var(--butter)', 'var(--amber-soft)'];
/** Their photo, or their initial on a soft colour. */
export function Avatar({ name, url, hue, size = 40 }: { name: string; url?: string | null; hue?: number; size?: number }) {
  const style = { width: size, height: size, borderRadius: size * 0.35 };
  return url
    ? <img className="av" style={style} src={photoSrc(url)} alt="" />
    : <span className="av" style={{ ...style, background: TINTS[Math.abs(Math.round((hue ?? name.charCodeAt(0)) / 7)) % TINTS.length], fontSize: size * 0.45 }}>{(name.trim()[0] ?? '?').toUpperCase()}</span>;
}
