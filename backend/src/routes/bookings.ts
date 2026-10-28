import { Hono } from 'hono';
import type { AppEnv, Env } from '../types';
import { ACT_LABEL, ACTIVITIES, ROMANTIC, SERVICE_FEE, type ActId } from '../types';
import { berlinToUnix, slotsFor } from '../lib/companions';
import { notify } from '../lib/notify';
import { berlinWhen, digits, euros, fail, newId, now, parseJson, safeEqual } from '../lib/util';
import { cancelIntent, capture, createCheckout, getSession, intentOf, stripeOn } from '../lib/stripe';

type BookingRow = {
  id: string; customer_id: string; companion_id: string; activity: ActId; starts_at: number; duration_h: number;
  place: string; note: string; status: 'pending' | 'confirmed' | 'completed' | 'cancelled'; cancel_note: string | null;
  rate: number; subtotal: number; fee: number; total: number; pay_status: 'held' | 'released' | 'refunded';
  meet_code: string; code_attempts: number; reviewed: number; created_at: number; credit_used: number; payment_ref: string | null; paid: number; checkout_url: string | null;
};

/** Booking as the customer sees it (includes the meet code). */
const forCustomer = (b: BookingRow & { companion_name?: string; hue?: number; photo_id?: string | null }) => ({
  id: b.id, cid: b.companion_id, companionName: b.companion_name, hue: b.hue, photoUrl: b.photo_id ? `/photos/${b.photo_id}` : null, act: b.activity, startsAt: b.starts_at,
  ...berlinWhen(b.starts_at), dur: b.duration_h, place: b.place, note: b.cancel_note ?? undefined, status: b.status,
  pay: b.pay_status, total: b.total, creditUsed: b.credit_used, otp: b.status === 'confirmed' ? b.meet_code : undefined, reviewed: !!b.reviewed,
});

