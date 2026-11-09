import { Hono } from 'hono';
import type { AppEnv, Env } from '../types';
import { ACT_LABEL, ACTIVITIES, FEEDBACK_CONCERNS, FEEDBACK_GOOD, FREE_CANCEL_HOURS, ROMANTIC, SERVICE_FEE, VIDEO_ACT, type ActId } from '../types';
import {
  ACCEPT_BEFORE_S, availabilityOf, canAccept, fitAt, fits, HOLDING, legacyDays, lengthText, ruleProblem, type Kind,
} from '../lib/hours';
import { slotsChanged } from '../lib/live';
import { alertAdmins, notify } from '../lib/notify';
import { inBackground, sendBookingConfirmation, sendBookingInvoice } from '../lib/mail';
import { dateIn, DEFAULT_TZ, localToUnix, minutes, realDate, whenIn } from '../lib/time';
import { CONTACT_MSG, euros, fail, hasContactDetails, newId, now, parseJson, safeEqual } from '../lib/util';
import { newMeetCode } from '../lib/meetCode';
import { cancelIntent, capture, createCheckout, expireSession, getSession, intentOf, stripeOn } from '../lib/stripe';
import { balanceOf } from './payouts';

type Ctx = { waitUntil(p: Promise<unknown>): void };

/**
 * Booking statuses. A request is PENDING until the companion accepts it (CONFIRMED, which takes its time), declines
 * it (REJECTED), it runs out of time (EXPIRED) or someone else's booking for an overlapping time is confirmed first
 * (CONFLICTED). Either side can withdraw (CANCELLED); a confirmed booking ends COMPLETED (meet code or video call).
 * Every change is a conditional UPDATE from the statuses it may come from, so a booking can't skip or undo a step.
 */
export type Status = 'pending' | 'confirmed' | 'rejected' | 'expired' | 'conflicted' | 'cancelled' | 'completed';
type Closing = 'rejected' | 'expired' | 'conflicted' | 'cancelled';
const CLOSES_FROM: Record<Closing, Status[]> = { rejected: ['pending'], expired: ['pending'], conflicted: ['pending'], cancelled: ['pending', 'confirmed'] };
type Who = 'customer' | 'companion' | 'support' | 'system';

export type BookingRow = {
  id: string; customer_id: string; companion_id: string; activity: ActId; starts_at: number; duration_h: number;
  place: string; note: string; status: Status; cancel_note: string | null;
  rate: number; subtotal: number; fee: number; total: number; pay_status: 'held' | 'released' | 'refunded';
  meet_code: string; code_attempts: number; reviewed: number; created_at: number; credit_used: number; payment_ref: string | null; paid: number; checkout_url: string | null;
  cancelled_by: Who | null; cancel_reason: string | null;
  resched_at: number | null; resched_by: 'customer' | 'companion' | null; resched_asked: number | null; resched_count: number;
  call_customer_at: number | null; call_companion_at: number | null; call_together_s: number; call_closed: number | null;
  // Worked out by the database (migration 0018)
  ends_at: number; accept_by: number; expires_at: number; kind: Kind; decided_at: number | null; conflict_with: string | null;
};

/** App versions from before the seven statuses only know four: they see the new ones as cancelled. */
const modern = (c: { req: { header(name: string): string | undefined } }) => Number(c.req.header('x-zeitmit-api') ?? 0) >= 3;
const shown = (s: Status, m: boolean) => (m || !['rejected', 'expired', 'conflicted'].includes(s) ? s : 'cancelled');
const lengthOf = (b: Pick<BookingRow, 'duration_h'>) => Math.round(b.duration_h * 60);

/** "16:30" when it's today in that zone, otherwise "Sat 8 Nov · 01:00". */
const untilText = (unix: number, tz: string) => (dateIn(unix, tz) === dateIn(now(), tz) ? whenIn(unix, tz).time : whenIn(unix, tz).full);

/** Reasons people can pick when cancelling (fixed, so they can be translated and never carry contact details). */
export const CANCEL_REASONS = {
  customer: ['Plans changed', 'Booked by mistake', 'Feeling unwell', 'Something else'],
  companion: ['Feeling unwell', 'Emergency', 'Schedule conflict', 'Safety concern', 'Something else'],
} as const;
const reasonFor = (side: keyof typeof CANCEL_REASONS, r: unknown) => {
  if (r === undefined || r === null || r === '') return null;
  if (!(CANCEL_REASONS[side] as readonly string[]).includes(String(r))) fail(400, 'Pick one of the reasons.');
  return String(r);
};

/** A booking's time can be changed this many times, always with the other side's agreement. */
export const MAX_RESCHEDULES = 3;
/** Clears a suggested new time (part of every update that ends or answers a booking). */
const NO_RESCHED = 'resched_at = NULL, resched_by = NULL, resched_asked = NULL';
const reschedOf = (b: BookingRow, tz: string) => (b.resched_at ? { at: b.resched_at, by: b.resched_by!, ...whenIn(b.resched_at, tz), end: whenIn(b.resched_at + lengthOf(b) * 60, tz).time } : null);

/** What both sides see of a booking's time: start, end and length, in the viewer's zone. */
const timeOf = (b: BookingRow, tz: string) => ({
  startsAt: b.starts_at, endsAt: b.ends_at, minutes: lengthOf(b), ...whenIn(b.starts_at, tz), end: whenIn(b.ends_at, tz).time, dur: b.duration_h,
});

/** Booking as the customer sees it (includes the meet code). */
const forCustomer = (b: BookingRow & { companion_name?: string; hue?: number; photo_id?: string | null }, m: boolean, tz: string) => ({
  id: b.id, cid: b.companion_id, companionName: b.companion_name, hue: b.hue, photoUrl: b.photo_id ? `/photos/${b.photo_id}` : null, act: b.activity, kind: b.kind,
  ...timeOf(b, tz), place: b.place, note: b.cancel_note ?? undefined, status: shown(b.status, m),
  // Video dates have no meet code: the call itself confirms them.
  pay: b.pay_status, total: b.total, creditUsed: b.credit_used, otp: b.status === 'confirmed' && b.activity !== VIDEO_ACT ? b.meet_code : undefined, reviewed: !!b.reviewed,
  cancelledBy: b.cancelled_by ?? undefined, resched: reschedOf(b, tz), reschedLeft: MAX_RESCHEDULES - b.resched_count,
  // A request: until when the companion can accept it. A confirmed booking: until when cancelling is free.
  expiresAt: b.status === 'pending' ? b.expires_at : undefined, replyBy: b.status === 'pending' ? b.expires_at : undefined,
  freeUntil: b.status === 'confirmed' ? b.starts_at - FREE_CANCEL_HOURS * 3600 : undefined,
  decidedAt: b.decided_at ?? undefined,
  feedback: !!(b as { my_feedback?: number }).my_feedback,
});

/** Booking as the companion sees it (never includes the meet code). */
type CustomerInfo = { customer_name?: string; avatar_id?: string | null; customer_bio?: string | null; customer_id_status?: string; customer_since?: number };
const forCompanion = (b: BookingRow & CustomerInfo, m: boolean, tz: string) => ({
  id: b.id, who: b.customer_name || 'Customer', customerId: b.customer_id, avatarUrl: b.avatar_id ? `/photos/${b.avatar_id}` : null, act: b.activity, kind: b.kind,
  // What a companion may know about who is booking: never the email or documents.
  customer: { bio: b.customer_bio ?? '', verified: b.customer_id_status === 'approved', since: b.customer_since ?? null },
  ...timeOf(b, tz), place: b.place, note: b.note, status: shown(b.status, m), pay: b.pay_status,
  payout: b.subtotal, resched: reschedOf(b, tz), reschedLeft: MAX_RESCHEDULES - b.resched_count,
  expiresAt: b.status === 'pending' ? b.expires_at : undefined, replyBy: b.status === 'pending' ? b.expires_at : undefined,
  feedback: !!(b as { my_feedback?: number }).my_feedback,
  cancelledBy: b.cancelled_by ?? undefined, cancelNote: b.status !== 'pending' && b.status !== 'confirmed' && b.status !== 'completed' ? b.cancel_note ?? undefined : undefined,
});

