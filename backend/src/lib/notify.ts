import type { Env } from '../types';
import { newId } from './util';

type Note = { icon: string; tone: 'violet' | 'success' | 'warning' | 'error' | 'neutral'; title: string; body: string; go?: string };

/** Stores an in-app notification and sends an Expo push if the user has a push token. */
export async function notify(env: Env, userId: string, n: Note, ctx?: { waitUntil(p: Promise<unknown>): void }) {
  await env.DB.prepare('INSERT INTO notifications (id, user_id, icon, tone, title, body, go) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(newId('n'), userId, n.icon, n.tone, n.title, n.body, n.go ?? '')
    .run();
  const row = await env.DB.prepare('SELECT push_token, prefs FROM users WHERE id = ?').bind(userId).first<{ push_token: string | null; prefs: string }>();
  if (!row?.push_token) return;
  // Safety alerts always go out; messages and booking updates follow the user's settings.
  const prefs = (() => { try { return JSON.parse(row.prefs || '{}'); } catch { return {}; } })() as { pushMessages?: boolean; pushBookings?: boolean };
  const isMessage = (n.go ?? '').startsWith('chat:');
  const isSafety = n.go === 'checkin';
  if (!isSafety && (isMessage ? prefs.pushMessages === false : prefs.pushBookings === false)) return;
  const send = fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ to: row.push_token, title: n.title, body: n.body, data: { go: n.go ?? '' }, sound: 'default' }),
  }).catch(() => undefined);
  if (ctx) ctx.waitUntil(send);
  else await send;
}

/** Sends a login code by email via Resend. Returns false when email isn't configured (dev mode). */
export async function sendLoginEmail(env: Env, to: string, code: string) {
  const subject = `${code} is your ${env.APP_NAME} code`;
  const text = `Your ${env.APP_NAME} login code is ${code}. It expires in 10 minutes. If you didn't ask for it, ignore this email.`;
  if (env.BREVO_API_KEY && env.EMAIL_FROM_ADDRESS) {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: { name: env.APP_NAME, email: env.EMAIL_FROM_ADDRESS }, to: [{ email: to }], subject, textContent: text }),
    });
    return res.ok;
  }
  if (!env.RESEND_API_KEY) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to,
      subject,
      text,
    }),
  });
  return res.ok;
}
