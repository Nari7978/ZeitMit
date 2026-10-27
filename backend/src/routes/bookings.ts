import { Hono } from 'hono';
import type { AppEnv, Env } from '../types';
import { ACT_LABEL, ACTIVITIES, ROMANTIC, SERVICE_FEE, type ActId } from '../types';
import { berlinToUnix, slotsFor } from '../lib/companions';
import { notify } from '../lib/notify';
import { berlinWhen, digits, euros, fail, newId, now, parseJson, safeEqual } from '../lib/util';

type BookingRow = {
  id: string; customer_id: string; companion_id: string; activity: ActId; starts_at: number; duration_h: number;
  place: string; note: string; status: 'pending' | 'confirmed' | 'completed' | 'cancelled'; cancel_note: string | null;
  rate: number; subtotal: number; fee: number; total: number; pay_status: 'held' | 'released' | 'refunded';
  meet_code: string; code_attempts: number; reviewed: number; created_at: number;
};

/** Booking as the customer sees it (includes the meet code). */
const forCustomer = (b: BookingRow & { companion_name?: string; hue?: number }) => ({
  id: b.id, cid: b.companion_id, companionName: b.companion_name, hue: b.hue, act: b.activity, startsAt: b.starts_at,
  ...berlinWhen(b.starts_at), dur: b.duration_h, place: b.place, note: b.cancel_note ?? undefined, status: b.status,
  pay: b.pay_status, total: b.total, otp: b.status === 'confirmed' ? b.meet_code : undefined, reviewed: !!b.reviewed,
});

/** Booking as the companion sees it (never includes the meet code). */
const forCompanion = (b: BookingRow & { customer_name?: string }) => ({
  id: b.id, who: b.customer_name || 'Customer', customerId: b.customer_id, act: b.activity, startsAt: b.starts_at,
  ...berlinWhen(b.starts_at), dur: b.duration_h, place: b.place, note: b.note, status: b.status, pay: b.pay_status,
  payout: b.subtotal,
});

async function load(env: Env, id: string) {
  const b = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first<BookingRow>();
  if (!b) fail(404, 'Booking not found.');
  return b!;
}

/** Links (or creates) the chat between customer and companion to a booking. */
async function linkConversation(env: Env, b: Pick<BookingRow, 'id' | 'customer_id' | 'companion_id'>) {
  await env.DB.prepare(
    `INSERT INTO conversations (id, customer_id, companion_id, booking_id) VALUES (?, ?, ?, ?)
     ON CONFLICT (customer_id, companion_id) DO UPDATE SET booking_id = excluded.booking_id`,
  ).bind(newId('cv'), b.customer_id, b.companion_id, b.id).run();
}

// ---------------- Customer ----------------

export const bookings = new Hono<AppEnv>();

