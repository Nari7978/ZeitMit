import type { MiddlewareHandler } from 'hono';
import type { AppEnv, AuthUser } from '../types';
import { fail, now } from './util';

const enc = new TextEncoder();
const b64url = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function key(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

const SESSION_DAYS = 30;

/** Minimal HS256 JWT. */
export async function signSession(user: AuthUser, secret: string) {
  const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(enc.encode(JSON.stringify({ sub: user.id, email: user.email, role: user.role, exp: now() + SESSION_DAYS * 86400 })));
  const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(sig)}`;
}

export async function verifySession(token: string, secret: string): Promise<AuthUser | null> {
  const [h, b, s] = token.split('.');
  if (!h || !b || !s) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await key(secret), unb64url(s), enc.encode(`${h}.${b}`));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64url(b)));
    if (typeof p.exp !== 'number' || p.exp < now()) return null;
    return { id: p.sub, email: p.email, role: p.role };
  } catch {
    return null;
  }
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const h = c.req.header('Authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : c.req.query('token') ?? '';
  const user = token ? await verifySession(token, c.env.JWT_SECRET) : null;
  if (!user) fail(401, 'Please log in again.');
  const row = await c.env.DB.prepare('SELECT suspended FROM users WHERE id = ?').bind(user!.id).first<{ suspended: number }>();
  if (!row) fail(401, 'Account not found.');
  if (row!.suspended) fail(403, 'This account is suspended. Contact support.');
  c.set('user', user!);
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('user').role !== 'admin') fail(403, 'Admins only.');
  await next();
};