async function load(env: Env, id: string) {
  const b = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first<BookingRow>();
  if (!b) fail(404, 'Booking not found.');
  return b!;
}

/** Names and time zones of both sides, for what they're told. */
async function peopleOf(env: Env, b: Pick<BookingRow, 'customer_id' | 'companion_id'>) {
  const r = await env.DB.prepare(
    `SELECT (SELECT name FROM users WHERE id = ?1) AS customer, (SELECT timezone FROM users WHERE id = ?1) AS customer_tz,
       c.display_name AS companion, COALESCE(u.timezone, c.timezone) AS companion_tz
     FROM companions c JOIN users u ON u.id = c.user_id WHERE c.user_id = ?2`,
  ).bind(b.customer_id, b.companion_id).first<{ customer: string | null; customer_tz: string | null; companion: string | null; companion_tz: string | null }>();
  return {
    customer: r?.customer?.split(' ')[0] || 'Your customer', companion: r?.companion || 'Your companion',
    customerTz: r?.customer_tz || DEFAULT_TZ, companionTz: r?.companion_tz || DEFAULT_TZ,
  };
}

/** Every paid booking gets its own chat thread (created once, when the request reaches the companion). */
export async function ensureThread(env: Env, b: Pick<BookingRow, 'id' | 'customer_id' | 'companion_id'>) {
  await env.DB.prepare('INSERT INTO conversations (id, customer_id, companion_id, booking_id) VALUES (?, ?, ?, ?) ON CONFLICT (booking_id) DO NOTHING')
    .bind(newId('cv'), b.customer_id, b.companion_id, b.id).run();
  return (await env.DB.prepare('SELECT id FROM conversations WHERE booking_id = ?').bind(b.id).first<{ id: string }>())!.id;
}

/** Tells open chat screens that this booking's thread just ended (booking completed or closed). */
async function endThread(env: Env, bookingId: string, ctx?: { waitUntil(p: Promise<unknown>): void }) {
  const cv = await env.DB.prepare('SELECT id FROM conversations WHERE booking_id = ?').bind(bookingId).first<{ id: string }>();
  if (!cv) return;
  const send = env.CHAT.get(env.CHAT.idFromName(cv.id)).fetch('https://chat/broadcast', { method: 'POST', body: JSON.stringify({ type: 'closed' }) }).catch(() => undefined);
  if (ctx) ctx.waitUntil(send);
  else await send;
}

/** Ends a running safety check-in once its booking is over (an SOS stays visible for the team). */
const endCheckins = (env: Env, bookingId: string) =>
  env.DB.prepare("UPDATE checkins SET status = 'ended' WHERE booking_id = ? AND status IN ('active', 'alerted')").bind(bookingId).run();

/**
 * Closes a booking that hasn't happened (declined, expired, lost its time or cancelled) and gives the money back: gift
 * credit to the account, the card hold released (it was only authorised, so it's never charged). Returns false if the
 * booking couldn't be closed that way any more (already answered, or a concurrent update).
 */
async function closeBooking(env: Env, b: BookingRow, to: Closing, o: { note: (amount: string) => string; by: Who; reason?: string | null; conflictWith?: string | null; onlyIfPending?: boolean }) {
  const from = (o.onlyIfPending ? ['pending'] : CLOSES_FROM[to]).map((s) => `'${s}'`).join(', ');
  const res = await env.DB.prepare(
    `UPDATE bookings SET status = ?1, pay_status = 'refunded', cancel_note = ?2, cancelled_by = ?3, cancel_reason = ?4, conflict_with = COALESCE(?5, conflict_with),
       decided_at = CASE WHEN status = 'pending' THEN unixepoch() ELSE decided_at END, ${NO_RESCHED}, updated_at = unixepoch()
     WHERE id = ?6 AND pay_status = 'held' AND status IN (${from})`,
  ).bind(to, o.note(euros(b.total)), o.by, o.reason ?? null, o.conflictWith ?? null, b.id).run();
  if (!res.meta.changes) return false;
  if (b.credit_used) await env.DB.prepare('UPDATE users SET credit = credit + ? WHERE id = ?').bind(b.credit_used, b.customer_id).run();
  if (b.payment_ref?.startsWith('pi_') && stripeOn(env)) {
    try {
      await cancelIntent(env, b.payment_ref);
    } catch (e) {
      console.error('Stripe cancel failed for', b.id, e);
    }
  }
  await endCheckins(env, b.id);
  await endThread(env, b.id);
  // A confirmed booking held its time: it's free again for everyone (if it's in her hours). Requests held nothing.
  if (b.status === 'confirmed') await slotsChanged(env, b.companion_id);
  return true;
}

/** Cancels with a full refund (support refunds, account and listing removal, no-shows). Same as before for its callers. */
export const refundBooking = (
  env: Env, b: BookingRow, note: (amount: string) => string, onlyIfPending = false, by: Who = 'system', reason: string | null = null,
) => closeBooking(env, b, 'cancelled', { note, by, reason, onlyIfPending });

/** The confirmed booking of this companion that overlaps `b`'s time (or the time given), if there is one. */
async function takenBy(env: Env, b: Pick<BookingRow, 'id' | 'companion_id' | 'starts_at' | 'ends_at'>, start = b.starts_at, end = b.ends_at) {
  const r = await env.DB.prepare(`SELECT id FROM bookings WHERE companion_id = ? AND id <> ? AND status IN ${HOLDING} AND starts_at < ? AND ends_at > ? LIMIT 1`)
    .bind(b.companion_id, b.id, end, start).first<{ id: string }>();
  return r?.id ?? null;
}

/** A request whose time another booking took: refunded in full, and the customer told. */
async function conflictRequest(env: Env, b: BookingRow, winner: string | null) {
  if (!b.paid) return false; // an unfinished checkout: checked again when it's paid (announceBooking)
  if (!(await closeBooking(env, b, 'conflicted', { note: (amt) => `Not available any more · ${amt} refunded in full`, by: 'system', conflictWith: winner }))) return false;
  const p = await peopleOf(env, b);
  const when = whenIn(b.starts_at, p.customerTz);
  await notify(env, b.customer_id, {
    icon: 'calendar-x', tone: 'neutral', title: `${p.companion} isn’t free then any more`,
    body: `${ACT_LABEL[b.activity]} on ${when.full}: that time was just booked by someone else, so ${euros(b.total)} is refunded in full.`, go: 'tab:cancelled',
  });
  return true;
}

/** Every other request for a time overlapping a booking that was just confirmed (or moved) can't happen any more. */
async function conflictOverlapping(env: Env, w: Pick<BookingRow, 'id' | 'companion_id' | 'starts_at' | 'ends_at'>) {
  const r = await env.DB.prepare("SELECT * FROM bookings WHERE companion_id = ? AND id <> ? AND status = 'pending' AND paid = 1 AND starts_at < ? AND ends_at > ? LIMIT 100")
    .bind(w.companion_id, w.id, w.ends_at, w.starts_at).all<BookingRow>();
  for (const x of r.results) await conflictRequest(env, x, w.id);
  return r.results.length;
}

/** An unanswered request runs out of time: cancelled as EXPIRED, refunded, and both sides told. */
async function expireRequest(env: Env, b: BookingRow) {
  if (!(await closeBooking(env, b, 'expired', { note: (amt) => `No reply in time · ${amt} refunded in full`, by: 'system' }))) return false;
  const p = await peopleOf(env, b);
  await notify(env, b.customer_id, { icon: 'receipt', tone: 'neutral', title: 'Request expired', body: `${p.companion} didn’t reply in time, so ${euros(b.total)} is refunded in full.`, go: 'tab:cancelled' });
  await notify(env, b.companion_id, { icon: 'hourglass', tone: 'neutral', title: 'Request expired', body: `${p.customer}’s request for ${whenIn(b.starts_at, p.companionTz).full} wasn’t answered in time, so it was cancelled.`, go: 'comp:calendar' });
  return true;
}

