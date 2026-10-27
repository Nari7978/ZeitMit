import { HTTPException } from 'hono/http-exception';

export const now = () => Math.floor(Date.now() / 1000);

export function newId(prefix: string) {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return prefix + '_' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Uniform random numeric code, e.g. a 4-digit meet code or 6-digit login code. */
export function digits(n: number) {
  const max = 10 ** n;
  const lim = Math.floor(0xffffffff / max) * max;
  let v: number;
  do v = crypto.getRandomValues(new Uint32Array(1))[0];
  while (v >= lim);
  return String(v % max).padStart(n, '0');
}

export async function sha256(s: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const fail = (status: 400 | 401 | 403 | 404 | 409 | 429, message: string): never => {
  throw new HTTPException(status, { message });
};

export const parseJson = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

export const euros = (cents: number) => {
  const v = cents / 100;
  return '€' + (Number.isInteger(v) ? v : v.toFixed(2));
};

/** Berlin-local formatting for notifications ("Tue, 27 Oct · 14:00"). */
export function berlinWhen(unix: number) {
  const d = new Date(unix * 1000);
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', weekday: 'short', day: 'numeric', month: 'short' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return { day, time, full: `${day} · ${time}` };
}

/** Weekday index (0=Mon) and hour in Berlin for a unix time. */
export function berlinParts(unix: number) {
  const d = new Date(unix * 1000);
  const wd = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', weekday: 'short' }).format(d);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }).format(d));
  return { day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(wd), hour };
}

export const windowOf = (hour: number) => (hour < 12 ? 'am' : hour < 17 ? 'pm' : 'eve');

// Flags messages that try to move payment/contact off-platform or ask for sexual services.
const FLAG_RE = /(paypal|revolut|cash ?app|bank ?transfer|iban|whats ?app|telegram|signal|snapchat|instagram|\+?\d[\d ()-]{7,}\d|\bsex|\bnude|\bescort|hotel room|overnight)/i;
export const shouldFlag = (text: string) => FLAG_RE.test(text);