bookings.get('/', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT b.*, c.display_name AS companion_name, c.hue FROM bookings b JOIN companions c ON c.user_id = b.companion_id
     WHERE b.customer_id = ? ORDER BY b.starts_at DESC LIMIT 200`,
  ).bind(c.get('user').id).all<BookingRow & { companion_name: string; hue: number }>();
  return c.json(r.results.map(forCustomer));
});

/**
 * Creates a request and (in test mode) marks the payment as held by ZeitMit.
 * Body: { companionId, act, date: 'YYYY-MM-DD', time: 'HH:MM', dur, place, note?, boundariesAgreed? }
 */
bookings.post('/', async (c) => {
  const u = c.get('user');
  const b = await c.req.json<{ companionId: string; act: ActId; date: string; time: string; dur: number; place: string; note?: string; boundariesAgreed?: boolean }>();
  const age = await c.env.DB.prepare('SELECT age_confirmed, name FROM users WHERE id = ?').bind(u.id).first<{ age_confirmed: number; name: string }>();
  if (!age?.age_confirmed) fail(403, 'Confirm you’re 18 or older before booking.');
  const comp = await c.env.DB.prepare("SELECT user_id, display_name, rate, activities FROM companions WHERE user_id = ? AND status = 'approved'")
    .bind(b.companionId)
    .first<{ user_id: string; display_name: string; rate: number; activities: string }>();
  if (!comp) fail(404, 'This companion isn’t available.');
  if (comp!.user_id === u.id) fail(400, 'You can’t book yourself.');
  const blocked = await c.env.DB.prepare('SELECT 1 FROM blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)')
    .bind(u.id, comp!.user_id, comp!.user_id, u.id).first();
  if (blocked) fail(403, 'You can’t book this companion.');
  if (!ACTIVITIES.includes(b.act) || !parseJson<string[]>(comp!.activities, []).includes(b.act)) fail(400, `${comp!.display_name} doesn’t offer that activity.`);
  if (![1, 2, 3, 4].includes(b.dur)) fail(400, 'Choose 1 to 4 hours.');
  const place = (b.place ?? '').trim();
  if (!place) fail(400, 'Add a public meeting place to continue.');
  if (ROMANTIC.includes(b.act) && !b.boundariesAgreed) fail(400, `Please agree to respect ${comp!.display_name}’s boundaries.`);

  const slots = await slotsFor(c.env, comp!.user_id);
  if (!slots.some((d) => d.date === b.date && d.times.includes(b.time))) fail(409, 'That time was just taken. Pick another slot.');

  const startsAt = berlinToUnix(b.date, b.time);
  const subtotal = comp!.rate * b.dur * 100;
  const fee = Math.round(subtotal * SERVICE_FEE);
  const id = newId('bk');
  // TODO(payments): create a Stripe PaymentIntent with manual capture here; until then payment is simulated as held.
  await c.env.DB.prepare(
    `INSERT INTO bookings (id, customer_id, companion_id, activity, starts_at, duration_h, place, note, boundaries_agreed, rate, subtotal, fee, total, meet_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, u.id, comp!.user_id, b.act, startsAt, b.dur, place.slice(0, 160), (b.note ?? '').slice(0, 240), b.boundariesAgreed ? 1 : 0, comp!.rate * 100, subtotal, fee, subtotal + fee, digits(4)).run();
  await linkConversation(c.env, { id, customer_id: u.id, companion_id: comp!.user_id });

  const when = berlinWhen(startsAt);
  await notify(c.env, u.id, { icon: 'hourglass', tone: 'warning', title: 'Request sent to ' + comp!.display_name, body: `${ACT_LABEL[b.act]} on ${when.day}. ${comp!.display_name} has 24 hours to respond.`, go: 'tab:pending' }, c.executionCtx);
  await notify(c.env, comp!.user_id, { icon: 'inbox', tone: 'violet', title: 'New booking request', body: `${age!.name || 'A customer'} · ${ACT_LABEL[b.act]} · ${when.full}. ${euros(subtotal)} is already paid and held.`, go: 'comp:requests' }, c.executionCtx);
  return c.json(forCustomer({ ...(await load(c.env, id)), companion_name: comp!.display_name }), 201);
});

/** Customer cancels: pending any time, confirmed up to 24h before. Both refund in full. */
bookings.post('/:id/cancel', async (c) => {
  const u = c.get('user');
  const b = await load(c.env, c.req.param('id'));
  if (b.customer_id !== u.id) fail(404, 'Booking not found.');
  if (b.status !== 'pending' && b.status !== 'confirmed') fail(409, 'This booking can’t be cancelled.');
  if (b.status === 'confirmed' && b.starts_at - now() < 24 * 3600) fail(409, 'Free cancellation ends 24 hours before the booking. Contact support.');
  // TODO(payments): refund / cancel the Stripe PaymentIntent.
  await c.env.DB.prepare("UPDATE bookings SET status = 'cancelled', pay_status = 'refunded', cancel_note = ?, updated_at = unixepoch() WHERE id = ?")
    .bind(`Cancelled by you · ${euros(b.total)} refunded in full`, b.id).run();
  await notify(c.env, b.companion_id, { icon: 'calendar-x', tone: 'error', title: 'Booking cancelled', body: `${ACT_LABEL[b.activity]} on ${berlinWhen(b.starts_at).day} was cancelled by the customer.`, go: 'comp:calendar' }, c.executionCtx);
  return c.json({ ok: true, refunded: b.total });
});

