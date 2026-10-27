import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { signSession } from '../lib/auth';
import { sendLoginEmail } from '../lib/notify';
import { digits, fail, newId, now, safeEqual, sha256 } from '../lib/util';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const auth = new Hono<AppEnv>();

/** Step 1: email a 6-digit login code. */
auth.post('/request-code', async (c) => {
  const { email: raw } = await c.req.json<{ email?: string }>();
  const email = (raw ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) fail(400, 'Enter a valid email address.');

  const recent = await c.env.DB.prepare('SELECT expires_at FROM login_codes WHERE email = ?').bind(email).first<{ expires_at: number }>();
  if (recent && recent.expires_at - 600 + 30 > now()) fail(429, 'Please wait 30 seconds before asking for a new code.');

  const code = digits(6);
  await c.env.DB.prepare('INSERT OR REPLACE INTO login_codes (email, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0)')
    .bind(email, await sha256(email + ':' + code), now() + 600)
    .run();

  const sent = await sendLoginEmail(c.env, email, code);
  if (sent) return c.json({ sent: true });
  if (c.env.DEV_LOGIN_CODES === 'true') return c.json({ sent: false, devCode: code });
  fail(409, 'Email login isn’t available right now. Please try again later.');
});

/** Step 2: exchange the code for a session token. Creates the account on first login. */
auth.post('/verify', async (c) => {
  const { email: raw, code } = await c.req.json<{ email?: string; code?: string }>();
  const email = (raw ?? '').trim().toLowerCase();
  const row = await c.env.DB.prepare('SELECT code_hash, expires_at, attempts FROM login_codes WHERE email = ?')
    .bind(email)
    .first<{ code_hash: string; expires_at: number; attempts: number }>();
  if (!row || row.expires_at < now()) fail(400, 'That code has expired. Ask for a new one.');
  if (row!.attempts >= 5) fail(429, 'Too many wrong codes. Ask for a new one.');
  if (!safeEqual(row!.code_hash, await sha256(email + ':' + (code ?? '').trim()))) {
    await c.env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?').bind(email).run();
    fail(400, 'That code doesn’t match.');
  }
  await c.env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run();

  const devMode = c.env.DEV_LOGIN_CODES === 'true';
  const wantsAdmin = c.env.ADMIN_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).includes(email);
  let user = await c.env.DB.prepare('SELECT id, email, role, name FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; email: string; role: 'customer' | 'admin'; name: string }>();
  const isNew = !user;
  if (!user) {
    const id = newId('u');
    await c.env.DB.prepare('INSERT INTO users (id, email, role) VALUES (?, ?, ?)').bind(id, email, wantsAdmin && !devMode ? 'admin' : 'customer').run();
    user = { id, email, role: wantsAdmin && !devMode ? 'admin' : 'customer', name: '' };
  } else if (wantsAdmin && !devMode && user.role !== 'admin') {
    await c.env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(user.id).run();
    user.role = 'admin';
  }
  // Never hand out admin sessions while codes are visible in API responses.
  const role = devMode ? 'customer' : user.role;
  const token = await signSession({ id: user.id, email, role }, c.env.JWT_SECRET);
  return c.json({ token, isNew, user: { id: user.id, email, name: user.name, role } });
});