/**
 * Requests past their expiry (24 hours after they were sent, or 3 hours before the start), and requests whose time
 * another booking took, are closed. Runs from the cron and before showing someone's bookings, so nobody sees an
 * expired request as still waiting. A request the companion answered with another time waits for the customer
 * instead (until that suggestion runs out too).
 */
export async function expirePending(env: Env, scope?: { customer?: string; companion?: string }) {
  const t = now();
  const only = scope?.customer ? ' AND p.customer_id = ?2' : scope?.companion ? ' AND p.companion_id = ?2' : '';
  const who = scope?.customer ?? scope?.companion ?? '';
  const due = await env.DB.prepare(
    `SELECT p.* FROM bookings p WHERE p.status = 'pending' AND p.paid = 1 AND p.expires_at < ?1
       AND NOT (p.resched_by = 'companion' AND p.resched_at IS NOT NULL)${only} LIMIT 200`,
  ).bind(t, ...(only ? [who] : [])).all<BookingRow>();
  for (const b of due.results) await expireRequest(env, b);
  const lost = await env.DB.prepare(
    `SELECT p.*, (SELECT o.id FROM bookings o WHERE o.companion_id = p.companion_id AND o.id <> p.id AND o.status IN ${HOLDING}
                   AND o.starts_at < p.ends_at AND o.ends_at > p.starts_at LIMIT 1) AS winner
     FROM bookings p WHERE p.status = 'pending' AND p.paid = 1${only} AND EXISTS (
       SELECT 1 FROM bookings o WHERE o.companion_id = p.companion_id AND o.id <> p.id AND o.status IN ${HOLDING} AND o.starts_at < p.ends_at AND o.ends_at > p.starts_at) LIMIT 200`,
  ).bind(...(only ? [t, who] : [])).all<BookingRow & { winner: string | null }>();
  for (const b of lost.results) await conflictRequest(env, b, b.winner);
  return due.results.length + lost.results.length;
}

/** Deletes a booking whose checkout was never paid and gives back its gift credit. False if it was paid or removed meanwhile. */
async function dropHold(env: Env, b: BookingRow) {
  const still = 'EXISTS (SELECT 1 FROM bookings WHERE id = ?1 AND paid = 0)';
  const res = await env.DB.batch([
    env.DB.prepare(`UPDATE users SET credit = credit + ?2 WHERE id = ?3 AND ${still}`).bind(b.id, b.credit_used, b.customer_id),
    env.DB.prepare(`UPDATE conversations SET booking_id = NULL WHERE booking_id = ?1 AND ${still}`).bind(b.id),
    env.DB.prepare('DELETE FROM bookings WHERE id = ?1 AND paid = 0').bind(b.id),
  ]);
  return !!res[2].meta.changes;
}

/**
 * The customer left Stripe Checkout without paying: closes the checkout page (so it can't be paid later) and drops
 * the unfinished request.
 */
async function releaseHold(env: Env, b: BookingRow, ctx?: Ctx): Promise<'released' | 'paid' | 'processing' | 'gone'> {
  if (b.paid) return 'paid';
  if (b.payment_ref?.startsWith('cs_') && stripeOn(env)) {
    try {
      await expireSession(env, b.payment_ref);
    } catch (e) {
      // Not open any more: paid just now (never throw that away), or expired already.
      const s = await getSession(env, b.payment_ref);
      if (s.status === 'open') throw e; // Stripe hiccup: try again later
      if (s.status === 'complete') return (await settleCheckout(env, b, ctx)) ? 'paid' : 'processing';
    }
  }
  return (await dropHold(env, b)) ? 'released' : 'gone';
}

/**
 * Once a request is paid it reaches the companion, who has until its expiry to accept: 24 hours, or until 3 hours
 * before the start if that's sooner. Video dates and in-person dates both wait for her answer. Tells both sides.
 */
