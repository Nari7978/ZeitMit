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

/** Sends a plain-text email via Brevo (or Resend). Returns false when email isn't configured (dev mode). */
export async function sendEmail(env: Env, to: string, subject: string, text: string) {
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
    body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, text }),
  });
  return res.ok;
}

export async function sendLoginEmail(env: Env, to: string, code: string) {
  return sendEmail(env, to, `${code} is your ${env.APP_NAME} code`,
    `Your ${env.APP_NAME} login code is ${code}. It expires in 10 minutes. If you didn't ask for it, ignore this email.`);
}

/** Safety alert for the team: email to every ADMIN_EMAILS address, plus a push to admins signed in on the app. */
export async function alertAdmins(env: Env, subject: string, text: string) {
  const emails = (env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!emails.length) return;
  const admins = await env.DB.prepare(`SELECT id FROM users WHERE lower(email) IN (${emails.map(() => '?').join(',')})`).bind(...emails).all<{ id: string }>();
  await Promise.all([
    ...emails.map((e) => sendEmail(env, e, subject, text).catch(() => false)),
    ...admins.results.map((a) => notify(env, a.id, { icon: 'shield-alert', tone: 'error', title: subject, body: text.split('\n')[0].slice(0, 160), go: '' }).catch(() => undefined)),
  ]);
}