bookings.post('/:id/review', async (c) => {
  const u = c.get('user');
  const { stars, text } = await c.req.json<{ stars: number; text?: string }>();
  const b = await load(c.env, c.req.param('id'));
  if (b.customer_id !== u.id) fail(404, 'Booking not found.');
  if (b.status !== 'completed') fail(409, 'You can review after the booking is completed.');
  if (b.reviewed) fail(409, 'You already reviewed this booking.');
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) fail(400, 'Choose 1 to 5 stars.');
  const name = (await c.env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(u.id).first<{ name: string }>())?.name || 'ZeitMit member';
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO reviews (id, booking_id, companion_id, author_name, activity, stars, text) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(newId('rv'), b.id, b.companion_id, name.split(' ')[0], ACT_LABEL[b.activity], stars, (text ?? '').slice(0, 300)),
    c.env.DB.prepare('UPDATE bookings SET reviewed = 1 WHERE id = ?').bind(b.id),
    c.env.DB.prepare(
      `UPDATE companions SET review_count = (SELECT COUNT(*) FROM reviews WHERE companion_id = ?1),
         rating = CASE WHEN (SELECT COUNT(*) FROM reviews WHERE companion_id = ?1) >= 3
                       THEN ROUND((SELECT AVG(stars) FROM reviews WHERE companion_id = ?1), 1) ELSE NULL END
       WHERE user_id = ?1`,
    ).bind(b.companion_id),
  ]);
  return c.json({ ok: true });
});

// ---------------- Companion side ----------------

export const companionBookings = new Hono<AppEnv>();