async function announceBooking(env: Env, id: string, ctx?: { waitUntil(p: Promise<unknown>): void }) {
  const b = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first<BookingRow>();
  if (!b) return;
  const p = await peopleOf(env, b);
  // She confirmed someone else for this time while this one was paying: it can't be accepted any more.
  const winner = await takenBy(env, b);
  if (winner) {
    await conflictRequest(env, b, winner);
    return;
  }
  await ensureThread(env, b);
  const forThem = whenIn(b.starts_at, p.customerTz);
  const forHer = whenIn(b.starts_at, p.companionTz);
  await notify(env, b.customer_id, {
    icon: 'hourglass', tone: 'warning', title: 'Request sent to ' + p.companion,
    body: `${ACT_LABEL[b.activity]} on ${forThem.full}. ${p.companion} has until ${untilText(b.expires_at, p.customerTz)} to accept.`, go: 'tab:pending',
  }, ctx);
  await notify(env, b.companion_id, {
    icon: 'inbox', tone: 'violet', title: 'New booking request',
    body: `${p.customer} · ${ACT_LABEL[b.activity]} · ${forHer.full} · ${lengthText(lengthOf(b))}. Accept by ${untilText(b.expires_at, p.companionTz)}. ${euros(b.subtotal)} is already paid and held.`,
    go: 'comp:requests',
  }, ctx);
  await inBackground(ctx, () => sendBookingInvoice(env, b.id));
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

/**
 * A start and length from a request: a moment (unix) and minutes, or — from app versions before flexible times — a
 * date and clock time in the companion's zone plus hours. A clock time that doesn't exist that day (the clocks jump
 * forward) is refused; one that happens twice (the clocks go back) is its first occurrence.
 */
function startAndLength(b: { startsAt?: unknown; minutes?: unknown; date?: unknown; time?: unknown; dur?: unknown }, tz: string) {
  if (b.startsAt !== undefined) return { start: Number(b.startsAt), length: Number(b.minutes) };
  if (!realDate(b.date) || typeof b.time !== 'string' || !/^\d\d:\d\d$/.test(b.time)) fail(400, 'Pick a date and a start time.');
  const start = localToUnix(b.date as string, minutes(b.time as string), tz, 'strict');
  if (start === null) fail(400, 'That time doesn’t exist that day: the clocks change. Pick another time.');
  return { start: start!, length: Math.round(Number(b.dur) * 60) };
}

// ---------------- Customer ----------------

export const bookings = new Hono<AppEnv>();

bookings.get('/', async (c) => {
  const u = c.get('user');
  await expirePending(c.env, { customer: u.id });
  const r = await c.env.DB.prepare(
    `SELECT b.*, c.display_name AS companion_name, c.hue, c.photo_id, EXISTS (SELECT 1 FROM meet_feedback f WHERE f.booking_id = b.id AND f.from_id = ?1) AS my_feedback
     FROM bookings b JOIN companions c ON c.user_id = b.companion_id
     WHERE b.customer_id = ?1 AND b.paid = 1 ORDER BY b.starts_at DESC LIMIT 200`,
  ).bind(u.id).all<BookingRow & { companion_name: string; hue: number }>();
  const m = modern(c);
  return c.json(r.results.map((b) => forCustomer(b, m, u.tz)));
});

/**
 * Sends a booking request (payment held by ZeitMit). Body: { companionId, act, startsAt (unix), minutes, place, note?,
 * boundariesAgreed?, useCredit? }; older apps send { date, time, dur (hours) } instead of startsAt and minutes.
 * Any start time and length in 15-minute steps that fit the companion's free time for that kind of date. Requests
 * don't take the time (several people can ask for overlapping times): accepting one does, atomically.
 */
bookings.post('/', async (c) => {
  const u = c.get('user');
  const b = await c.req.json<{ companionId: string; act: ActId; startsAt?: number; minutes?: number; date?: string; time?: string; dur?: number; place?: string; note?: string; boundariesAgreed?: boolean; useCredit?: boolean }>();
  const age = await c.env.DB.prepare('SELECT age_confirmed, name, id_status FROM users WHERE id = ?').bind(u.id).first<{ age_confirmed: number; name: string; id_status: string }>();
  if (!age?.age_confirmed) fail(403, 'Confirm you’re 18 or older before booking.');
  if (age!.id_status !== 'approved') fail(403, 'Verify your ID before your first booking.');
  if (hasContactDetails(b.note ?? '') || hasContactDetails(b.place ?? '')) fail(400, CONTACT_MSG);
  const comp = await c.env.DB.prepare("SELECT user_id, display_name, rate, activities, timezone FROM companions WHERE user_id = ? AND status = 'approved'")
    .bind(b.companionId)
    .first<{ user_id: string; display_name: string; rate: number; activities: string; timezone: string | null }>();
  if (!comp) fail(404, 'This companion isn’t available.');
  if (comp!.user_id === u.id) fail(400, 'You can’t book yourself.');
  const blocked = await c.env.DB.prepare('SELECT 1 FROM blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)')
    .bind(u.id, comp!.user_id, comp!.user_id, u.id).first();
  if (blocked) fail(403, 'You can’t book this companion.');
  if (!ACTIVITIES.includes(b.act) || !parseJson<string[]>(comp!.activities, []).includes(b.act)) fail(400, `${comp!.display_name} doesn’t offer that activity.`);
  const kind: Kind = b.act === VIDEO_ACT ? 'video' : 'meet';
  const { start, length } = startAndLength(b, comp!.timezone || DEFAULT_TZ);
  const problem = ruleProblem(kind, start, length);
  if (problem) fail(400, problem);
  // Optional: the two can agree on a place in the chat after the request is accepted. Video dates happen in the app.
  const place = b.act === VIDEO_ACT ? '' : (b.place ?? '').trim();
  if (ROMANTIC.includes(b.act) && !b.boundariesAgreed) fail(400, `Please agree to respect ${comp!.display_name}’s boundaries.`);

  // A checkout this customer left unpaid with the same companion mustn't stand in the way of their new try.
  const left = await c.env.DB.prepare('SELECT * FROM bookings WHERE customer_id = ? AND companion_id = ? AND paid = 0').bind(u.id, comp!.user_id).all<BookingRow>();
  for (const old of left.results) await releaseHold(c.env, old, c.executionCtx).catch((e) => console.error('Release failed', old.id, e));

  // The whole interval has to be free for that kind: inside her open hours, outside her blocks and confirmed bookings.
  const a = await availabilityOf(c.env, comp!.user_id);
  const free = a?.kinds[kind]?.open ?? [];
  const end = start + length * 60;
  if (!fits(free, start, end)) {
    const room = fitAt(free, start);
    fail(409, room
      ? `From ${whenIn(start, u.tz).time}, ${comp!.display_name} is only free for ${lengthText(room)}. Choose a shorter time or another start.`
      : 'That time isn’t free. Pick another time.');
  }
  const mine = await c.env.DB.prepare("SELECT 1 FROM bookings WHERE customer_id = ? AND companion_id = ? AND status = 'pending' AND paid = 1 AND starts_at < ? AND ends_at > ?")
    .bind(u.id, comp!.user_id, end, start).first();
  if (mine) fail(409, 'You already asked for this time. Wait for the answer, or cancel that request first.');

  // Priced by the minute: the hourly rate × length (15-minute steps keep it to whole cents), plus the service fee.
  const subtotal = Math.round((comp!.rate * 100 * length) / 60);
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
  await c.env.DB.prepare(
    `INSERT INTO bookings (id, customer_id, companion_id, activity, starts_at, duration_h, place, note, boundaries_agreed, rate, subtotal, fee, total, meet_code, credit_used)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, u.id, comp!.user_id, b.act, start, length / 60, place.slice(0, 160), (b.note ?? '').slice(0, 240), b.boundariesAgreed ? 1 : 0, comp!.rate * 100, subtotal, fee, total, newMeetCode(), creditUsed).run();
  const m = modern(c);
  // Card part goes through Stripe Checkout; the request reaches the companion once it's paid.
  const due = total - creditUsed;
  if (stripeOn(c.env) && due > 0) {
    try {
      const s = await createCheckout(c.env, { amount: due, name: `${ACT_LABEL[b.act]} with ${comp!.display_name}`, ref: id, kind: 'booking', origin: new URL(c.req.url).origin, email: u.email });
      await c.env.DB.prepare('UPDATE bookings SET paid = 0, payment_ref = ?, checkout_url = ? WHERE id = ?').bind(s.id, s.url, id).run();
      return c.json({ ...forCustomer({ ...(await load(c.env, id)), companion_name: comp!.display_name }, m, u.tz), checkoutUrl: s.url }, 201);
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
  return c.json(forCustomer({ ...(await load(c.env, id)), companion_name: comp!.display_name }, m, u.tz), 201);
});

/** After Stripe Checkout: confirms the payment and sends the request to the companion. */
bookings.post('/:id/confirm-payment', async (c) => {
  const u = c.get('user');
  const b = await load(c.env, c.req.param('id'));
  if (b.customer_id !== u.id) fail(404, 'Booking not found.');
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
  return c.json({ paid: true, booking: forCustomer(row!, modern(c), u.tz) });
});

/** The customer cancelled or closed Stripe Checkout: the unfinished request is dropped. */
bookings.post('/:id/release', async (c) => {
  const b = await c.env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(c.req.param('id')).first<BookingRow>();
  if (!b) return c.json({ released: false, paid: false }); // already dropped (or expired)
  if (b.customer_id !== c.get('user').id) fail(404, 'Booking not found.');
  let r: Awaited<ReturnType<typeof releaseHold>>;
  try {
    r = await releaseHold(c.env, b, c.executionCtx);
  } catch (e) {
    console.error('Release failed', b.id, e);
    fail(409, 'We couldn’t check the payment yet. Please try again in a moment.');
  }
  return c.json({ released: r! === 'released', paid: r! === 'paid' });
});

// ---------------- Moving a booking (either side) ----------------

/** Which side of the booking this person is on (anyone else gets "not found"). */
function sideOf(b: BookingRow, userId: string): 'customer' | 'companion' {
  if (b.customer_id === userId) return 'customer';
  if (b.companion_id !== userId) fail(404, 'Booking not found.');
  return 'companion';
}

/** Where a notification about this booking takes each side. */
const goFor = (status: BookingRow['status'], to: 'customer' | 'companion') =>
  to === 'customer' ? (status === 'pending' ? 'tab:pending' : 'tab:upcoming') : status === 'pending' ? 'comp:requests' : 'comp:calendar';

// No confirmed booking of companion ?4 overlaps [?1, ?1 + this booking's length), leaving booking ?3 out.
const FREE_SQL = `NOT EXISTS (SELECT 1 FROM bookings o WHERE o.companion_id = ?4 AND o.id <> ?3 AND o.status IN ${HOLDING}
      AND o.starts_at < ?1 + ?2 AND o.ends_at > ?1)`;

/** What's needed to pick a new time: the companion's free time for this kind of date, with this booking left out. */
bookings.get('/:id/reschedule', async (c) => {
  const u = c.get('user');
  const b = await load(c.env, c.req.param('id'));
  const side = sideOf(b, u.id);
  const p = await peopleOf(c.env, b);
  const a = await availabilityOf(c.env, b.companion_id, b.id);
  const free = a?.kinds[b.kind] ?? null;
  return c.json({
    id: b.id, side, cid: b.companion_id, act: b.activity, kind: b.kind, status: shown(b.status, modern(c)), ...timeOf(b, u.tz),
    other: side === 'customer' ? p.companion : p.customer, resched: reschedOf(b, u.tz), left: MAX_RESCHEDULES - b.resched_count,
    availability: a ? { ...a, kinds: { meet: b.kind === 'meet' ? free : null, video: b.kind === 'video' ? free : null } } : null,
    // App versions before flexible times: half-hour start times in her zone.
    slots: a && free ? legacyDays(free.open, a.tz, a.earliest, a.latest) : [],
  });
});

/**
 * Suggests a new time (same length; any 15-minute start that's free for this kind of date, at least 3½ hours ahead);
 * the other side accepts or declines, and until then the booking keeps its time. A request the companion hasn't
 * answered yet is simply moved by the customer. Body: { startsAt } (older apps: { date, time } in her zone).
 */
bookings.post('/:id/reschedule', async (c) => {
  const u = c.get('user');
  const body = await c.req.json<{ startsAt?: number; date?: string; time?: string }>();
  const b = await load(c.env, c.req.param('id'));
  const side = sideOf(b, u.id);
  if (!b.paid || (b.status !== 'pending' && b.status !== 'confirmed') || b.pay_status !== 'held') fail(409, 'This booking can’t be moved any more.');
  if (b.resched_count >= MAX_RESCHEDULES) fail(409, `A booking can be moved ${MAX_RESCHEDULES} times. Cancel it and book again instead.`);
  if (b.resched_at && b.resched_by !== side) fail(409, 'Answer the suggested time first.');
  if (side === 'customer' && b.status === 'confirmed' && b.starts_at - now() < FREE_CANCEL_HOURS * 3600) {
    fail(409, `You can change the time up to ${FREE_CANCEL_HOURS} hours before. Send a message or cancel instead.`);
  }
  const a = await availabilityOf(c.env, b.companion_id, b.id);
  const length = lengthOf(b);
  const { start } = startAndLength({ ...body, dur: b.duration_h }, a?.tz ?? DEFAULT_TZ);
  const problem = ruleProblem(b.kind, start, length);
  if (problem) fail(400, problem);
  if (!fits(a?.kinds[b.kind]?.open ?? [], start, start + length * 60)) fail(409, 'That time isn’t free. Pick another one.');
  if (start === b.starts_at) fail(400, 'That’s the current time. Pick a different one.');
  const p = await peopleOf(c.env, b);
  const act = ACT_LABEL[b.activity];
  const other = side === 'customer' ? 'companion' : 'customer';
  const tzOther = other === 'customer' ? p.customerTz : p.companionTz;

  if (side === 'customer' && b.status === 'pending') {
    const res = await c.env.DB.prepare(
      `UPDATE bookings SET starts_at = ?1, ${NO_RESCHED}, resched_count = resched_count + 1, updated_at = unixepoch()
       WHERE id = ?3 AND status = 'pending' AND pay_status = 'held' AND ${FREE_SQL}`,
    ).bind(start, length * 60, b.id, b.companion_id).run();
    if (!res.meta.changes) fail(409, 'That time was just booked. Pick another one.');
    await notify(c.env, b.companion_id, {
      icon: 'calendar-clock', tone: 'violet', title: `${p.customer} moved their request`,
      body: `${act} is now on ${whenIn(start, p.companionTz).full} (was ${whenIn(b.starts_at, p.companionTz).full}).`, go: 'comp:requests',
    }, c.executionCtx);
    return c.json({ moved: true, ...whenIn(start, u.tz) });
  }

  const res = await c.env.DB.prepare(
    `UPDATE bookings SET resched_at = ?1, resched_by = ?5, resched_asked = unixepoch(), updated_at = unixepoch()
     WHERE id = ?3 AND status IN ('pending', 'confirmed') AND pay_status = 'held' AND (resched_by IS NULL OR resched_by = ?5) AND ${FREE_SQL}`,
  ).bind(start, length * 60, b.id, b.companion_id, side).run();
  if (!res.meta.changes) fail(409, 'That time was just booked. Pick another one.');
  await notify(c.env, other === 'companion' ? b.companion_id : b.customer_id, {
    icon: 'calendar-clock', tone: 'violet', title: `${side === 'customer' ? p.customer : p.companion} suggests another time`,
    body: `${act}: ${whenIn(start, tzOther).full} instead of ${whenIn(b.starts_at, tzOther).full}. You can accept or decline.`, go: goFor(b.status, other),
  }, c.executionCtx);
  return c.json({ moved: false, ...whenIn(start, u.tz) });
});

/**
 * After a meet-up, either side tells the team privately how it went. Only admins see it, and serious answers alert them.
 * Body: { safe: 'yes' | 'unsure' | 'no', stars: 1–5 (how respectful the other person was), tags?: string[], note?: string }
 */
bookings.post('/:id/feedback', async (c) => {
  const uid = c.get('user').id;
  const b = await load(c.env, c.req.param('id'));
  const side = sideOf(b, uid);
  if (b.status !== 'completed') fail(409, 'You can tell us how it went once you’ve met.');
  const f = await c.req.json<{ safe?: string; stars?: number; tags?: unknown; note?: string }>();
  if (!['yes', 'unsure', 'no'].includes(f.safe ?? '')) fail(400, 'Tell us whether you felt safe.');
  if (!Number.isInteger(f.stars) || f.stars! < 1 || f.stars! > 5) fail(400, 'Choose 1 to 5 stars.');
  const known = [...FEEDBACK_GOOD, ...FEEDBACK_CONCERNS];
  const tags = Array.isArray(f.tags) ? [...new Set(f.tags.filter((x): x is string => typeof x === 'string' && known.includes(x)))] : [];
  const note = typeof f.note === 'string' ? f.note.trim().slice(0, 600) : '';
  const concern = f.safe !== 'yes' || f.stars! <= 2 || tags.some((x) => FEEDBACK_CONCERNS.includes(x));
  const about = side === 'customer' ? b.companion_id : b.customer_id;
  const res = await c.env.DB.prepare(
    `INSERT INTO meet_feedback (id, booking_id, from_id, about_id, role, safe, stars, tags, note, concern) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (booking_id, from_id) DO NOTHING`,
  ).bind(newId('fb'), b.id, uid, about, side, f.safe, f.stars, JSON.stringify(tags), note, concern ? 1 : 0).run();
  if (!res.meta.changes) fail(409, 'You already told us how this one went. Thank you!');
  // Didn't feel safe, 1 star or crossed boundaries: the team hears about it straight away.
  if (f.safe === 'no' || f.stars === 1 || tags.includes('Crossed boundaries')) {
    const e = await c.env.DB.prepare('SELECT (SELECT email FROM users WHERE id = ?) AS sender, (SELECT email FROM users WHERE id = ?) AS other').bind(uid, about)
      .first<{ sender: string; other: string }>();
    const p = await peopleOf(c.env, b);
    const [me, them] = side === 'customer' ? [p.customer, p.companion] : [p.companion, p.customer];
    const answer = f.safe === 'no' ? 'didn’t feel safe' : f.safe === 'unsure' ? 'wasn’t sure they were safe' : 'felt safe';
    await alertAdmins(c.env, `Safety feedback: ${me} ${answer} with ${them}`, [
      `${me} (${side}, ${e?.sender}) ${answer} at their meet-up with ${them} (${e?.other}).`,
      `Booking ${b.id}: ${ACT_LABEL[b.activity]}, ${whenIn(b.starts_at).full}.`,
      `Respect: ${f.stars}/5${tags.length ? ` · ${tags.join(', ')}` : ''}`,
      note ? `Note: “${note}”` : 'No note.',
      'See Safety feedback in the admin panel.',
    ].join('\n'), { icon: 'shield-alert', tone: 'error', go: '' });
  }
  return c.json({ ok: true, concern }, 201);
});

/**
 * The other side accepts the suggested time: the booking moves (a companion's suggestion on a request also confirms
 * it). Like accepting a request, it has to happen at least 3 hours before the new time, and only if nothing confirmed
 * took that time meanwhile (checked in the same statement that moves it).
 */
bookings.post('/:id/reschedule/accept', async (c) => {
  const u = c.get('user');
  const b = await load(c.env, c.req.param('id'));
  const side = sideOf(b, u.id);
  if (!b.resched_at || (b.status !== 'pending' && b.status !== 'confirmed') || b.pay_status !== 'held') fail(409, 'There’s no new time to answer.');
  if (b.resched_by === side) fail(409, 'The other side has to answer your suggestion.');
  const t = now();
  if (b.resched_at! - ACCEPT_BEFORE_S < t) fail(409, 'That time is too close now: a new time has to be agreed at least 3 hours before. Suggest another one.');
  const res = await c.env.DB.prepare(
    `UPDATE bookings SET starts_at = resched_at,
       status = CASE WHEN status = 'pending' AND resched_by = 'companion' THEN 'confirmed' ELSE status END,
       decided_at = CASE WHEN status = 'pending' AND resched_by = 'companion' THEN ?3 ELSE decided_at END,
       ${NO_RESCHED}, resched_count = resched_count + 1, updated_at = ?3
     WHERE id = ?1 AND resched_at = ?2 AND status IN ('pending', 'confirmed') AND pay_status = 'held'
       AND NOT EXISTS (SELECT 1 FROM bookings o WHERE o.companion_id = bookings.companion_id AND o.id <> bookings.id AND o.status IN ${HOLDING}
         AND o.starts_at < bookings.resched_at + CAST(ROUND(bookings.duration_h * 3600) AS INTEGER) AND o.ends_at > bookings.resched_at)`,
  ).bind(b.id, b.resched_at, t).run();
  if (!res.meta.changes) fail(409, 'That time was just booked, or this booking just changed. Pull down to refresh.');
  const moved = await load(c.env, b.id);
  const confirmed = b.status === 'pending' && moved.status === 'confirmed';
  // It holds its new time now: requests for overlapping times can't happen; its old time is free again.
  if (moved.status === 'confirmed') await conflictOverlapping(c.env, moved);
  void slotsChanged(c.env, b.companion_id, c.executionCtx);
  const p = await peopleOf(c.env, b);
  const other = side === 'customer' ? 'companion' : 'customer';
  await notify(c.env, other === 'companion' ? b.companion_id : b.customer_id, {
    icon: 'calendar-check', tone: 'success', title: `${side === 'customer' ? p.customer : p.companion} accepted the new time`,
    body: `${ACT_LABEL[b.activity]} is now on ${whenIn(moved.starts_at, other === 'customer' ? p.customerTz : p.companionTz).full}${confirmed ? '. Your booking is confirmed' : ''}.`,
    go: goFor(confirmed ? 'confirmed' : b.status, other),
  }, c.executionCtx);
  // Confirmation emails: for a request this confirms, or with the new time for a booking that was confirmed already.
  if (confirmed || b.status === 'confirmed') await inBackground(c.executionCtx, () => sendBookingConfirmation(c.env, b.id, !confirmed));
  return c.json({ ok: true, confirmed, ...whenIn(moved.starts_at, u.tz) });
});

/** Declines the suggested time (the other side) or withdraws your own. The booking keeps its time either way. */
bookings.delete('/:id/reschedule', async (c) => {
  const b = await load(c.env, c.req.param('id'));
  const side = sideOf(b, c.get('user').id);
  if (!b.resched_at) return c.json({ ok: true, withdrawn: false }); // already answered
  const res = await c.env.DB.prepare(`UPDATE bookings SET ${NO_RESCHED}, updated_at = unixepoch() WHERE id = ? AND resched_at = ?`).bind(b.id, b.resched_at).run();
  if (!res.meta.changes) return c.json({ ok: true, withdrawn: false });
  const p = await peopleOf(c.env, b);
  const mine = b.resched_by === side;
  const other = side === 'customer' ? 'companion' : 'customer';
  const name = side === 'customer' ? p.customer : p.companion;
  const stays = `${ACT_LABEL[b.activity]} stays on ${whenIn(b.starts_at, other === 'customer' ? p.customerTz : p.companionTz).full}.`;
  await notify(c.env, other === 'companion' ? b.companion_id : b.customer_id, mine
    ? { icon: 'calendar', tone: 'neutral', title: `${name} kept the original time`, body: stays, go: goFor(b.status, other) }
    : { icon: 'calendar-x', tone: 'neutral', title: `${name} can’t make the new time`, body: `${stays} You can suggest another time or send a message.`, go: goFor(b.status, other) },
    c.executionCtx);
  return c.json({ ok: true, withdrawn: mine });
});

/**
 * Customer cancels. A request (any time) and a confirmed booking more than FREE_CANCEL_HOURS ahead are refunded in
 * full; later, the booking is cancelled but the companion keeps their pay for the reserved time.
 */
bookings.post('/:id/cancel', async (c) => {
  const u = c.get('user');
  const body = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
  const b = await load(c.env, c.req.param('id'));
  if (b.customer_id !== u.id) fail(404, 'Booking not found.');
  if ((b.status !== 'pending' && b.status !== 'confirmed') || b.pay_status !== 'held') fail(409, 'This booking can’t be cancelled any more.');
  const reason = reasonFor('customer', body.reason);
  const p = await peopleOf(c.env, b);
  const when = `${ACT_LABEL[b.activity]} on ${whenIn(b.starts_at, p.companionTz).day}`;
  const late = b.status === 'confirmed' && b.starts_at - now() < FREE_CANCEL_HOURS * 3600;

  if (!late) {
    if (!(await closeBooking(c.env, b, 'cancelled', { note: (amt) => `Cancelled by you · ${amt} refunded in full`, by: 'customer', reason }))) fail(409, 'This booking can’t be cancelled any more.');
    await notify(c.env, b.companion_id, { icon: 'calendar-x', tone: 'error', title: `${p.customer} cancelled`, body: `${when} was cancelled${reason ? ` · ${reason}` : ''}.`, go: 'comp:calendar' }, c.executionCtx);
    return c.json({ ok: true, refunded: b.total, late: false });
  }

  // Late: take the held payment, the companion is paid for the time they reserved.
  if (b.payment_ref?.startsWith('pi_') && stripeOn(c.env)) {
    try {
      await capture(c.env, b.payment_ref);
    } catch (e) {
      console.error('Late-cancel capture failed', b.id, e);
      fail(409, 'The cancellation couldn’t be processed. Please try again in a moment.');
    }
  }
  const res = await c.env.DB.prepare(
    `UPDATE bookings SET status = 'cancelled', pay_status = 'released', released_at = unixepoch(), cancel_note = ?, cancelled_by = 'customer', cancel_reason = ?, ${NO_RESCHED}, updated_at = unixepoch()
     WHERE id = ? AND status = 'confirmed' AND pay_status = 'held'`,
  ).bind(`Cancelled by you less than ${FREE_CANCEL_HOURS} hours before · no refund`, reason, b.id).run();
  if (!res.meta.changes) fail(409, 'This booking can’t be cancelled any more.');
  await endCheckins(c.env, b.id);
  await endThread(c.env, b.id, c.executionCtx);
  void slotsChanged(c.env, b.companion_id, c.executionCtx); // the companion is free then, so others can book it
  await notify(c.env, b.companion_id, { icon: 'calendar-x', tone: 'warning', title: `${p.customer} cancelled late`, body: `${when} was cancelled less than ${FREE_CANCEL_HOURS} hours before. You still get ${euros(b.subtotal)}.`, go: 'comp:calendar' }, c.executionCtx);
  return c.json({ ok: true, refunded: 0, late: true, kept: b.total });
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

/**
 * Everything a companion needs: open requests (with how many other requests overlap each one) and upcoming bookings
 * (all of them), their history (the latest 100 meet-ups and 60 that didn't happen, newest first; counted apart so
 * cancellations never push meet-ups out) and earnings. Totals are summed in SQL, so they cover every booking.
 */
companionBookings.get('/', async (c) => {
  const u = c.get('user');
  await expirePending(c.env, { companion: u.id });
  const rows = (where: string, order: string, limit: number) => c.env.DB.prepare(
    `SELECT b.*, u.name AS customer_name, u.avatar_id, u.bio AS customer_bio, u.id_status AS customer_id_status, u.created_at AS customer_since,
       EXISTS (SELECT 1 FROM meet_feedback f WHERE f.booking_id = b.id AND f.from_id = ?1) AS my_feedback
     FROM bookings b JOIN users u ON u.id = b.customer_id
     WHERE b.companion_id = ?1 AND b.paid = 1 AND ${where} ORDER BY ${order} LIMIT ${limit}`,
  ).bind(u.id).all<BookingRow & CustomerInfo>();
  const [open, met, closed, sums, balance] = await Promise.all([
    rows("b.status IN ('pending', 'confirmed')", 'b.starts_at', 500),
    rows("b.status = 'completed'", 'b.starts_at DESC', 100),
    rows("b.status IN ('rejected', 'expired', 'conflicted', 'cancelled')", 'b.starts_at DESC', 60),
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(CASE WHEN status = 'confirmed' AND pay_status = 'held' THEN subtotal END), 0) AS held,
         COALESCE(SUM(CASE WHEN pay_status = 'released' THEN subtotal END), 0) AS released, COUNT(CASE WHEN pay_status = 'released' THEN 1 END) AS releasedCount
       FROM bookings WHERE companion_id = ? AND paid = 1`,
    ).bind(u.id).first<{ held: number; released: number; releasedCount: number }>(),
    balanceOf(c.env, u.id),
  ]);
  const m = modern(c);
  const pending = open.results.filter((b) => b.status === 'pending');
  const overlaps = (b: BookingRow) => pending.filter((o) => o.id !== b.id && o.starts_at < b.ends_at && o.ends_at > b.starts_at).length;
  const done = met.results.map((b) => forCompanion(b, m, u.tz));
  const history = [...done, ...closed.results.map((b) => forCompanion(b, m, u.tz))].sort((a, b) => b.startsAt - a.startsAt);
  return c.json({
    requests: pending.map((b) => ({ ...forCompanion(b, m, u.tz), overlaps: overlaps(b) })),
    upcoming: open.results.filter((b) => b.status === 'confirmed').map((b) => forCompanion(b, m, u.tz)),
    done,
    history,
    earnings: {
      held: sums?.held ?? 0, released: sums?.released ?? 0, releasedCount: sums?.releasedCount ?? 0,
      available: balance.available, pending: balance.pending, requested: balance.requested, paidOut: balance.paid,
    },
  });
});

