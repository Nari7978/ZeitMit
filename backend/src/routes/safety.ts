import { Hono } from 'hono';
import type { AppEnv, Env } from '../types';
import { alertAdmins, notify } from '../lib/notify';
import { berlinWhen, digits, fail, newId, now } from '../lib/util';
import { createCheckout, getSession, stripeOn } from '../lib/stripe';

export const safety = new Hono<AppEnv>();

type Checkin = {
  id: string; user_id: string; booking_id: string; contact_name: string; contact_phone: string; share_location: number; every_min: number;
  next_due: number | null; status: string; last_lat: number | null; last_lng: number | null; share_token: string | null;
  last_ok_at: number | null; last_loc_at: number | null; sos_at: number | null; share_base: string | null; created_at: number;
};
type BookingInfo = { id: string; customer_id: string; companion_id: string; starts_at: number; duration_h: number; place: string; customer_name: string; companion_name: string };

const BOOKING_INFO = `SELECT b.id, b.customer_id, b.companion_id, b.starts_at, b.duration_h, b.place, u.name AS customer_name, cp.display_name AS companion_name
  FROM bookings b JOIN users u ON u.id = b.customer_id JOIN companions cp ON cp.user_id = b.companion_id WHERE b.id = ?`;

const token = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 24);
const shareUrl = (ck: Pick<Checkin, 'share_token' | 'share_base'>) => (ck.share_token && ck.share_base ? `${ck.share_base}/t/${ck.share_token}` : null);
const first = (n: string) => (n || '').trim().split(/\s+/)[0] || 'Someone';

/** What the app needs to show (and restore) a running check-in. Works for the customer and the companion side. */
function summary(ck: Checkin, bk: BookingInfo, userId: string) {
  const other = userId === bk.customer_id ? bk.companion_name : first(bk.customer_name);
  return {
    id: ck.id, status: ck.status, every: ck.every_min, nextDue: ck.next_due, share: !!ck.share_location,
    contactName: ck.contact_name, contactPhone: ck.contact_phone, shareUrl: shareUrl(ck),
    otherName: other, place: bk.place, startsAt: bk.starts_at, endsAt: bk.starts_at + bk.duration_h * 3600,
  };
}

/** Start a safety check-in for a confirmed booking (as the customer or as the companion). */
safety.post('/checkins', async (c) => {
  const u = c.get('user');
  const b = await c.req.json<{ bookingId: string; contactName: string; contactPhone: string; share?: boolean; every?: 0 | 30 | 60 }>();
  const bk = await c.env.DB.prepare(`${BOOKING_INFO} AND (b.customer_id = ? OR b.companion_id = ?) AND b.status = 'confirmed'`)
    .bind(b.bookingId, u.id, u.id).first<BookingInfo>();
  if (!bk) fail(404, 'Check-in works for confirmed bookings only.');
  if (!b.contactName?.trim() || !/^\+?[\d ()-]{6,20}$/.test(b.contactPhone ?? '')) fail(400, 'Add a trusted contact with a phone number.');
  const every = [0, 30, 60].includes(b.every ?? 30) ? (b.every ?? 30) : 30;
  const start = Math.max(now(), bk!.starts_at);
  const nextDue = every ? start + every * 60 : bk!.starts_at + bk!.duration_h * 3600;
  const id = newId('ck');
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE checkins SET status = 'ended' WHERE user_id = ? AND status IN ('active', 'alerted', 'sos')").bind(u.id),
    c.env.DB.prepare('INSERT INTO checkins (id, user_id, booking_id, contact_name, contact_phone, share_location, every_min, next_due, share_token, share_base, last_ok_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, u.id, bk!.id, b.contactName.trim().slice(0, 60), b.contactPhone, b.share === false ? 0 : 1, every, nextDue, token(), new URL(c.req.url).origin, now()),
  ]);
  const ck = await c.env.DB.prepare('SELECT * FROM checkins WHERE id = ?').bind(id).first<Checkin>();
  return c.json(summary(ck!, bk!, u.id), 201);
});

/** The running check-in, so the app can bring the check-in bar back after a restart. */
safety.get('/checkins/active', async (c) => {
  const u = c.get('user');
  const ck = await c.env.DB.prepare("SELECT * FROM checkins WHERE user_id = ? AND status IN ('active', 'alerted', 'sos') ORDER BY created_at DESC LIMIT 1").bind(u.id).first<Checkin>();
  if (!ck) return c.json(null);
  const bk = await c.env.DB.prepare(BOOKING_INFO).bind(ck.booking_id).first<BookingInfo>();
  if (!bk) return c.json(null);
  return c.json(summary(ck, bk, u.id));
});

async function mine(env: Env, id: string, userId: string) {
  const ck = await env.DB.prepare("SELECT * FROM checkins WHERE id = ? AND user_id = ? AND status IN ('active', 'alerted', 'sos')").bind(id, userId).first<Checkin>();
  if (!ck) fail(404, 'No active check-in.');
  return ck!;
}

type Loc = { lat?: number; lng?: number };
const validLoc = (l: Loc) => typeof l.lat === 'number' && typeof l.lng === 'number' && Math.abs(l.lat) <= 90 && Math.abs(l.lng) <= 180;

/** "I'm OK": pushes the next check-in out. Optional live location. */
safety.post('/checkins/:id/ok', async (c) => {
  const ck = await mine(c.env, c.req.param('id'), c.get('user').id);
  const loc = await c.req.json<Loc>().catch(() => ({}) as Loc);
  const has = validLoc(loc) && ck.share_location;
  const next = ck.every_min ? now() + ck.every_min * 60 : ck.next_due;
  await c.env.DB.prepare(`UPDATE checkins SET status = 'active', next_due = ?, last_ok_at = ?, sos_at = NULL${has ? ', last_lat = ?, last_lng = ?, last_loc_at = ?' : ''} WHERE id = ?`)
    .bind(...(has ? [next, now(), loc.lat, loc.lng, now(), ck.id] : [next, now(), ck.id])).run();
  return c.json({ nextDue: next });
});