companionBookings.get('/', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT b.*, u.name AS customer_name FROM bookings b JOIN users u ON u.id = b.customer_id
     WHERE b.companion_id = ? ORDER BY b.starts_at LIMIT 200`,
  ).bind(c.get('user').id).all<BookingRow & { customer_name: string }>();
  const all = r.results.map(forCompanion);
  const held = r.results.filter((b) => b.status === 'confirmed' && b.pay_status === 'held').reduce((a, b) => a + b.subtotal, 0);
  const released = r.results.filter((b) => b.pay_status === 'released').reduce((a, b) => a + b.subtotal, 0);
  return c.json({
    requests: all.filter((b) => b.status === 'pending'),
    upcoming: all.filter((b) => b.status === 'confirmed'),
    done: all.filter((b) => b.status === 'completed'),
    earnings: { held, released, releasedCount: r.results.filter((b) => b.pay_status === 'released').length },
  });
});

async function own(c: { env: Env; get: (k: 'user') => { id: string } }, id: string) {
  const b = await load(c.env, id);
  if (b.companion_id !== c.get('user').id) fail(404, 'Booking not found.');
  return b;
}

companionBookings.post('/:id/accept', async (c) => {
  const b = await own(c, c.req.param('id'));
  if (b.status !== 'pending') fail(409, 'This request was already handled.');
  const clash = await c.env.DB.prepare(
    "SELECT 1 FROM bookings WHERE companion_id = ? AND status = 'confirmed' AND id != ? AND starts_at < ? AND starts_at + duration_h * 3600 > ?",
  ).bind(b.companion_id, b.id, b.starts_at + b.duration_h * 3600, b.starts_at).first();
  if (clash) fail(409, 'You already have a confirmed booking at that time.');
  await c.env.DB.prepare("UPDATE bookings SET status = 'confirmed', updated_at = unixepoch() WHERE id = ?").bind(b.id).run();
  const name = (await c.env.DB.prepare('SELECT display_name FROM companions WHERE user_id = ?').bind(b.companion_id).first<{ display_name: string }>())!.display_name;
  await notify(c.env, b.customer_id, { icon: 'calendar-check', tone: 'success', title: 'Booking accepted', body: `${name} accepted your ${ACT_LABEL[b.activity].toLowerCase()} request.`, go: 'tab:upcoming' }, c.executionCtx);
  return c.json({ ok: true });
});

companionBookings.post('/:id/decline', async (c) => {
  const b = await own(c, c.req.param('id'));
  if (b.status !== 'pending') fail(409, 'This request was already handled.');
  // TODO(payments): cancel the Stripe PaymentIntent so the customer is never charged.
  await c.env.DB.prepare("UPDATE bookings SET status = 'cancelled', pay_status = 'refunded', cancel_note = ?, updated_at = unixepoch() WHERE id = ?")
    .bind(`Declined · ${euros(b.total)} refunded in full`, b.id).run();
  const name = (await c.env.DB.prepare('SELECT display_name FROM companions WHERE user_id = ?').bind(b.companion_id).first<{ display_name: string }>())!.display_name;
  await notify(c.env, b.customer_id, { icon: 'receipt', tone: 'neutral', title: `${name} can’t make it`, body: `Your request was declined. ${euros(b.total)} is refunded in full.`, go: 'tab:cancelled' }, c.executionCtx);
  return c.json({ ok: true });
});

/** Companion enters the customer's 4-digit meet code at the meet-up: releases the held payment. */
companionBookings.post('/:id/verify-code', async (c) => {
  const b = await own(c, c.req.param('id'));
  const { code } = await c.req.json<{ code?: string }>();
  if (b.status !== 'confirmed' || b.pay_status !== 'held') fail(409, 'This booking isn’t waiting for a code.');
  if (b.starts_at - now() > 2 * 3600) fail(409, 'You can enter the code once you meet (up to 2 hours before the start).');
  if (b.code_attempts >= 5) fail(429, 'Too many wrong codes. Contact support to release this payment.');
  if (!safeEqual(String(code ?? ''), b.meet_code)) {
    await c.env.DB.prepare('UPDATE bookings SET code_attempts = code_attempts + 1 WHERE id = ?').bind(b.id).run();
    fail(400, 'That code doesn’t match. Check with your customer and try again.');
  }
  // TODO(payments): capture the PaymentIntent and transfer `subtotal` to the companion's connected account.
  await c.env.DB.prepare("UPDATE bookings SET status = 'completed', pay_status = 'released', updated_at = unixepoch() WHERE id = ?").bind(b.id).run();
  await c.env.DB.prepare("UPDATE checkins SET status = 'ended' WHERE booking_id = ? AND status = 'active'").bind(b.id).run();
  const name = (await c.env.DB.prepare('SELECT display_name FROM companions WHERE user_id = ?').bind(b.companion_id).first<{ display_name: string }>())!.display_name;
  await notify(c.env, b.customer_id, { icon: 'wallet', tone: 'success', title: 'Payment released to ' + name, body: `Meet code confirmed. ${euros(b.total)} sent from ZeitMit.`, go: 'tab:completed' }, c.executionCtx);
  return c.json({ ok: true, released: b.subtotal });
});

/** Cron: requests unanswered for 24h are cancelled and refunded. */
export async function expirePending(env: Env) {
  const r = await env.DB.prepare("SELECT * FROM bookings WHERE status = 'pending' AND (created_at < ? OR starts_at < ?) LIMIT 200")
    .bind(now() - 24 * 3600, now()).all<BookingRow>();
  for (const b of r.results) {
    await env.DB.prepare("UPDATE bookings SET status = 'cancelled', pay_status = 'refunded', cancel_note = ?, updated_at = unixepoch() WHERE id = ? AND status = 'pending'")
      .bind(`No reply in time · ${euros(b.total)} refunded in full`, b.id).run();
    await notify(env, b.customer_id, { icon: 'receipt', tone: 'neutral', title: 'Request expired', body: `No reply in time, so ${euros(b.total)} is refunded in full.`, go: 'tab:cancelled' });
  }
  return r.results.length;
}