async function own(c: { env: Env; get: (k: 'user') => { id: string } }, id: string) {
  const b = await load(c.env, id);
  if (b.companion_id !== c.get('user').id) fail(404, 'Booking not found.');
  return b;
}

const TOO_LATE = 'Too late to accept: a request has to be accepted at least 3 hours before its start, and within 24 hours. It has expired and the customer was refunded.';

/**
 * Accepts a request. One statement confirms it only if it's still pending, still within its expiry and nothing
 * confirmed overlaps its time, so of two overlapping requests accepted at the same moment exactly one succeeds; the
 * other is CONFLICTED (refunded). Every other request for an overlapping time is CONFLICTED too.
 */
companionBookings.post('/:id/accept', async (c) => {
  const b = await own(c, c.req.param('id'));
  if (b.status !== 'pending' || !b.paid) fail(409, 'This request was already handled.');
  if (!canAccept(b, now())) {
    await expireRequest(c.env, b);
    fail(409, TOO_LATE);
  }
  const t = now();
  const res = await c.env.DB.prepare(
    `UPDATE bookings SET status = 'confirmed', decided_at = ?2, ${NO_RESCHED}, updated_at = ?2
     WHERE id = ?1 AND status = 'pending' AND paid = 1 AND ?2 <= expires_at
       AND NOT EXISTS (SELECT 1 FROM bookings o WHERE o.companion_id = bookings.companion_id AND o.id <> bookings.id
         AND o.status IN ${HOLDING} AND o.starts_at < bookings.ends_at AND o.ends_at > bookings.starts_at)`,
  ).bind(b.id, t).run();
  if (!res.meta.changes) {
    const fresh = await load(c.env, b.id);
    if (fresh.status !== 'pending') fail(409, 'This request was already handled.');
    if (!canAccept(fresh, now())) {
      await expireRequest(c.env, fresh);
      fail(409, TOO_LATE);
    }
    await conflictRequest(c.env, fresh, await takenBy(c.env, fresh));
    fail(409, 'You already have a confirmed booking at that time, so this request can’t be accepted. The customer was refunded.');
  }
  await conflictOverlapping(c.env, b);
  void slotsChanged(c.env, b.companion_id, c.executionCtx);
  const p = await peopleOf(c.env, b);
  const when = whenIn(b.starts_at, p.customerTz);
  await notify(c.env, b.customer_id, {
    icon: 'calendar-check', tone: 'success', title: 'Booking accepted',
    body: `${p.companion} accepted your ${ACT_LABEL[b.activity].toLowerCase()} request: ${when.full}–${whenIn(b.ends_at, p.customerTz).time}.`, go: 'tab:upcoming',
  }, c.executionCtx);
  await inBackground(c.executionCtx, () => sendBookingConfirmation(c.env, b.id));
  return c.json({ ok: true, status: 'confirmed' });
});

