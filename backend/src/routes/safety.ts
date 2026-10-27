import { Hono } from 'hono';
import type { AppEnv, Env } from '../types';
import { notify } from '../lib/notify';
import { digits, fail, newId, now } from '../lib/util';

export const safety = new Hono<AppEnv>();

type Checkin = { id: string; user_id: string; booking_id: string; contact_name: string; every_min: number; next_due: number | null; status: string };

/** Start a safety check-in for a confirmed booking. */
safety.post('/checkins', async (c) => {
  const u = c.get('user');
  const b = await c.req.json<{ bookingId: string; contactName: string; contactPhone: string; share?: boolean; every?: 0 | 30 | 60 }>();
  const bk = await c.env.DB.prepare("SELECT id, starts_at, duration_h FROM bookings WHERE id = ? AND customer_id = ? AND status = 'confirmed'")
    .bind(b.bookingId, u.id).first<{ id: string; starts_at: number; duration_h: number }>();
  if (!bk) fail(404, 'Check-in works for confirmed bookings only.');
  if (!b.contactName?.trim() || !/^\+?[\d ()-]{6,20}$/.test(b.contactPhone ?? '')) fail(400, 'Add a trusted contact with a phone number.');
  const every = [0, 30, 60].includes(b.every ?? 30) ? (b.every ?? 30) : 30;
  const start = Math.max(now(), bk!.starts_at);
  const nextDue = every ? start + every * 60 : bk!.starts_at + bk!.duration_h * 3600;
  const id = newId('ck');
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE checkins SET status = 'ended' WHERE user_id = ? AND status = 'active'").bind(u.id),
    c.env.DB.prepare('INSERT INTO checkins (id, user_id, booking_id, contact_name, contact_phone, share_location, every_min, next_due) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, u.id, bk!.id, b.contactName.trim(), b.contactPhone, b.share === false ? 0 : 1, every, nextDue),
  ]);
  return c.json({ id, nextDue }, 201);
});

async function mine(env: Env, id: string, userId: string) {
  const ck = await env.DB.prepare("SELECT * FROM checkins WHERE id = ? AND user_id = ? AND status IN ('active', 'alerted')").bind(id, userId).first<Checkin>();
  if (!ck) fail(404, 'No active check-in.');
  return ck!;
}

/** "I'm OK": pushes the next check-in out. Optional live location. */
safety.post('/checkins/:id/ok', async (c) => {
  const ck = await mine(c.env, c.req.param('id'), c.get('user').id);
  const loc = await c.req.json<{ lat?: number; lng?: number }>().catch(() => ({}) as { lat?: number; lng?: number });
  const next = ck.every_min ? now() + ck.every_min * 60 : ck.next_due;
  await c.env.DB.prepare("UPDATE checkins SET status = 'active', next_due = ?, last_lat = COALESCE(?, last_lat), last_lng = COALESCE(?, last_lng) WHERE id = ?")
    .bind(next, loc.lat ?? null, loc.lng ?? null, ck.id).run();
  return c.json({ nextDue: next });
});

safety.post('/checkins/:id/end', async (c) => {
  const ck = await mine(c.env, c.req.param('id'), c.get('user').id);
  await c.env.DB.prepare("UPDATE checkins SET status = 'ended' WHERE id = ?").bind(ck.id).run();
  return c.json({ ok: true });
});

/** SOS: flags the check-in for the safety team and (later) alerts the trusted contact by SMS. */
safety.post('/checkins/:id/sos', async (c) => {
  const ck = await mine(c.env, c.req.param('id'), c.get('user').id);
  const loc = await c.req.json<{ lat?: number; lng?: number }>().catch(() => ({}) as { lat?: number; lng?: number });
  await c.env.DB.prepare("UPDATE checkins SET status = 'sos', last_lat = COALESCE(?, last_lat), last_lng = COALESCE(?, last_lng) WHERE id = ?")
    .bind(loc.lat ?? null, loc.lng ?? null, ck.id).run();
  // TODO(sms): text the trusted contact. Admins see SOS events in the admin panel meanwhile.
  return c.json({ ok: true });
});

/** Cron: missed check-ins (10 min grace) are escalated. */
export async function escalateMissedCheckins(env: Env) {
  const r = await env.DB.prepare("SELECT * FROM checkins WHERE status = 'active' AND next_due < ? LIMIT 100").bind(now() - 600).all<Checkin>();
  for (const ck of r.results) {
    await env.DB.prepare("UPDATE checkins SET status = 'alerted' WHERE id = ?").bind(ck.id).run();
    await notify(env, ck.user_id, { icon: 'shield-alert', tone: 'error', title: 'You missed a check-in', body: `Tap “I’m OK” now. Otherwise ${ck.contact_name} gets your booking details.`, go: 'checkin' });
    // TODO(sms): notify the trusted contact.
  }
  return r.results.length;
}

// ---------------- Gifts ----------------

export const gifts = new Hono<AppEnv>();

gifts.post('/', async (c) => {
  const u = c.get('user');
  const { amount, to, message } = await c.req.json<{ amount: number; to: string; message?: string }>();
  if (![50, 100, 150].includes(amount)) fail(400, 'Choose €50, €100 or €150.');
  if (!to?.trim()) fail(400, 'Add your friend’s name or email.');
  const code = 'ZM-' + digits(4) + '-' + digits(4);
  // TODO(payments): charge the sender before issuing the code.
  await c.env.DB.prepare('INSERT INTO gifts (id, sender_id, recipient, amount, message, code, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(newId('g'), u.id, to.trim().slice(0, 120), amount * 100, (message ?? '').slice(0, 140), code, now() + 365 * 86400).run();
  return c.json({ code, amount }, 201);
});
