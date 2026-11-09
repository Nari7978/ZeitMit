import { HTTPException } from 'hono/http-exception';
import { DEFAULT_TZ, whenIn } from './time';

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

/** Berlin-local formatting ("Tue 27 Oct · 14:00"); for someone's own zone use whenIn from ./time. */
export const berlinWhen = (unix: number) => whenIn(unix, DEFAULT_TZ);

// Flags messages that try to move payment/contact off-platform or ask for sexual services.
const FLAG_RE = /(paypal|revolut|cash ?app|bank ?transfer|iban|whats ?app|telegram|signal|snapchat|instagram|\+?\d[\d ()-]{7,}\d|\bsex|\bnude|\bescort|hotel room|overnight)/i;
export const shouldFlag = (text: string) => FLAG_RE.test(text);

// Phone numbers (8+ digits, any spacing) and email addresses can't be sent in chat:
// bookings, payment and contact stay inside ZeitMit, which is what keeps both sides safe.
const PHONE_RE = /(?:\+|\b00)?\d(?:[\s().\/-]*\d){7,}/;
const EMAIL_RE = /[A-Z0-9._%+-]+\s*(?:@|\(at\)|\[at\])\s*[A-Z0-9.-]+\s*(?:\.|\(dot\))\s*[A-Z]{2,}/i;
const DATE_RE = /\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})\b/g;
const HANDLE_RE = /(?:^|[\s(:])@[A-Za-z0-9_.]{3,}/;
export const hasContactDetails = (text: string) => PHONE_RE.test(text.replace(DATE_RE, ' ')) || EMAIL_RE.test(text) || HANDLE_RE.test(text);
export const CONTACT_MSG = 'For everyone’s safety, phone numbers, email addresses and social media handles can’t be shared on ZeitMit. Keep talking here in the app.';