/** Booking as the companion sees it (never includes the meet code). */
type CustomerInfo = { customer_name?: string; avatar_id?: string | null; customer_bio?: string | null; customer_id_status?: string; customer_since?: number };
const forCompanion = (b: BookingRow & CustomerInfo) => ({
  id: b.id, who: b.customer_name || 'Customer', customerId: b.customer_id, avatarUrl: b.avatar_id ? `/photos/${b.avatar_id}` : null, act: b.activity, startsAt: b.starts_at,
  // What a companion may know about who is booking: never the email or documents.
  customer: { bio: b.customer_bio ?? '', verified: b.customer_id_status === 'approved', since: b.customer_since ?? null },
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

/**
 * Cancels a booking and returns the money: gift credit goes back to the account, the card part is refunded.
 * Returns false if the booking was no longer refundable (e.g. a concurrent update).
 */
export async function refundBooking(env: Env, b: BookingRow, note: (amount: string) => string, onlyIfPending = false) {
  const res = await env.DB.prepare(
    `UPDATE bookings SET status = 'cancelled', pay_status = 'refunded', cancel_note = ?, updated_at = unixepoch()
     WHERE id = ? AND pay_status = 'held' ${onlyIfPending ? "AND status = 'pending'" : ''}`,
  ).bind(note(euros(b.total)), b.id).run();
  if (!res.meta.changes) return false;
  if (b.credit_used) await env.DB.prepare('UPDATE users SET credit = credit + ? WHERE id = ?').bind(b.credit_used, b.customer_id).run();
  // The card part was only authorised (manual capture), so releasing the hold means it's never charged.
  if (b.payment_ref?.startsWith('pi_') && stripeOn(env)) {
    try {
      await cancelIntent(env, b.payment_ref);
    } catch (e) {
      console.error('Stripe cancel failed for', b.id, e);
    }
  }
  return true;
}

/** Tells customer and companion about a new (paid) request. */
async function announceBooking(env: Env, id: string, ctx?: { waitUntil(p: Promise<unknown>): void }) {
  const b = await env.DB.prepare(
    `SELECT b.*, c.display_name AS companion_name, u.name AS customer_name FROM bookings b
     JOIN companions c ON c.user_id = b.companion_id JOIN users u ON u.id = b.customer_id WHERE b.id = ?`,
  ).bind(id).first<BookingRow & { companion_name: string; customer_name: string }>();
  if (!b) return;
  await linkConversation(env, b);
  const when = berlinWhen(b.starts_at);
  await notify(env, b.customer_id, { icon: 'hourglass', tone: 'warning', title: 'Request sent to ' + b.companion_name, body: `${ACT_LABEL[b.activity]} on ${when.day}. ${b.companion_name} has 24 hours to respond.`, go: 'tab:pending' }, ctx);
  await notify(env, b.companion_id, { icon: 'inbox', tone: 'violet', title: 'New booking request', body: `${b.customer_name || 'A customer'} · ${ACT_LABEL[b.activity]} · ${when.full}. ${euros(b.subtotal)} is already paid and held.`, go: 'comp:requests' }, ctx);
}

/** Marks a booking paid if its Checkout session went through. Returns true when paid. */
async function settleCheckout(env: Env, b: BookingRow, ctx?: { waitUntil(p: Promise<unknown>): void }) {
  if (b.paid) return true;
  if (!b.payment_ref?.startsWith('cs_') || !stripeOn(env)) return false;
  const pi = intentOf(await getSession(env, b.payment_ref));
  if (!pi || !['requires_capture', 'succeeded'].includes(pi.status)) return false;
  const res = await env.DB.prepare('UPDATE bookings SET paid = 1, payment_ref = ?, checkout_url = NULL, updated_at = unixepoch() WHERE id = ? AND paid = 0').bind(pi.id, b.id).run();
  if (res.meta.changes) await announceBooking(env, b.id, ctx);
  return true;
}

// ---------------- Customer ----------------

export const bookings = new Hono<AppEnv>();

bookings.get('/', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT b.*, c.display_name AS companion_name, c.hue, c.photo_id FROM bookings b JOIN companions c ON c.user_id = b.companion_id
     WHERE b.customer_id = ? AND b.paid = 1 ORDER BY b.starts_at DESC LIMIT 200`,
  ).bind(c.get('user').id).all<BookingRow & { companion_name: string; hue: number }>();
  return c.json(r.results.map(forCustomer));
});

/**
 * Creates a request and (in test mode) marks the payment as held by ZeitMit.
 * Body: { companionId, act, date: 'YYYY-MM-DD', time: 'HH:MM', dur, place, note?, boundariesAgreed? }
 */
bookings.post('/', async (c) => {
  const u = c.get('user');
  const b = await c.req.json<{ companionId: string; act: ActId; date: string; time: string; dur: number; place: string; note?: string; boundariesAgreed?: boolean; useCredit?: boolean }>();
  const age = await c.env.DB.prepare('SELECT age_confirmed, name, id_status FROM users WHERE id = ?').bind(u.id).first<{ age_confirmed: number; name: string; id_status: string }>();
  if (!age?.age_confirmed) fail(403, 'Confirm you’re 18 or older before booking.');
  if (age!.id_status !== 'approved') fail(403, 'Verify your ID before your first booking.');
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
  const total = subtotal + fee;
  // Gift credit is applied first; the rest is charged to the card.
  let creditUsed = 0;
  if (b.useCredit !== false) {
    const bal = (await c.env.DB.prepare('SELECT credit FROM users WHERE id = ?').bind(u.id).first<{ credit: number }>())?.credit ?? 0;
    creditUsed = Math.min(bal, total);
    if (creditUsed) {
      const taken = await c.env.DB.prepare('UPDATE users SET credit = credit - ? WHERE id = ? AND credit >= ?').bind(creditUsed, u.id, creditUsed).run();
      if (!taken.meta.changes) creditUsed = 0;
    }
  }
  // TODO(payments): create a Stripe PaymentIntent with manual capture for (total - creditUsed); until then it's simulated as held.
  await c.env.DB.prepare(
    `INSERT INTO bookings (id, customer_id, companion_id, activity, starts_at, duration_h, place, note, boundaries_agreed, rate, subtotal, fee, total, meet_code, credit_used)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, u.id, comp!.user_id, b.act, startsAt, b.dur, place.slice(0, 160), (b.note ?? '').slice(0, 240), b.boundariesAgreed ? 1 : 0, comp!.rate * 100, subtotal, fee, total, digits(4), creditUsed).run();
  // Card part goes through Stripe Checkout; the request reaches the companion once it's paid.
  const due = total - creditUsed;
  if (stripeOn(c.env) && due > 0) {
    try {
      const s = await createCheckout(c.env, { amount: due, name: `${ACT_LABEL[b.act]} with ${comp!.display_name}`, ref: id, kind: 'booking', origin: new URL(c.req.url).origin, email: u.email });
      await c.env.DB.prepare('UPDATE bookings SET paid = 0, payment_ref = ?, checkout_url = ? WHERE id = ?').bind(s.id, s.url, id).run();
      return c.json({ ...forCustomer({ ...(await load(c.env, id)), companion_name: comp!.display_name }), checkoutUrl: s.url }, 201);
    } catch (e) {
      console.error('Checkout failed', e);
      await c.env.DB.batch([
        c.env.DB.prepare('UPDATE conversations SET booking_id = NULL WHERE booking_id = ?').bind(id),
        c.env.DB.prepare('DELETE FROM bookings WHERE id = ?').bind(id),
        c.env.DB.prepare('UPDATE users SET credit = credit + ? WHERE id = ?').bind(creditUsed, u.id),
      ]);
      fail(409, 'The payment couldn’t start. Please try again in a moment.');
    }
  }
  await announceBooking(c.env, id, c.executionCtx);
  return c.json(forCustomer({ ...(await load(c.env, id)), companion_name: comp!.display_name }), 201);
});