safety.post('/checkins/:id/end', async (c) => {
  const ck = await mine(c.env, c.req.param('id'), c.get('user').id);
  await c.env.DB.prepare("UPDATE checkins SET status = 'ended' WHERE id = ?").bind(ck.id).run();
  return c.json({ ok: true });
});

function alertText(ck: Checkin, bk: BookingInfo | null, who: { name: string; email: string }, what: string) {
  const when = bk ? `${berlinWhen(bk.starts_at).full} for ${bk.duration_h} h` : '';
  return [
    `${what}: ${who.name || who.email} (${who.email})`,
    bk ? `Booking: ${first(bk.customer_name)} with ${bk.companion_name}, ${when}, at ${bk.place}` : '',
    ck.last_lat != null ? `Last location: https://maps.google.com/?q=${ck.last_lat},${ck.last_lng}` : 'No location shared.',
    `Trusted contact: ${ck.contact_name}, ${ck.contact_phone}`,
    shareUrl(ck) ? `Live page: ${shareUrl(ck)}` : '',
    'In an emergency call 112.',
  ].filter(Boolean).join('\n');
}

/** SOS: flags the check-in, stores the location and alerts the ZeitMit team by email and push. */
safety.post('/checkins/:id/sos', async (c) => {
  const u = c.get('user');
  const ck = await mine(c.env, c.req.param('id'), u.id);
  const loc = await c.req.json<Loc>().catch(() => ({}) as Loc);
  const has = validLoc(loc) && ck.share_location;
  await c.env.DB.prepare(`UPDATE checkins SET status = 'sos', sos_at = ?${has ? ', last_lat = ?, last_lng = ?, last_loc_at = ?' : ''} WHERE id = ?`)
    .bind(...(has ? [now(), loc.lat, loc.lng, now(), ck.id] : [now(), ck.id])).run();
  const fresh = (await c.env.DB.prepare('SELECT * FROM checkins WHERE id = ?').bind(ck.id).first<Checkin>())!;
  const bk = await c.env.DB.prepare(BOOKING_INFO).bind(ck.booking_id).first<BookingInfo>();
  const who = (await c.env.DB.prepare('SELECT name, email FROM users WHERE id = ?').bind(u.id).first<{ name: string; email: string }>())!;
  c.executionCtx.waitUntil(alertAdmins(c.env, `SOS from ${who.name || who.email}`, alertText(fresh, bk, who, 'SOS pressed')));
  return c.json({ ok: true });
});

/** Live location while a check-in is running (only stored when sharing is on). */
safety.post('/checkins/:id/location', async (c) => {
  const ck = await mine(c.env, c.req.param('id'), c.get('user').id);
  const loc = await c.req.json<Loc>();
  if (!validLoc(loc)) fail(400, 'Invalid location.');
  await c.env.DB.prepare('UPDATE checkins SET last_lat = ?, last_lng = ?, last_loc_at = ? WHERE id = ? AND share_location = 1').bind(loc.lat, loc.lng, now(), ck.id).run();
  return c.json({ ok: true });
});

/** Cron: missed check-ins (10 min grace) are escalated: push to the person, email to the ZeitMit team. */
export async function escalateMissedCheckins(env: Env) {
  const r = await env.DB.prepare("SELECT * FROM checkins WHERE status = 'active' AND next_due < ? LIMIT 100").bind(now() - 600).all<Checkin>();
  for (const ck of r.results) {
    await env.DB.prepare("UPDATE checkins SET status = 'alerted' WHERE id = ?").bind(ck.id).run();
    await notify(env, ck.user_id, { icon: 'shield-alert', tone: 'error', title: 'You missed a check-in', body: `Tap “I’m OK” now. ${ck.contact_name} can see on your live page that you missed it.`, go: 'checkin' });
    const bk = await env.DB.prepare(BOOKING_INFO).bind(ck.booking_id).first<BookingInfo>();
    const who = await env.DB.prepare('SELECT name, email FROM users WHERE id = ?').bind(ck.user_id).first<{ name: string; email: string }>();
    if (who) await alertAdmins(env, `Missed check-in: ${who.name || who.email}`, alertText(ck, bk, who, 'Missed check-in'));
  }
  return r.results.length;
}

/** Ends check-ins 12 hours after their booking, so live links stop showing anything. */
export async function endOldCheckins(env: Env) {
  await env.DB.prepare(
    "UPDATE checkins SET status = 'ended' WHERE status IN ('active', 'alerted') AND booking_id IN (SELECT id FROM bookings WHERE starts_at + duration_h * 3600 < ?)",
  ).bind(now() - 12 * 3600).run();
}

/** Public live page data for the trusted contact (by private token). */
export async function liveCheckin(env: Env, t: string) {
  if (!/^[a-z0-9]{12,40}$/.test(t)) return null;
  const ck = await env.DB.prepare('SELECT * FROM checkins WHERE share_token = ?').bind(t).first<Checkin>();
  if (!ck) return null;
  const bk = await env.DB.prepare(BOOKING_INFO).bind(ck.booking_id).first<BookingInfo>();
  if (!bk) return null;
  const self = ck.user_id === bk.customer_id ? first(bk.customer_name) : bk.companion_name;
  const other = ck.user_id === bk.customer_id ? bk.companion_name : first(bk.customer_name);
  return { ck, bk, self, other };
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
