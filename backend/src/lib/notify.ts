import type { Env } from '../types';
import { broadcast, userChanged } from './live';
import { newId, now } from './util';

type Note = { icon: string; tone: 'violet' | 'success' | 'warning' | 'error' | 'neutral'; title: string; body: string; go?: string };

/** Stores an in-app notification, refreshes the person's open apps and sends an Expo push if they have a push token. */
export async function notify(env: Env, userId: string, n: Note, ctx?: { waitUntil(p: Promise<unknown>): void }) {
  await env.DB.prepare('INSERT INTO notifications (id, user_id, icon, tone, title, body, go) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(newId('n'), userId, n.icon, n.tone, n.title, n.body, n.go ?? '')
    .run();
  const live = userChanged(env, userId, n.go ?? '', ctx);
  if (!ctx) await live;
  const row = await env.DB.prepare('SELECT push_token, prefs FROM users WHERE id = ?').bind(userId).first<{ push_token: string | null; prefs: string }>();
  if (!row?.push_token) return;
  // Safety alerts always go out; messages and booking updates follow the user's settings.
  const prefs = (() => { try { return JSON.parse(row.prefs || '{}'); } catch { return {}; } })() as { pushMessages?: boolean; pushBookings?: boolean };
  const isMessage = (n.go ?? '').startsWith('chat:');
  const isSafety = n.go === 'checkin';
  if (!isSafety && (isMessage ? prefs.pushMessages === false : prefs.pushBookings === false)) return;
  const send = fetch(env.EXPO_PUSH_URL ?? 'https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ to: row.push_token, title: n.title, body: n.body, data: { go: n.go ?? '' }, sound: 'default' }),
  }).catch(() => undefined);
  if (ctx) ctx.waitUntil(send);
  else await send;
}

/** Why someone's phone rings for a video date: the other person joined the call alone, or pinged them from it. */
export type Ring = { bookingId: string; who: string; why: 'join' | 'ping'; endsAt: number };

/**
 * Rings someone for a video date the other person is waiting in: a notification (one per call, each ring replaces the
 * last and puts it on top, unread), a live `ring` event (the open app shows the call, with vibration) and a
 * high-priority push with sound. Rings go out whatever the booking-update setting says: they are the call itself, like
 * a phone ringing, and only happen while it's on.
 */
export async function ring(env: Env, userId: string, r: Ring) {
  const go = `call:${r.bookingId}`, at = now();
  const title = r.why === 'ping' ? `${r.who} is pinging you` : `${r.who} is waiting in your video date`;
  const body = r.why === 'ping' ? 'They’re waiting in your video date. Tap to join.' : 'Tap to join the call.';
  await env.DB.prepare(
    `INSERT INTO notifications (id, user_id, icon, tone, title, body, go, read, created_at) VALUES (?, ?, 'video', 'violet', ?, ?, ?, 0, ?)
     ON CONFLICT (id) DO UPDATE SET title = excluded.title, body = excluded.body, read = 0, created_at = excluded.created_at`,
  ).bind(`n_ring_${r.bookingId}_${userId}`, userId, title, body, go, at).run();
  // `changed` refreshes the notifications (older app versions only know that one); `ring` shows the call. The live
  // event and the push carry the same `at`, so a ring answered or dismissed on one doesn't show again from the other.
  const event = { bookingId: r.bookingId, who: r.who, why: r.why, at, endsAt: r.endsAt };
  await Promise.all([userChanged(env, userId, go), broadcast(env, `user:${userId}`, { type: 'ring', ...event })]);
  const row = await env.DB.prepare('SELECT push_token FROM users WHERE id = ?').bind(userId).first<{ push_token: string | null }>();
  if (!row?.push_token) return;
  await fetch(env.EXPO_PUSH_URL ?? 'https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      to: row.push_token, title, body, data: { go, kind: 'ring', ...event },
      // The channel every app version creates: a push for a channel the installed app never made wouldn't show.
      sound: 'default', priority: 'high',
      // A ring that can't be delivered within a few minutes is of no use (and never after the call has ended).
      ttl: Math.max(30, Math.min(r.endsAt - now(), 300)),
    }),
  }).catch(() => undefined);
}

/** An HTML version and files (content in base64) to send along with the plain text. */
export type MailExtras = { html?: string; attachments?: { name: string; content: string }[] };

/** Sends an email via Brevo (or Resend). Returns false when email isn't configured (dev mode). */
export async function sendEmail(env: Env, to: string, subject: string, text: string, extras: MailExtras = {}) {
  const files = extras.attachments?.length ? extras.attachments : undefined;
  if (env.BREVO_API_KEY && env.EMAIL_FROM_ADDRESS) {
    const res = await fetch(`${env.BREVO_API_BASE ?? 'https://api.brevo.com'}/v3/smtp/email`, {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: env.APP_NAME, email: env.EMAIL_FROM_ADDRESS }, to: [{ email: to }], subject, textContent: text,
        ...(extras.html ? { htmlContent: extras.html } : {}), ...(files ? { attachment: files } : {}),
      }),
    });
    return res.ok;
  }
  if (!env.RESEND_API_KEY) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM, to, subject, text,
      ...(extras.html ? { html: extras.html } : {}), ...(files ? { attachments: files.map((f) => ({ filename: f.name, content: f.content })) } : {}),
    }),
  });
  return res.ok;
}

export async function sendLoginEmail(env: Env, to: string, code: string) {
  return sendEmail(env, to, `${code} is your ${env.APP_NAME} code`,
    `Your ${env.APP_NAME} login code is ${code}. It expires in 10 minutes. If you didn't ask for it, ignore this email.`);
}

/** Safety alert for the team: email to every ADMIN_EMAILS address, plus a push to admins signed in on the app. */
export async function alertAdmins(env: Env, subject: string, text: string, style: Pick<Note, 'icon' | 'tone' | 'go'> = { icon: 'shield-alert', tone: 'error' }) {
  const emails = (env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!emails.length) return;
  const admins = await env.DB.prepare(`SELECT id FROM users WHERE lower(email) IN (${emails.map(() => '?').join(',')})`).bind(...emails).all<{ id: string }>();
  await Promise.all([
    ...emails.map((e) => sendEmail(env, e, subject, text).catch(() => false)),
    ...admins.results.map((a) => notify(env, a.id, { ...style, title: subject, body: text.split('\n')[0].slice(0, 160), go: style.go ?? '' }).catch(() => undefined)),
  ]);
}