/** After Stripe Checkout: confirms the payment and sends the request to the companion. */
bookings.post('/:id/confirm-payment', async (c) => {
  const b = await load(c.env, c.req.param('id'));
  if (b.customer_id !== c.get('user').id) fail(404, 'Booking not found.');
  let paid = false;
  try {
    paid = await settleCheckout(c.env, b, c.executionCtx);
  } catch (e) {
    console.error(e);
    fail(409, 'We couldn’t check the payment yet. Please try again in a moment.');
  }
  if (!paid) return c.json({ paid: false, checkoutUrl: b.checkout_url }, 402);
  const row = await c.env.DB.prepare('SELECT b.*, c.display_name AS companion_name, c.hue, c.photo_id FROM bookings b JOIN companions c ON c.user_id = b.companion_id WHERE b.id = ?')
    .bind(b.id).first<BookingRow & { companion_name: string; hue: number; photo_id: string | null }>();
  return c.json({ paid: true, booking: forCustomer(row!) });
});

/** Customer cancels: pending any time, confirmed up to 24h before. Both refund in full. */
bookings.post('/:id/cancel', async (c) => {
  const u = c.get('user');
  const b = await load(c.env, c.req.param('id'));
  if (b.customer_id !== u.id) fail(404, 'Booking not found.');
  if (b.status !== 'pending' && b.status !== 'confirmed') fail(409, 'This booking can’t be cancelled.');
  if (b.status === 'confirmed' && b.starts_at - now() < 24 * 3600) fail(409, 'Free cancellation ends 24 hours before the booking. Contact support.');
  if (!(await refundBooking(c.env, b, (amt) => `Cancelled by you · ${amt} refunded in full`))) fail(409, 'This booking can’t be cancelled.');
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
    `SELECT b.*, u.name AS customer_name, u.avatar_id, u.bio AS customer_bio, u.id_status AS customer_id_status, u.created_at AS customer_since
     FROM bookings b JOIN users u ON u.id = b.customer_id
     WHERE b.companion_id = ? AND b.paid = 1 ORDER BY b.starts_at LIMIT 200`,
  ).bind(c.get('user').id).all<BookingRow & CustomerInfo>();
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
  if (!(await refundBooking(c.env, b, (amt) => `Declined · ${amt} refunded in full`, true))) fail(409, 'This request was already handled.');
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
  if (b.payment_ref?.startsWith('pi_') && stripeOn(c.env)) {
    try {
      await capture(c.env, b.payment_ref);
    } catch (e) {
      console.error('Capture failed', b.id, e);
      fail(409, 'The code is right, but the payment couldn’t be taken. ZeitMit support has been notified.');
    }
  }
  // TODO(payouts): transfer `subtotal` to the companion (Stripe Connect) — until then payouts are made manually.
  await c.env.DB.prepare("UPDATE bookings SET status = 'completed', pay_status = 'released', updated_at = unixepoch() WHERE id = ?").bind(b.id).run();
  await c.env.DB.prepare("UPDATE checkins SET status = 'ended' WHERE booking_id = ? AND status = 'active'").bind(b.id).run();
  const name = (await c.env.DB.prepare('SELECT display_name FROM companions WHERE user_id = ?').bind(b.companion_id).first<{ display_name: string }>())!.display_name;
  await notify(c.env, b.customer_id, { icon: 'wallet', tone: 'success', title: 'Payment released to ' + name, body: `Meet code confirmed. ${euros(b.total)} sent from ZeitMit.`, go: 'tab:completed' }, c.executionCtx);
  return c.json({ ok: true, released: b.subtotal });
});

/** Cron: checkouts abandoned for 35 min free their slot (and any gift credit), unless they turn out paid. */
export async function expireUnpaid(env: Env) {
  const r = await env.DB.prepare('SELECT * FROM bookings WHERE paid = 0 AND created_at < ? LIMIT 100').bind(now() - 35 * 60).all<BookingRow>();
  for (const b of r.results) {
    try {
      if (await settleCheckout(env, b)) continue;
    } catch (e) {
      console.error('Checkout check failed', b.id, e);
      continue;
    }
    await env.DB.batch([
      env.DB.prepare('UPDATE conversations SET booking_id = NULL WHERE booking_id = ?').bind(b.id),
      env.DB.prepare('DELETE FROM bookings WHERE id = ? AND paid = 0').bind(b.id),
      env.DB.prepare('UPDATE users SET credit = credit + ? WHERE id = ?').bind(b.credit_used, b.customer_id),
    ]);
  }
  return r.results.length;
}

/** Cron: requests unanswered for 24h are cancelled and refunded. */
export async function expirePending(env: Env) {
  const r = await env.DB.prepare("SELECT * FROM bookings WHERE status = 'pending' AND paid = 1 AND (created_at < ? OR starts_at < ?) LIMIT 200")
    .bind(now() - 24 * 3600, now()).all<BookingRow>();
  for (const b of r.results) {
    if (!(await refundBooking(env, b, (amt) => `No reply in time · ${amt} refunded in full`, true))) continue;
    await notify(env, b.customer_id, { icon: 'receipt', tone: 'neutral', title: 'Request expired', body: `No reply in time, so ${euros(b.total)} is refunded in full.`, go: 'tab:cancelled' });
  }
  return r.results.length;
}