companionBookings.post('/:id/decline', async (c) => {
  const b = await own(c, c.req.param('id'));
  if (b.status !== 'pending') fail(409, 'This request was already handled.');
  if (!(await closeBooking(c.env, b, 'rejected', { note: (amt) => `Declined · ${amt} refunded in full`, by: 'companion' }))) fail(409, 'This request was already handled.');
  const p = await peopleOf(c.env, b);
  await notify(c.env, b.customer_id, { icon: 'receipt', tone: 'neutral', title: `${p.companion} can’t make it`, body: `Your request was declined. ${euros(b.total)} is refunded in full.`, go: 'tab:cancelled' }, c.executionCtx);
  return c.json({ ok: true, status: 'rejected' });
});

/** Companion cancels: a request is declined, a confirmed booking cancelled. The customer always gets everything back. */
companionBookings.post('/:id/cancel', async (c) => {
  const b = await own(c, c.req.param('id'));
  const body = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
  if ((b.status !== 'pending' && b.status !== 'confirmed') || b.pay_status !== 'held') fail(409, 'This booking can’t be cancelled any more.');
  const reason = reasonFor('companion', body.reason);
  const p = await peopleOf(c.env, b);
  const to = b.status === 'pending' ? 'rejected' : 'cancelled';
  if (!(await closeBooking(c.env, b, to, { note: (amt) => `Cancelled by ${p.companion} · ${amt} refunded in full`, by: 'companion', reason }))) fail(409, 'This booking can’t be cancelled any more.');
  await notify(c.env, b.customer_id, {
    icon: 'calendar-x', tone: 'error', title: `${p.companion} cancelled your booking`,
    body: `${ACT_LABEL[b.activity]} on ${whenIn(b.starts_at, p.customerTz).day}${reason ? ` · ${reason}` : ''}. ${euros(b.total)} is refunded in full.`, go: 'tab:cancelled',
  }, c.executionCtx);
  return c.json({ ok: true, refunded: b.total, status: to });
});

