export const API_URL = (import.meta.env.VITE_API_URL ?? 'https://zeitmit-api.zeitmit.workers.dev').replace(/\/$/, '');

const KEY = 'zeitmit.admin.session';
export const session = {
  get: () => localStorage.getItem(KEY),
  set: (t: string | null) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY)),
};

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const token = session.get();
  const res = await fetch(API_URL + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) session.set(null);
    throw new Error(data?.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

/** Image URL; private ID photos need the session token as a query parameter. */
export const photoSrc = (url: string, priv = false) => `${API_URL}${url}${priv ? `?token=${encodeURIComponent(session.get() ?? '')}` : ''}`;

export const eur = (cents: number) => '€' + (cents / 100).toFixed(cents % 100 ? 2 : 0);
export const when = (unix: number) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(unix * 1000));
