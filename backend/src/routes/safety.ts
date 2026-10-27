import { Hono } from 'hono';
import type { AppEnv, Env } from '../types';
import { notify } from '../lib/notify';
import { digits, fail, newId, now } from '../lib/util';
import { createCheckout, getSession, stripeOn } from '../lib/stripe';

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
  const id = newId('g');
  const paidNow = !stripeOn(c.env); // without Stripe, gifts are free test credit
  await c.env.DB.prepare('INSERT INTO gifts (id, sender_id, recipient, amount, message, code, expires_at, paid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, u.id, to.trim().slice(0, 120), amount * 100, (message ?? '').slice(0, 140), code, now() + 365 * 86400, paidNow ? 1 : 0).run();
  if (paidNow) return c.json({ id, code, amount }, 201);
  try {
    const s = await createCheckout(c.env, { amount: amount * 100, name: `ZeitMit gift for ${to.trim().slice(0, 40)}`, ref: id, kind: 'gift', origin: new URL(c.req.url).origin, email: u.email });
    await c.env.DB.prepare('UPDATE gifts SET payment_ref = ? WHERE id = ?').bind(s.id, id).run();
    return c.json({ id, amount, checkoutUrl: s.url }, 201);
  } catch (e) {
    console.error('Gift checkout failed', e);
    await c.env.DB.prepare('DELETE FROM gifts WHERE id = ?').bind(id).run();
    fail(409, 'The payment couldn’t start. Please try again in a moment.');
  }
});

/** After Stripe Checkout: reveals the gift code once the payment went through. */
gifts.post('/:id/confirm-payment', async (c) => {
  const g = await c.env.DB.prepare('SELECT id, code, amount, paid, payment_ref FROM gifts WHERE id = ? AND sender_id = ?').bind(c.req.param('id'), c.get('user').id)
    .first<{ id: string; code: string; amount: number; paid: number; payment_ref: string | null }>();
  if (!g) fail(404, 'Gift not found.');
  if (!g!.paid) {
    const s = g!.payment_ref && stripeOn(c.env) ? await getSession(c.env, g!.payment_ref) : null;
    if (s?.payment_status !== 'paid') return c.json({ paid: false }, 402);
    await c.env.DB.prepare('UPDATE gifts SET paid = 1 WHERE id = ?').bind(g!.id).run();
  }
  return c.json({ paid: true, code: g!.code, amount: g!.amount / 100 });
});

/** Redeem a gift code into account credit (used automatically on the next bookings). */
gifts.post('/redeem', async (c) => {
  const u = c.get('user');
  const { code } = await c.req.json<{ code?: string }>();
  const norm = (code ?? '').trim().toUpperCase().replace(/\s+/g, '');
  const g = await c.env.DB.prepare('SELECT id, sender_id, amount, redeemed_by, expires_at, paid FROM gifts WHERE code = ?').bind(norm)
    .first<{ id: string; sender_id: string; amount: number; redeemed_by: string | null; expires_at: number; paid: number }>();
  if (!g || !g.paid) fail(404, 'That gift code doesn’t exist. Check the spelling.');
  if (g!.redeemed_by) fail(409, 'This gift code was already used.');
  if (g!.expires_at < now()) fail(409, 'This gift code has expired.');
  if (g!.sender_id === u.id) fail(400, 'You can’t redeem a gift you sent. Share the code with your friend.');
  const res = await c.env.DB.prepare('UPDATE gifts SET redeemed_by = ?, redeemed_at = unixepoch() WHERE id = ? AND redeemed_by IS NULL').bind(u.id, g!.id).run();
  if (!res.meta.changes) fail(409, 'This gift code was already used.');
  await c.env.DB.prepare('UPDATE users SET credit = credit + ? WHERE id = ?').bind(g!.amount, u.id).run();
  const bal = await c.env.DB.prepare('SELECT credit FROM users WHERE id = ?').bind(u.id).first<{ credit: number }>();
  return c.json({ added: g!.amount, credit: bal?.credit ?? g!.amount });
});

/** Live location while a check-in is running (only stored when sharing is on). */
safety.post('/checkins/:id/location', async (c) => {
  const ck = await mine(c.env, c.req.param('id'), c.get('user').id);
  const { lat, lng } = await c.req.json<{ lat?: number; lng?: number }>();
  if (typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180) fail(400, 'Invalid location.');
  await c.env.DB.prepare('UPDATE checkins SET last_lat = ?, last_lng = ? WHERE id = ? AND share_location = 1').bind(lat, lng, ck.id).run();
  return c.json({ ok: true });
});