/** Companion enters the customer's 4-digit meet code at the meet-up: releases the held payment. */
companionBookings.post('/:id/verify-code', async (c) => {
  const b = await own(c, c.req.param('id'));
  const { code } = await c.req.json<{ code?: string }>();
  if (b.status !== 'confirmed' || b.pay_status !== 'held') fail(409, 'This booking isn’t waiting for a code.');
  if (b.activity === VIDEO_ACT) fail(409, 'Video dates are confirmed by the call itself, not with a code.');
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
  await c.env.DB.prepare(`UPDATE bookings SET status = 'completed', pay_status = 'released', released_at = unixepoch(), ${NO_RESCHED}, updated_at = unixepoch() WHERE id = ? AND status = 'confirmed'`).bind(b.id).run();
  await endCheckins(c.env, b.id);
  await endThread(c.env, b.id, c.executionCtx); // the booking's chat ends for both once you've met
  const p = await peopleOf(c.env, b);
  await notify(c.env, b.customer_id, { icon: 'wallet', tone: 'success', title: 'Payment released to ' + p.companion, body: `Meet code confirmed. ${euros(b.total)} sent from ZeitMit.`, go: 'tab:completed' }, c.executionCtx);
  return c.json({ ok: true, released: b.subtotal });
});

/**
 * A video date is confirmed once both have been on the call together long enough (the call room counts it): the
 * payment goes to the companion, as the meet code does for meet-ups. False if it was settled already.
 */
export async function completeVideoDate(env: Env, bookingId: string, ctx?: Ctx) {
  const b = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first<BookingRow>();
  if (!b || b.activity !== VIDEO_ACT || b.status !== 'confirmed' || b.pay_status !== 'held') return false;
  if (b.payment_ref?.startsWith('pi_') && stripeOn(env)) {
    try {
      await capture(env, b.payment_ref);
    } catch (e) {
      console.error('Video date capture failed', b.id, e);
      await alertAdmins(env, 'Video date payment couldn’t be taken', `Booking ${b.id}: the call reached the time to release the payment, but Stripe refused the capture. Check it in the admin panel.`);
      return false;
    }
  }
  const res = await env.DB.prepare(
    `UPDATE bookings SET status = 'completed', pay_status = 'released', released_at = unixepoch(), ${NO_RESCHED}, updated_at = unixepoch()
     WHERE id = ? AND status = 'confirmed' AND pay_status = 'held'`,
  ).bind(b.id).run();
  if (!res.meta.changes) return false;
  await endThread(env, b.id, ctx); // the booking's chat ends once you've met, as with a meet code
  const name = (await env.DB.prepare('SELECT display_name FROM companions WHERE user_id = ?').bind(b.companion_id).first<{ display_name: string }>())?.display_name ?? 'your companion';
  await notify(env, b.customer_id, { icon: 'video', tone: 'success', title: 'Video date confirmed', body: `${euros(b.total)} sent to ${name} from ZeitMit.`, go: 'tab:completed' }, ctx);
  await notify(env, b.companion_id, { icon: 'wallet', tone: 'success', title: 'Video date confirmed', body: `You earned ${euros(b.subtotal)}.`, go: 'comp:calendar' }, ctx);
  return true;
}

/**
 * Settles video dates that ended without being confirmed, once each: if the companion never joined, the customer
 * gets everything back; if only the companion joined, they keep their pay (as with a late cancellation); if both
 * joined but weren't on the call together long enough, the safety team decides.
 */
export async function endVideoDates(env: Env) {
  const due = await env.DB.prepare(
    `SELECT * FROM bookings WHERE activity = ? AND status = 'confirmed' AND pay_status = 'held' AND paid = 1 AND call_closed IS NULL
       AND ends_at <= ? LIMIT 50`,
  ).bind(VIDEO_ACT, now()).all<BookingRow>();
  for (const b of due.results) {
    const p = await peopleOf(env, b);
    const when = (tz: string) => `${ACT_LABEL[b.activity]} on ${whenIn(b.starts_at, tz).day}`;
    if (!b.call_companion_at) {
      if (await refundBooking(env, b, (amt) => `${p.companion} didn’t join the video date · ${amt} refunded in full`, false, 'companion')) {
        await notify(env, b.customer_id, { icon: 'calendar-x', tone: 'error', title: `${p.companion} didn’t join your video date`, body: `${when(p.customerTz)}. ${euros(b.total)} is refunded in full.`, go: 'tab:cancelled' });
        await notify(env, b.companion_id, { icon: 'calendar-x', tone: 'error', title: 'You missed a video date', body: `${when(p.companionTz)} with ${p.customer}. They got a full refund.`, go: 'comp:calendar' });
      }
    } else if (!b.call_customer_at) {
      let taken = true;
      if (b.payment_ref?.startsWith('pi_') && stripeOn(env)) {
        try { await capture(env, b.payment_ref); } catch (e) { console.error('No-show capture failed', b.id, e); taken = false; }
      }
      const res = taken
        ? await env.DB.prepare(
          `UPDATE bookings SET status = 'cancelled', pay_status = 'released', released_at = unixepoch(), cancel_note = ?, cancelled_by = 'customer', ${NO_RESCHED}, updated_at = unixepoch()
           WHERE id = ? AND status = 'confirmed' AND pay_status = 'held'`,
        ).bind('You didn’t join the video date · no refund', b.id).run()
        : null;
      if (res?.meta.changes) {
        await endThread(env, b.id);
        await notify(env, b.customer_id, { icon: 'calendar-x', tone: 'warning', title: 'You missed your video date', body: `${when(p.customerTz)}. ${p.companion} was waiting in the call, so it isn’t refunded.`, go: 'tab:cancelled' });
        await notify(env, b.companion_id, { icon: 'calendar-x', tone: 'warning', title: `${p.customer} didn’t join the video date`, body: `${when(p.companionTz)}. You still get ${euros(b.subtotal)}.`, go: 'comp:calendar' });
      }
    } else {
      await alertAdmins(env, `Video date to check: ${b.id}`,
        `${p.customer} and ${p.companion} both joined their video date (${when(DEFAULT_TZ)}) but were on the call together for only ${Math.round(b.call_together_s / 60)} minutes. The payment is still held: refund it or ask them what happened.`);
    }
    await env.DB.prepare('UPDATE bookings SET call_closed = unixepoch() WHERE id = ?').bind(b.id).run();
  }
}

/** Cron: checkouts abandoned for 35 minutes are dropped (and their gift credit returned), unless they turn out paid. */
export async function expireUnpaid(env: Env) {
  const r = await env.DB.prepare('SELECT * FROM bookings WHERE paid = 0 AND created_at < ? LIMIT 100').bind(now() - 35 * 60).all<BookingRow>();
  for (const b of r.results) {
    try {
      if (await settleCheckout(env, b)) continue;
    } catch (e) {
      console.error('Checkout check failed', b.id, e);
      continue;
    }
    await dropHold(env, b);
  }
  return r.results.length;
}

/** Cron: once a meet-up has ended, both sides are asked privately how it went (once, up to 3 days after the end). */
export async function askFeedback(env: Env) {
  const r = await env.DB.prepare(
    `SELECT b.*, c.display_name AS companion_name, u.name AS customer_name FROM bookings b
     JOIN companions c ON c.user_id = b.companion_id JOIN users u ON u.id = b.customer_id
     WHERE b.status = 'completed' AND b.feedback_asked = 0 AND b.ends_at <= ?1 AND b.ends_at > ?1 - 3 * 86400
     LIMIT 100`,
  ).bind(now()).all<BookingRow & { companion_name: string; customer_name: string | null }>();
  for (const b of r.results) {
    const res = await env.DB.prepare('UPDATE bookings SET feedback_asked = 1 WHERE id = ? AND feedback_asked = 0').bind(b.id).run();
    if (!res.meta.changes) continue;
    const given = new Set((await env.DB.prepare('SELECT from_id FROM meet_feedback WHERE booking_id = ?').bind(b.id).all<{ from_id: string }>()).results.map((x) => x.from_id));
    const ask = (to: string, name: string) => notify(env, to, {
      icon: 'shield-check', tone: 'violet', title: `How did it go with ${name}?`,
      body: 'Tell us privately whether you felt safe. Only the ZeitMit safety team sees your answer.', go: `feedback:${b.id}`,
    });
    if (!given.has(b.customer_id)) await ask(b.customer_id, b.companion_name);
    if (!given.has(b.companion_id)) await ask(b.companion_id, (b.customer_name || '').trim().split(/\s+/)[0] || 'your customer');
  }
}

/** Cron: a suggested time that can't be agreed any more (less than 3 hours away) is cleared. */
export async function expireReschedules(env: Env) {
  const r = await env.DB.prepare('SELECT id, companion_id FROM bookings WHERE resched_at IS NOT NULL AND resched_at - ?2 < ?1 LIMIT 200')
    .bind(now(), ACCEPT_BEFORE_S).all<{ id: string; companion_id: string }>();
  for (const b of r.results) await env.DB.prepare(`UPDATE bookings SET ${NO_RESCHED} WHERE id = ?`).bind(b.id).run();
  return r.results.length;
}
