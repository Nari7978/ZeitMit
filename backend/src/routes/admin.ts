import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { toCompanion, type CompanionRow } from '../lib/companions';
import { slotsChanged } from '../lib/live';
import { notify } from '../lib/notify';
import { berlinWhen, euros, fail, now, parseJson } from '../lib/util';
import { ACT_LABEL, VIDEO_ACT, type Env } from '../types';
import { balanceOf, groupIban, maskIban, owesPayout } from './payouts';
import { refundBooking, waitSeconds } from './bookings';
import { refundPayment, stripeOn } from '../lib/stripe';
import { freeNowSwitchedOn } from '../lib/hours';
import { dateIn, DEFAULT_TZ, localToUnix } from '../lib/time';
import { callTimeline, explainCall, presenceBars, type CallEvent, type Line } from '../lib/callLog';
import type { Presence, Side } from '../lib/videoDate';
import { JOIN_EARLY_S, PING_MAX } from '../calls';
import { dropUnusedGallery, waitingOf, type ChangeRow, type Field } from '../lib/profileChanges';
import { reviewHints } from '../lib/reviewHints';
import { GALLERY_MIN } from '../lib/companions';

/** Endpoints for the admin panel (admin/ folder). All require role = admin. */
export const admin = new Hono<AppEnv>();

/**
 * Requests ringing on a companion's phone now: a free-now video date (2 minutes to answer), or short notice (half an
 * hour or less to answer, which rings too).
 */
const ringingSql = (b = '') => `(${b}status = 'pending' AND ${b}expires_at >= unixepoch() AND (${b}instant = 1 OR ${b}expires_at - ${b}created_at <= 1800))`;

admin.get('/stats', async (c) => {
  const q = (sql: string) => c.env.DB.prepare(sql).first<{ n: number }>().then((r) => r?.n ?? 0);
  const [users, companions, pendingCompanions, bookings, held, openReports, sos, pendingIds, pendingPayouts, openFeedback, pendingChanges, live] = await Promise.all([
    q('SELECT COUNT(*) AS n FROM users'),
    q("SELECT COUNT(*) AS n FROM companions WHERE status = 'approved'"),
    q("SELECT COUNT(*) AS n FROM companions WHERE status = 'pending'"),
    q('SELECT COUNT(*) AS n FROM bookings'),
    q("SELECT COALESCE(SUM(total), 0) AS n FROM bookings WHERE pay_status = 'held'"),
    q("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
    q("SELECT COUNT(*) AS n FROM checkins WHERE status IN ('sos', 'alerted')"),
    q("SELECT COUNT(*) AS n FROM users WHERE id_status = 'pending'"),
    q("SELECT COUNT(*) AS n FROM payouts WHERE status = 'requested'"),
    q("SELECT COUNT(*) AS n FROM meet_feedback WHERE concern = 1 AND status = 'open'"),
    q("SELECT COUNT(DISTINCT p.companion_id) AS n FROM profile_changes p JOIN companions cp ON cp.user_id = p.companion_id WHERE p.status = 'pending' AND cp.status = 'approved'"),
    // Live now: requests ringing, and video dates on right now.
    q(`SELECT COUNT(*) AS n FROM bookings WHERE paid = 1 AND (${ringingSql()}
         OR (activity = '${VIDEO_ACT}' AND status IN ('confirmed', 'completed') AND call_closed IS NULL AND starts_at <= unixepoch() AND ends_at > unixepoch()))`),
  ]);
  return c.json({ users, companions, pendingCompanions, bookings, heldCents: held, openReports, sos, pendingIds, pendingPayouts, openFeedback, pendingChanges, live });
});

admin.get('/companions', async (c) => {
  const status = c.req.query('status') ?? 'pending';
  const r = await c.env.DB.prepare('SELECT c.*, u.email FROM companions c JOIN users u ON u.id = c.user_id WHERE c.status = ? ORDER BY c.created_at LIMIT 200')
    .bind(status).all<CompanionRow & { email: string }>();
  return c.json(r.results.map((x) => ({ ...toCompanion(x), email: x.email, ageValue: x.age, idPhotoUrl: x.id_photo_id ? `/photos/${x.id_photo_id}` : null })));
});

admin.post('/companions/:id/:decision', async (c) => {
  const decision = c.req.param('decision');
  if (decision !== 'approve' && decision !== 'reject') fail(400, 'Use approve or reject.');
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT id_photo_id FROM companions WHERE user_id = ?').bind(id).first<{ id_photo_id: string | null }>();
  if (!row) fail(404, 'Companion not found.');
  // The ID photo is only needed for this decision: delete it right away (GDPR data minimisation).
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE companions SET status = ?, id_verified = ?, id_photo_id = NULL WHERE user_id = ?')
      .bind(decision === 'approve' ? 'approved' : 'rejected', decision === 'approve' ? 1 : 0, id),
    c.env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(row!.id_photo_id ?? ''),
    // A verified companion can also book as a customer.
    ...(decision === 'approve' ? [c.env.DB.prepare("UPDATE users SET id_status = 'approved' WHERE id = ?").bind(id)] : []),
  ]);
  await notify(c.env, id, decision === 'approve'
    ? { icon: 'badge-check', tone: 'success', title: 'Your companion profile is live', body: 'You’re verified and visible in search. Requests will appear in companion mode.', go: 'comp:overview' }
    : { icon: 'circle-alert', tone: 'error', title: 'Companion profile not approved', body: 'We couldn’t approve your profile. You can change it and apply again.', go: 'become' }, c.executionCtx);
  return c.json({ ok: true });
});

// ---- Profile changes: approved companions' new texts and photos wait here (lib/profileChanges.ts) ----

const LABEL: Record<Field, string> = { about: 'About text', tagline: 'tagline', photo: 'profile photo', gallery: 'photos' };
const photoUrl = (id: string | null) => (id ? `/photos/${id}` : null);

/**
 * Waiting changes, one card per companion (oldest first): for texts the live and the new version, with what the check
 * found in the new words (reviewHints); for photos the live and the new one; for the gallery which photos are new and
 * which go. `?status=approved|rejected`: decided ones, newest first.
 */
admin.get('/profile-changes', async (c) => {
  const status = c.req.query('status') === 'approved' || c.req.query('status') === 'rejected' ? c.req.query('status')! : 'pending';
  if (status !== 'pending') {
    const r = await c.env.DB.prepare(
      `SELECT p.*, cp.display_name AS name FROM profile_changes p JOIN companions cp ON cp.user_id = p.companion_id
       WHERE p.status = ? ORDER BY p.decided_at DESC LIMIT 100`,
    ).bind(status).all<ChangeRow & { name: string }>();
    return c.json(r.results.map((x) => ({
      id: x.id, companionId: x.companion_id, name: x.name, field: x.field, label: LABEL[x.field], createdAt: x.created_at, decidedAt: x.decided_at, note: x.note,
      text: x.field === 'about' || x.field === 'tagline' ? x.value : null,
      photos: x.field === 'photo' ? [photoUrl(x.value)] : x.field === 'gallery' ? parseJson<string[]>(x.value, []).map(photoUrl) : [],
    })));
  }
  const r = await c.env.DB.prepare(
    `SELECT p.*, cp.display_name AS name, cp.photo_id AS live_photo, cp.hue, cp.bio AS live_about, cp.tagline AS live_tagline, cp.gallery AS live_gallery,
       cp.created_at AS since, u.email
     FROM profile_changes p JOIN companions cp ON cp.user_id = p.companion_id JOIN users u ON u.id = p.companion_id
     WHERE p.status = 'pending' AND cp.status = 'approved' ORDER BY p.created_at`,
  ).all<ChangeRow & { name: string; live_photo: string | null; hue: number; live_about: string; live_tagline: string; live_gallery: string; since: number; email: string }>();
  type Card = { companion: { id: string; name: string; email: string; hue: number; photoUrl: string | null; since: number }; changes: unknown[]; firstAt: number; lastAt: number };
  const cards = new Map<string, Card>();
  for (const x of r.results) {
    let card = cards.get(x.companion_id);
    if (!card) {
      card = { companion: { id: x.companion_id, name: x.name, email: x.email, hue: x.hue, photoUrl: photoUrl(x.live_photo), since: x.since }, changes: [], firstAt: x.created_at, lastAt: x.created_at };
      cards.set(x.companion_id, card);
    }
    card.lastAt = Math.max(card.lastAt, x.created_at);
    const base = { id: x.id, field: x.field, label: LABEL[x.field], createdAt: x.created_at };
    if (x.field === 'about' || x.field === 'tagline') {
      const before = x.field === 'about' ? x.live_about : x.live_tagline;
      // Only what's new is worth flagging: words the live text already had were approved before.
      const hints = reviewHints(x.value).map((h) => ({ ...h, words: h.words.filter((w) => !before.toLowerCase().includes(w)) })).filter((h) => h.words.length);
      card.changes.push({ ...base, before, after: x.value, hints });
    } else if (x.field === 'photo') {
      card.changes.push({ ...base, before: photoUrl(x.live_photo), after: photoUrl(x.value) });
    } else {
      const live = parseJson<string[]>(x.live_gallery, []), next = parseJson<string[]>(x.value, []);
      card.changes.push({
        ...base,
        after: next.map((id) => ({ id, url: photoUrl(id), added: !live.includes(id) })),
        removed: live.filter((id) => !next.includes(id)).map((id) => ({ id, url: photoUrl(id) })),
      });
    }
  }
  return c.json([...cards.values()]);
});

/**
 * Decides a companion's waiting changes (`:id`: the companion): `approve` and `reject` (change ids), `dropPhotos` (new gallery photos left
 * out of an approved gallery change) and `note` (needed to reject or leave photos out: the companion sees it). What's
 * approved goes live; what's rejected is deleted (photos) or kept only as history. The companion is told once.
 */
admin.post('/profile-changes/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ approve?: unknown; reject?: unknown; dropPhotos?: unknown; note?: unknown }>().catch(() => ({}) as Record<string, unknown>);
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const approve = new Set(ids(body.approve)), reject = new Set(ids(body.reject)), drop = new Set(ids(body.dropPhotos));
  if (!approve.size && !reject.size) fail(400, 'Choose what to approve or reject.');
  if ([...approve].some((x) => reject.has(x))) fail(400, 'A change can’t be approved and rejected at once.');
  const note = (typeof body.note === 'string' ? body.note : '').trim().replace(/\s+/g, ' ').slice(0, 300);
  const cp = await c.env.DB.prepare('SELECT display_name, photo_id, gallery, status FROM companions WHERE user_id = ?').bind(id)
    .first<{ display_name: string; photo_id: string | null; gallery: string; status: string }>();
  if (!cp) fail(404, 'Companion not found.');
  const waiting = new Map([...(await waitingOf(c.env, id)).values()].map((x) => [x.id, x]));
  for (const x of [...approve, ...reject]) if (!waiting.has(x)) fail(409, 'That change was just replaced or withdrawn by the companion. Reload and try again.');
  const galleryChange = [...approve].map((x) => waiting.get(x)!).find((x) => x.field === 'gallery');
  const newPhotos = galleryChange ? parseJson<string[]>(galleryChange.value, []) : [];
  const dropped = newPhotos.filter((p) => drop.has(p));
  if ((reject.size || dropped.length) && note.length < 3) fail(400, 'Add a short note. The companion sees it.');
  const live = parseJson<string[]>(cp!.gallery, []);
  const mark = (x: ChangeRow, status: 'approved' | 'rejected', n: string | null) =>
    c.env.DB.prepare('UPDATE profile_changes SET status = ?, note = ?, decided_at = unixepoch() WHERE id = ? AND status = ?').bind(status, n, x.id, 'pending');
  const stmts: D1PreparedStatement[] = [];
  for (const x of [...approve].map((k) => waiting.get(k)!)) {
    if (x.field === 'about') stmts.push(c.env.DB.prepare('UPDATE companions SET bio = ? WHERE user_id = ?').bind(x.value, id));
    else if (x.field === 'tagline') stmts.push(c.env.DB.prepare('UPDATE companions SET tagline = ? WHERE user_id = ?').bind(x.value, id));
    else if (x.field === 'photo') {
      stmts.push(
        c.env.DB.prepare('UPDATE companions SET photo_id = ? WHERE user_id = ?').bind(x.value, id),
        c.env.DB.prepare("DELETE FROM photos WHERE id = ? AND owner_id = ? AND kind = 'companion'").bind(cp!.photo_id ?? '', id),
      );
    } else {
      const final = newPhotos.filter((p) => !drop.has(p));
      if (final.length < GALLERY_MIN) fail(409, `That leaves fewer than ${GALLERY_MIN} photos. Reject the photo change instead.`);
      stmts.push(c.env.DB.prepare('UPDATE companions SET gallery = ? WHERE user_id = ?').bind(JSON.stringify(final), id), dropUnusedGallery(c.env, id, final));
    }
    stmts.push(mark(x, 'approved', x.field === 'gallery' && dropped.length ? note : null));
  }
  for (const x of [...reject].map((k) => waiting.get(k)!)) {
    stmts.push(mark(x, 'rejected', note));
    if (x.field === 'photo') stmts.push(c.env.DB.prepare("DELETE FROM photos WHERE id = ? AND owner_id = ? AND kind = 'companion'").bind(x.value, id));
    if (x.field === 'gallery') stmts.push(dropUnusedGallery(c.env, id, live));
  }
  await c.env.DB.batch(stmts);
  // One message for all of it (the listing screen shows which part wasn't approved, with the note).
  const no = new Set([...reject].map((k) => waiting.get(k)!.field));
  const text = no.has('about') || no.has('tagline');
  const photos = no.has('photo') || no.has('gallery') || dropped.length > 0;
  const what = text && photos ? 'Your new text and photos weren’t approved'
    : text ? 'Your new text wasn’t approved'
      : no.has('gallery') || (no.has('photo') && dropped.length) ? 'Your new photos weren’t approved'
        : no.has('photo') ? 'Your new profile photo wasn’t approved' : 'Some of your new photos weren’t approved';
  const said = /[.!?]$/.test(note) ? note : `${note}.`;
  await notify(c.env, id, no.size || dropped.length
    ? {
      icon: 'circle-alert', tone: 'warning', title: approve.size ? 'Some profile changes weren’t approved' : 'Profile changes not approved',
      body: `${what}: ${said} ${approve.size ? 'The rest is live now.' : 'Customers still see your previous version.'}`, go: 'comp:listing',
    }
    : { icon: 'badge-check', tone: 'success', title: 'Profile changes approved', body: 'Your profile changes are live now.', go: 'comp:listing' },
  c.executionCtx);
  return c.json({ ok: true });
});

// ---- Customer ID checks (before the first booking) ----

admin.get('/verifications', async (c) => {
  const status = c.req.query('status') ?? 'pending';
  const r = await c.env.DB.prepare(
    'SELECT id, email, name, id_status, id_doc_photo_id, id_selfie_photo_id, id_submitted_at, id_note, created_at FROM users WHERE id_status = ? ORDER BY id_submitted_at LIMIT 200',
  ).bind(status).all<{ id: string; email: string; name: string; id_status: string; id_doc_photo_id: string | null; id_selfie_photo_id: string | null; id_submitted_at: number | null; id_note: string | null; created_at: number }>();
  return c.json(r.results.map((x) => ({
    id: x.id, email: x.email, name: x.name, status: x.id_status, submittedAt: x.id_submitted_at, note: x.id_note, createdAt: x.created_at,
    idPhotoUrl: x.id_doc_photo_id ? `/photos/${x.id_doc_photo_id}` : null,
    selfieUrl: x.id_selfie_photo_id ? `/photos/${x.id_selfie_photo_id}` : null,
  })));
});

admin.post('/verifications/:id/:decision', async (c) => {
  const decision = c.req.param('decision');
  if (decision !== 'approve' && decision !== 'reject') fail(400, 'Use approve or reject.');
  const id = c.req.param('id');
  const { reason } = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
  const row = await c.env.DB.prepare('SELECT id_doc_photo_id, id_selfie_photo_id FROM users WHERE id = ?').bind(id)
    .first<{ id_doc_photo_id: string | null; id_selfie_photo_id: string | null }>();
  if (!row) fail(404, 'User not found.');
  const note = decision === 'reject' ? (reason?.trim().slice(0, 200) || 'The photos weren’t clear enough to verify you.') : null;
  // The photos are only needed for this decision: delete them right away (GDPR data minimisation).
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET id_status = ?, id_note = ?, id_doc_photo_id = NULL, id_selfie_photo_id = NULL WHERE id = ?')
      .bind(decision === 'approve' ? 'approved' : 'rejected', note, id),
    c.env.DB.prepare('DELETE FROM photos WHERE id IN (?, ?)').bind(row!.id_doc_photo_id ?? '', row!.id_selfie_photo_id ?? ''),
  ]);
  await notify(c.env, id, decision === 'approve'
    ? { icon: 'badge-check', tone: 'success', title: 'You’re verified', body: 'Your ID check is done. You can book companions now.', go: 'home' }
    : { icon: 'circle-alert', tone: 'error', title: 'ID check not approved', body: note!, go: 'verify' }, c.executionCtx);
  return c.json({ ok: true });
});

const BOOKING_STATUSES = ['pending', 'confirmed', 'rejected', 'expired', 'conflicted', 'cancelled', 'completed'];

/**
 * Booking records, newest first: start, end, kind of date, status, acceptance expiry, when it was decided, the booking
 * that took a conflicted one's time, and the payment. `?status=` filters (one of the seven), `?q=` finds a booking
 * id, a customer's email or a companion's name. `counts`: bookings per status.
 */
admin.get('/bookings', async (c) => {
  const status = c.req.query('status') ?? '';
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const where: string[] = ['b.paid = 1'];
  const args: unknown[] = [];
  if (BOOKING_STATUSES.includes(status)) { where.push('b.status = ?'); args.push(status); }
  if (q) { where.push('(lower(b.id) = ? OR lower(u.email) LIKE ? OR lower(cp.display_name) LIKE ?)'); args.push(q, `%${q}%`, `%${q}%`); }
  const [r, counts] = await Promise.all([
    c.env.DB.prepare(
      `SELECT b.id, b.status, b.kind, b.pay_status, b.activity, b.starts_at, b.ends_at, b.created_at, b.expires_at, b.decided_at, b.conflict_with,
         b.total, b.fee, b.subtotal, b.topup, b.refunded, b.billed_minutes, b.cancel_note, b.cancelled_by, b.cancel_reason, u.email AS customer, cp.display_name AS companion, cp.timezone AS companion_tz
       FROM bookings b JOIN users u ON u.id = b.customer_id JOIN companions cp ON cp.user_id = b.companion_id
       WHERE ${where.join(' AND ')} ORDER BY b.created_at DESC LIMIT 200`,
    ).bind(...args).all(),
    c.env.DB.prepare('SELECT status, COUNT(*) AS n FROM bookings WHERE paid = 1 GROUP BY status').all<{ status: string; n: number }>(),
  ]);
  return c.json({ bookings: r.results, counts: Object.fromEntries(counts.results.map((x) => [x.status, x.n])) });
});

/**
 * Conflict checks: confirmed bookings of one companion that haven't ended yet and whose times overlap (there should
 * never be any: accepting is atomic), requests that lost their time to another booking (latest 50, with the one that
 * won), and requests past their expiry the cron hasn't closed yet.
 */
admin.get('/bookings/conflicts', async (c) => {
  const [overlaps, conflicted, stale] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT a.id AS a, b.id AS b, a.companion_id, cp.display_name AS companion, a.starts_at AS a_start, a.ends_at AS a_end, b.starts_at AS b_start, b.ends_at AS b_end,
         a.kind AS a_kind, b.kind AS b_kind
       FROM bookings a JOIN bookings b ON b.companion_id = a.companion_id AND a.id < b.id
         AND a.status IN ('confirmed', 'completed') AND b.status IN ('confirmed', 'completed') AND a.starts_at < b.ends_at AND a.ends_at > b.starts_at
         AND a.ends_at > unixepoch() AND b.ends_at > unixepoch()
       JOIN companions cp ON cp.user_id = a.companion_id LIMIT 100`,
    ),
    c.env.DB.prepare(
      `SELECT x.id, x.starts_at, x.ends_at, x.kind, x.decided_at, x.conflict_with, w.starts_at AS won_start, w.ends_at AS won_end, w.kind AS won_kind, w.status AS won_status,
         cp.display_name AS companion, u.email AS customer
       FROM bookings x LEFT JOIN bookings w ON w.id = x.conflict_with JOIN companions cp ON cp.user_id = x.companion_id JOIN users u ON u.id = x.customer_id
       WHERE x.status = 'conflicted' ORDER BY x.decided_at DESC LIMIT 50`,
    ),
    c.env.DB.prepare("SELECT id, starts_at, expires_at FROM bookings WHERE status = 'pending' AND paid = 1 AND expires_at < unixepoch() LIMIT 50"),
  ]);
  return c.json({ overlaps: overlaps.results, conflicted: conflicted.results, stale: stale.results });
});

/** Support cancels a request or a confirmed booking with a full refund (both sides are told). */
admin.post('/bookings/:id/cancel', async (c) => {
  const b = await c.env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(c.req.param('id')).first<Parameters<typeof refundBooking>[1]>();
  if (!b) fail(404, 'Booking not found.');
  if (b!.status !== 'pending' && b!.status !== 'confirmed') fail(409, `This booking is ${b!.status} already.`);
  if (!(await refundBooking(c.env, b!, (amt) => `Cancelled by ZeitMit support · ${amt} refunded in full`, false, 'support'))) fail(409, 'This booking was just updated. Reload and try again.');
  const when = `${ACT_LABEL[b!.activity]} on ${berlinWhen(b!.starts_at).day}`;
  await notify(c.env, b!.customer_id, { icon: 'receipt', tone: 'neutral', title: 'Booking cancelled by ZeitMit', body: `${when} was cancelled by our support team. ${euros(b!.total)} is refunded in full.`, go: 'tab:cancelled' }, c.executionCtx);
  await notify(c.env, b!.companion_id, { icon: 'calendar-x', tone: 'neutral', title: 'Booking cancelled by ZeitMit', body: `${when} was cancelled by our support team.`, go: 'comp:calendar' }, c.executionCtx);
  return c.json({ ok: true });
});

/**
 * Support refund. A held payment is released (never charged); money that was already taken
 * (completed or late-cancelled bookings) is refunded through Stripe.
 */
admin.post('/bookings/:id/refund', async (c) => {
  const b = await c.env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(c.req.param('id')).first<Parameters<typeof refundBooking>[1]>();
  if (!b) fail(404, 'Booking not found.');
  // What the customer paid in the end (part may have gone back already: a video date paid in part).
  const paid = b!.total - (b!.refunded ?? 0);
  if (b!.pay_status === 'held') {
    if (!(await refundBooking(c.env, b!, (amt) => `Refunded by ZeitMit support · ${amt}`, false, 'support'))) fail(409, 'This payment was just updated. Reload and try again.');
  } else if (b!.pay_status === 'released') {
    if (b!.payment_ref?.startsWith('pi_') && stripeOn(c.env)) {
      try {
        await refundPayment(c.env, b!.payment_ref);
      } catch (e) {
        console.error('Stripe refund failed', b!.id, e);
        fail(409, `Stripe couldn’t refund this payment: ${(e as Error).message}`);
      }
    }
    const res = await c.env.DB.prepare(
      "UPDATE bookings SET pay_status = 'refunded', refunded = total, cancel_note = ?, updated_at = unixepoch() WHERE id = ? AND pay_status = 'released'",
    ).bind(`Refunded by ZeitMit support · ${euros(paid)}`, b!.id).run();
    if (!res.meta.changes) fail(409, 'This payment was just updated. Reload and try again.');
    if (b!.credit_used) await c.env.DB.prepare('UPDATE users SET credit = credit + ? WHERE id = ?').bind(b!.credit_used, b!.customer_id).run();
    await notify(c.env, b!.companion_id, {
      icon: 'receipt', tone: 'warning', title: 'A booking was refunded',
      body: `ZeitMit refunded ${ACT_LABEL[b!.activity]} on ${berlinWhen(b!.starts_at).day} to the customer. ${euros(b!.subtotal + (b!.topup ?? 0))} comes off your earnings.`, go: 'payouts',
    }, c.executionCtx);
  } else {
    fail(409, b!.refunded && b!.refunded < b!.total ? 'Everything but the service fee was already refunded.' : 'This booking was already refunded.');
  }
  await notify(c.env, b!.customer_id, { icon: 'receipt', tone: 'neutral', title: 'Refund issued', body: `ZeitMit support refunded ${euros(paid)} for your booking.`, go: 'tab:cancelled' }, c.executionCtx);
  return c.json({ ok: true });
});

// ---- Live now: Free now, requests ringing, video dates on now, the next hour, SOS ----

/** "Mia S.": a customer's first name and initial (companions go by their listing name). */
const shortName = (name: string | null) => {
  const [first = '', ...rest] = (name || '').trim().split(/\s+/);
  return first ? `${first}${rest.length ? ` ${rest[rest.length - 1][0]}.` : ''}` : 'Customer';
};
const firstName = (name: string | null) => (name || '').trim().split(/\s+/)[0] || 'The customer';

/** What a video date's call room knows (calls.ts `/state`): who is in it, with video, the logs, rings and pings. */
type RoomState = {
  here: Record<Side, boolean>; video: Record<Side, boolean>; together: number;
  log: Presence[]; events: CallEvent[]; rang: Record<Side, { at: number; pings: number }>;
};
async function roomState(env: Env, bookingId: string): Promise<RoomState | null> {
  try {
    const r = await env.CALLS.get(env.CALLS.idFromName(bookingId)).fetch('https://call/state');
    return r.ok ? await r.json<RoomState>() : null;
  } catch (e) {
    console.error('Call room state failed', bookingId, e);
    return null;
  }
}

/** Since when one side has been in the call without the other (null: they aren't). */
function aloneSince(log: Presence[], side: Side) {
  const here: Record<Side, boolean> = { customer: false, companion: false };
  let since: number | null = null;
  for (const e of log) {
    const was = here[side] && !here[side === 'customer' ? 'companion' : 'customer'];
    here[e.s] = e.on;
    const is = here[side] && !here[side === 'customer' ? 'companion' : 'customer'];
    if (is && !was) since = e.t;
    if (!is) since = null;
  }
  return since;
}

admin.get('/live', async (c) => {
  const t = now();
  const today = localToUnix(dateIn(t, DEFAULT_TZ), 0, DEFAULT_TZ) ?? t - 86400;
  const people = 'JOIN users u ON u.id = b.customer_id JOIN companions cp ON cp.user_id = b.companion_id';
  const [free, ringing, calls, soon, sos] = await Promise.all([
    freeNowSwitchedOn(c.env, t),
    c.env.DB.prepare(
      `SELECT b.id, b.instant, b.activity, b.starts_at, b.duration_h, b.total, b.created_at, b.expires_at, u.name AS customer, cp.display_name AS companion, b.companion_id
       FROM bookings b ${people} WHERE b.paid = 1 AND ${ringingSql('b.')}
       ORDER BY b.expires_at LIMIT 50`,
    ).all<{ id: string; instant: number; activity: keyof typeof ACT_LABEL; starts_at: number; duration_h: number; total: number; created_at: number; expires_at: number; customer: string | null; companion: string; companion_id: string }>(),
    c.env.DB.prepare(
      `SELECT b.id, b.starts_at, b.ends_at, u.name AS customer, cp.display_name AS companion FROM bookings b ${people}
       WHERE b.activity = ?2 AND b.paid = 1 AND b.status IN ('confirmed', 'completed') AND b.call_closed IS NULL AND b.starts_at - ?3 <= ?1 AND b.ends_at > ?1
       ORDER BY b.starts_at LIMIT 50`,
    ).bind(t, VIDEO_ACT, JOIN_EARLY_S).all<{ id: string; starts_at: number; ends_at: number; customer: string | null; companion: string }>(),
    c.env.DB.prepare(
      `SELECT b.id, b.activity, b.starts_at, b.ends_at, u.name AS customer, cp.display_name AS companion,
         EXISTS (SELECT 1 FROM checkins k WHERE k.booking_id = b.id AND k.status <> 'ended') AS checkin
       FROM bookings b ${people} WHERE b.status = 'confirmed' AND b.paid = 1 AND b.starts_at > ?1 AND b.starts_at <= ?1 + 3600 ORDER BY b.starts_at LIMIT 50`,
    ).bind(t).all<{ id: string; activity: keyof typeof ACT_LABEL; starts_at: number; ends_at: number; customer: string | null; companion: string; checkin: number }>(),
    c.env.DB.prepare(
      `SELECT k.id, k.status, k.sos_at, k.created_at, k.booking_id, u.name, u.email FROM checkins k JOIN users u ON u.id = k.user_id
       WHERE k.status IN ('sos', 'alerted') ORDER BY COALESCE(k.sos_at, k.created_at) DESC LIMIT 20`,
    ).all(),
  ]);
  // Free now: who they are, and today's free-now requests (answered: accepted or declined; missed: ran out).
  const ids = free.map((f) => f.id);
  const info = ids.length ? (await c.env.DB.prepare(
    `SELECT cp.user_id, cp.display_name, cp.rate, cp.photo_id, cp.hue,
       (SELECT COUNT(*) FROM bookings b WHERE b.companion_id = cp.user_id AND b.instant = 1 AND b.paid = 1 AND b.created_at >= ?
          AND (b.status IN ('confirmed', 'completed', 'rejected') OR (b.status = 'cancelled' AND b.cancelled_by = 'companion'))) AS answered,
       (SELECT COUNT(*) FROM bookings b WHERE b.companion_id = cp.user_id AND b.instant = 1 AND b.paid = 1 AND b.created_at >= ? AND b.status = 'expired') AS missed
     FROM companions cp WHERE cp.user_id IN (${ids.map(() => '?').join(', ')})`,
  ).bind(today, today, ...ids).all<{ user_id: string; display_name: string; rate: number; photo_id: string | null; hue: number; answered: number; missed: number }>()).results : [];
  const byId = new Map(info.map((x) => [x.user_id, x]));
  const rooms = await Promise.all(calls.results.map((b) => roomState(c.env, b.id)));
  return c.json({
    now: t,
    freeNow: free.map((f) => {
      const x = byId.get(f.id);
      return { ...f, name: x?.display_name ?? '', rate: x?.rate ?? 0, hue: x?.hue ?? 0, photoUrl: x?.photo_id ? `/photos/${x.photo_id}` : null, answered: x?.answered ?? 0, missed: x?.missed ?? 0 };
    }).sort((a, b) => a.name.localeCompare(b.name)),
    ringing: ringing.results.map((b) => ({
      id: b.id, instant: !!b.instant, act: ACT_LABEL[b.activity], video: b.activity === VIDEO_ACT, startsAt: b.starts_at, minutes: Math.round(b.duration_h * 60),
      total: b.total, createdAt: b.created_at, expiresAt: b.expires_at, customer: shortName(b.customer), companion: b.companion, companionId: b.companion_id,
    })),
    calls: calls.results.map((b, i) => {
      const r = rooms[i];
      const here = r?.here ?? { customer: false, companion: false };
      const side: Side | null = here.customer === here.companion ? null : here.customer ? 'customer' : 'companion';
      return {
        id: b.id, startsAt: b.starts_at, endsAt: b.ends_at, customer: shortName(b.customer), companion: b.companion, here,
        video: !!(r?.video.customer && r?.video.companion), together: r?.together ?? 0, joined: !!r?.log.length,
        alone: side ? { side, since: aloneSince(r!.log, side), pings: r!.rang[side]?.pings ?? 0 } : null,
      };
    }),
    soon: soon.results.map((b) => ({
      id: b.id, act: ACT_LABEL[b.activity], video: b.activity === VIDEO_ACT, startsAt: b.starts_at, endsAt: b.ends_at,
      customer: shortName(b.customer), companion: b.companion, checkin: !!b.checkin,
    })),
    sos: sos.results,
  });
});

/** Switches a companion's Free now off (they don't answer, or shouldn't be reachable now). They're told. */
admin.post('/companions/:id/free-now/off', async (c) => {
  const id = c.req.param('id');
  const res = await c.env.DB.prepare('UPDATE companions SET free_now_until = NULL, free_now_misses = 0, free_now_paused = NULL WHERE user_id = ? AND free_now_until > unixepoch()')
    .bind(id).run();
  if (!res.meta.changes) fail(409, 'Free now is already off for them.');
  void slotsChanged(c.env, id, c.executionCtx); // open profiles stop showing Free now
  await notify(c.env, id, {
    icon: 'info', tone: 'warning', title: 'Free now is off',
    body: 'ZeitMit switched off Free now for you. Turn it on again when you’re ready to answer video date requests right away.', go: 'comp:overview',
  }, c.executionCtx);
  return c.json({ ok: true });
});

// ---- A video date's call: who was in it, why it was paid like that, what happened ----

type CallBooking = Parameters<typeof refundBooking>[1] & {
  customer_name: string | null; customer_email: string; customer_id_status: string; companion_name: string; companion_email: string; topup: number;
};

admin.get('/bookings/:id/call', async (c) => {
  const b = await c.env.DB.prepare(
    `SELECT b.*, u.name AS customer_name, u.email AS customer_email, u.id_status AS customer_id_status, cp.display_name AS companion_name, cu.email AS companion_email
     FROM bookings b JOIN users u ON u.id = b.customer_id JOIN companions cp ON cp.user_id = b.companion_id JOIN users cu ON cu.id = b.companion_id WHERE b.id = ?`,
  ).bind(c.req.param('id')).first<CallBooking>();
  if (!b) fail(404, 'Booking not found.');
  if (b!.activity !== VIDEO_ACT) fail(409, 'This booking isn’t a video date.');
  const t = now();
  const room = b!.paid ? await roomState(c.env, b!.id) : null;
  const log = room?.log ?? [], events = room?.events ?? [];
  const names = { customer: firstName(b!.customer_name), companion: b!.companion_name };
  const C = names.customer, P = names.companion;
  const clock = (u: number) => berlinWhen(u).time;
  const { why, unpaid } = explainCall({ log, events, start: b!.starts_at, end: b!.ends_at, wait: waitSeconds(c.env), now: t, names, clock });
  const share = b!.total - b!.fee;
  const booked = Math.round((b!.ends_at - b!.starts_at) / 60);
  const settled = !!b!.call_closed;
  // How it ended up, in money.
  if (b!.status === 'pending') why.push(`Waiting for ${P} to accept.`);
  else if (b!.status === 'confirmed' && b!.pay_status === 'held') {
    why.push(t < b!.starts_at ? `Starts at ${clock(b!.starts_at)}. It’s settled at the booked end, from who was in the call.`
      : t < b!.ends_at ? `On now. It’s settled at the booked end (${clock(b!.ends_at)}), from who was in the call.`
        : 'The booked time is over: it’s settled within a minute.');
  } else if (settled && b!.pay_status === 'released' && b!.status === 'completed') {
    why.push(b!.billed_minutes != null
      ? `${P} is paid for ${b!.billed_minutes} of ${booked} minutes: ${euros(b!.subtotal)}. ${euros(b!.refunded)} went back to ${C}.`
      : `${P} is paid in full: ${euros(b!.subtotal)}.`);
    if (b!.topup) why.push(`ZeitMit then paid ${P} the missing ${euros(b!.topup)}, so they got the full ${euros(share)}.`);
  } else if (settled && b!.pay_status === 'released' && b!.status === 'cancelled') {
    why.push(`${C} didn’t join. ${P} was there, so ${P} is paid in full: ${euros(b!.subtotal)}.`);
  } else if (b!.cancel_note) why.push(`${b!.cancel_note}.`);
  // What happened up to the booked end (the room ending the call then isn't anyone leaving).
  const timeline: Line[] = callTimeline(log.filter((e) => e.t < b!.ends_at), events.filter((e) => e.t < b!.ends_at), names, PING_MAX);
  if (settled) timeline.push({ t: b!.ends_at, text: 'Booked time over · settled' });
  else if (b!.status === 'confirmed' && t >= b!.ends_at) timeline.push({ t: b!.ends_at, text: 'Booked time over · not settled yet', tone: 'warn' });
  const [reports, concerns] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE (reporter_id = ?1 AND target_id = ?2) OR (reporter_id = ?2 AND target_id = ?1)')
      .bind(b!.customer_id, b!.companion_id).first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM meet_feedback WHERE booking_id = ? AND concern = 1').bind(b!.id).first<{ n: number }>(),
  ]);
  const from = Math.min(b!.starts_at - JOIN_EARLY_S, ...log.map((e) => e.t));
  const earned = b!.pay_status === 'released' ? b!.subtotal + (b!.topup ?? 0) : 0;
  return c.json({
    booking: {
      id: b!.id, status: b!.status, payStatus: b!.pay_status, instant: !!b!.instant, startsAt: b!.starts_at, endsAt: b!.ends_at, minutes: booked,
      createdAt: b!.created_at, decidedAt: b!.decided_at, settledAt: b!.call_closed,
      customer: { id: b!.customer_id, name: b!.customer_name || 'Customer', first: C, email: b!.customer_email, verified: b!.customer_id_status === 'approved' },
      companion: { id: b!.companion_id, name: P, email: b!.companion_email },
      cancelNote: b!.cancel_note,
    },
    money: {
      total: b!.total, fee: b!.fee, share, refunded: b!.refunded, paid: b!.total - b!.refunded, earned, topup: b!.topup ?? 0,
      billedMinutes: b!.billed_minutes, held: b!.pay_status === 'held',
    },
    // While it's on: who is in the call right now.
    now: room && !settled && t < b!.ends_at && t >= b!.starts_at - JOIN_EARLY_S ? { here: room.here, video: !!(room.video.customer && room.video.companion) } : null,
    axis: { from, to: b!.ends_at },
    bars: presenceBars(log, from, Math.min(b!.ends_at, t)),
    unpaid,
    together: Math.max(b!.call_together_s ?? 0, room?.together ?? 0),
    why, timeline,
    reports: reports?.n ?? 0, concerns: concerns?.n ?? 0,
    canPayInFull: b!.status === 'completed' && b!.pay_status === 'released' && earned < share,
    canRefund: b!.pay_status === 'held' || b!.pay_status === 'released',
  });
});

/**
 * Pays the companion in full for a video date that was paid in part (support decided the missing minutes weren't their
 * fault). ZeitMit pays the difference (`topup`); the customer keeps their refund. The companion is told.
 */
admin.post('/bookings/:id/pay-in-full', async (c) => {
  const b = await c.env.DB.prepare('SELECT b.*, u.name AS customer_name FROM bookings b JOIN users u ON u.id = b.customer_id WHERE b.id = ?')
    .bind(c.req.param('id')).first<CallBooking>();
  if (!b) fail(404, 'Booking not found.');
  const missing = b!.total - b!.fee - b!.subtotal - (b!.topup ?? 0);
  if (b!.activity !== VIDEO_ACT || b!.status !== 'completed' || b!.pay_status !== 'released') fail(409, 'Only a video date that was paid in part can be paid in full.');
  if (missing <= 0) fail(409, 'This video date is paid in full already.');
  const res = await c.env.DB.prepare("UPDATE bookings SET topup = topup + ?, updated_at = unixepoch() WHERE id = ? AND pay_status = 'released' AND topup = ?")
    .bind(missing, b!.id, b!.topup ?? 0).run();
  if (!res.meta.changes) fail(409, 'This booking was just updated. Reload and try again.');
  await notify(c.env, b!.companion_id, {
    icon: 'wallet', tone: 'success', title: 'Paid in full by ZeitMit',
    body: `ZeitMit added ${euros(missing)} for your video date on ${berlinWhen(b!.starts_at).day} with ${firstName(b!.customer_name)}, so you get the full ${euros(b!.total - b!.fee)}.`, go: 'payouts',
  }, c.executionCtx);
  return c.json({ ok: true, topup: missing });
});

admin.get('/reports', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT r.*, a.email AS reporter, t.email AS target FROM reports r JOIN users a ON a.id = r.reporter_id JOIN users t ON t.id = r.target_id
     ORDER BY r.status = 'resolved', r.created_at DESC LIMIT 200`,
  ).all();
  const flagged = await c.env.DB.prepare(
    'SELECT m.id, m.body, m.created_at, u.email AS sender FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.flagged = 1 ORDER BY m.created_at DESC LIMIT 100',
  ).all();
  const sos = await c.env.DB.prepare(
    "SELECT k.*, u.email FROM checkins k JOIN users u ON u.id = k.user_id WHERE k.status IN ('sos', 'alerted') ORDER BY k.created_at DESC LIMIT 100",
  ).all();
  return c.json({ reports: r.results, flaggedMessages: flagged.results, sos: sos.results });
});

/**
 * Private feedback after meet-ups: concerns first (open, then reviewed), or everything with ?show=all. Each answer
 * comes with what others said about the same person, to spot patterns.
 */
admin.get('/feedback', async (c) => {
  const all = c.req.query('show') === 'all';
  const r = await c.env.DB.prepare(
    `SELECT f.*, b.activity, b.starts_at, b.duration_h, fu.email AS from_email, fu.name AS from_name, au.email AS about_email, au.name AS about_name,
       (SELECT COUNT(*) FROM meet_feedback x WHERE x.about_id = f.about_id) AS about_count,
       (SELECT ROUND(AVG(x.stars), 1) FROM meet_feedback x WHERE x.about_id = f.about_id) AS about_stars,
       (SELECT COUNT(*) FROM meet_feedback x WHERE x.about_id = f.about_id AND x.safe = 'no') AS about_unsafe
     FROM meet_feedback f JOIN bookings b ON b.id = f.booking_id JOIN users fu ON fu.id = f.from_id JOIN users au ON au.id = f.about_id
     ${all ? '' : 'WHERE f.concern = 1'}
     ORDER BY (f.concern = 1 AND f.status = 'open') DESC, f.created_at DESC LIMIT 300`,
  ).all<Record<string, unknown> & { tags: string; activity: keyof typeof ACT_LABEL; starts_at: number }>();
  return c.json(r.results.map((x) => ({ ...x, tags: parseJson<string[]>(x.tags, []), act: ACT_LABEL[x.activity], when: berlinWhen(x.starts_at).full })));
});

admin.post('/feedback/:id/review', async (c) => {
  const res = await c.env.DB.prepare("UPDATE meet_feedback SET status = 'reviewed' WHERE id = ?").bind(c.req.param('id')).run();
  if (!res.meta.changes) fail(404, 'Feedback not found.');
  return c.json({ ok: true });
});

admin.post('/reports/:id/resolve', async (c) => {
  await c.env.DB.prepare("UPDATE reports SET status = 'resolved' WHERE id = ?").bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

admin.get('/users', async (c) => {
  const q = `%${(c.req.query('q') ?? '').toLowerCase()}%`;
  const r = await c.env.DB.prepare('SELECT id, email, name, role, suspended, id_status, created_at FROM users WHERE lower(email) LIKE ? OR lower(name) LIKE ? ORDER BY created_at DESC LIMIT 200')
    .bind(q, q).all();
  return c.json(r.results);
});

admin.post('/users/:id/suspend', async (c) => {
  const { suspended } = await c.req.json<{ suspended: boolean }>();
  if (c.req.param('id') === c.get('user').id) fail(400, 'You can’t suspend yourself.');
  await c.env.DB.prepare('UPDATE users SET suspended = ? WHERE id = ?').bind(suspended ? 1 : 0, c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---- Deleting ----

const RATING_SQL = `UPDATE companions SET review_count = (SELECT COUNT(*) FROM reviews WHERE companion_id = ?1),
  rating = CASE WHEN (SELECT COUNT(*) FROM reviews WHERE companion_id = ?1) >= 3
                THEN ROUND((SELECT AVG(stars) FROM reviews WHERE companion_id = ?1), 1) ELSE NULL END
  WHERE user_id = ?1`;

/** Refunds every held payment still open on bookings where this person is the customer or the companion. */
async function refundOpen(env: AppEnv['Bindings'], col: 'customer_id' | 'companion_id' | 'both', id: string) {
  const where = col === 'both' ? '(customer_id = ?1 OR companion_id = ?1)' : `${col} = ?1`;
  const open = await env.DB.prepare(`SELECT * FROM bookings WHERE ${where} AND status IN ('pending', 'confirmed') AND pay_status = 'held'`)
    .bind(id).all<Parameters<typeof refundBooking>[1]>();
  let n = 0;
  for (const b of open.results) if (await refundBooking(env, b, (amt) => `Cancelled by ZeitMit support · ${amt} refunded`, false, 'support')) n++;
  return n;
}

/** Deletes an account and everything linked to it. Open bookings are cancelled and refunded first. */
admin.delete('/users/:id', async (c) => {
  const id = c.req.param('id');
  if (id === c.get('user').id) fail(400, 'You can’t delete your own account here.');
  const u = await c.env.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(id).first<{ id: string; email: string }>();
  if (!u) fail(404, 'User not found.');
  // Money ZeitMit still owes them would disappear with the account: pay or reject it first, or force.
  const owed = await owesPayout(c.env, id);
  if (owed.owed && c.req.query('force') !== '1') {
    return c.json({ error: `${u!.email} still has ${euros(owed.available + owed.pending + owed.requested)} in earnings that hasn’t been paid out.`, code: 'unpaid' }, 409);
  }
  const refunded = await refundOpen(c.env, 'both', id);
  // Companions this person reviewed: their ratings are recalculated afterwards.
  const reviewed = await c.env.DB.prepare(
    'SELECT DISTINCT r.companion_id FROM reviews r JOIN bookings b ON b.id = r.booking_id WHERE b.customer_id = ? AND r.companion_id <> ?',
  ).bind(id, id).all<{ companion_id: string }>();
  // Checkouts they left unpaid hold times with other companions until deleted below.
  const holds = await c.env.DB.prepare('SELECT DISTINCT companion_id FROM bookings WHERE customer_id = ? AND paid = 0 AND companion_id <> ?').bind(id, id).all<{ companion_id: string }>();
  const mine = '(SELECT id FROM bookings WHERE customer_id = ?1 OR companion_id = ?1)';
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM conversations WHERE customer_id = ?1 OR companion_id = ?1').bind(id),
    c.env.DB.prepare(`DELETE FROM checkins WHERE user_id = ?1 OR booking_id IN ${mine}`).bind(id),
    c.env.DB.prepare(`DELETE FROM reviews WHERE companion_id = ?1 OR booking_id IN ${mine}`).bind(id),
    c.env.DB.prepare(`DELETE FROM meet_feedback WHERE from_id = ?1 OR about_id = ?1 OR booking_id IN ${mine}`).bind(id),
    c.env.DB.prepare('DELETE FROM messages WHERE sender_id = ?1').bind(id),
    c.env.DB.prepare('DELETE FROM bookings WHERE customer_id = ?1 OR companion_id = ?1').bind(id),
    c.env.DB.prepare('DELETE FROM reports WHERE reporter_id = ?1 OR target_id = ?1').bind(id),
    c.env.DB.prepare('UPDATE gifts SET redeemed_by = NULL WHERE redeemed_by = ?1').bind(id),
    c.env.DB.prepare('DELETE FROM gifts WHERE sender_id = ?1').bind(id),
    c.env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(u!.email),
    c.env.DB.prepare('DELETE FROM payouts WHERE companion_id = ?1').bind(id),
    // companions, availability, saved, blocks, notifications, photos and the payout account cascade.
    c.env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(id),
  ]);
  // D1 rejects an empty batch, so only run it when there is something to update.
  if (reviewed.results.length) await c.env.DB.batch(reviewed.results.map((x) => c.env.DB.prepare(RATING_SQL).bind(x.companion_id)));
  for (const h of holds.results) void slotsChanged(c.env, h.companion_id, c.executionCtx);
  return c.json({ ok: true, refunded });
});

/**
 * Takes a companion listing out of the app. Open bookings with them are cancelled and refunded; their earnings,
 * payouts and booking history stay, so ZeitMit can still pay what they earned. Their account stays too.
 */
admin.delete('/companions/:id', async (c) => {
  const id = c.req.param('id');
  const cp = await c.env.DB.prepare('SELECT id_photo_id FROM companions WHERE user_id = ?').bind(id).first<{ id_photo_id: string | null }>();
  if (!cp) fail(404, 'Companion not found.');
  const refunded = await refundOpen(c.env, 'companion_id', id);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE companions SET status = 'rejected', id_verified = 0, id_photo_id = NULL WHERE user_id = ?").bind(id),
    c.env.DB.prepare('DELETE FROM hours_week WHERE companion_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM hours_days WHERE companion_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM hours_blocks WHERE companion_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM saved WHERE companion_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(cp!.id_photo_id ?? ''),
  ]);
  void slotsChanged(c.env, id, c.executionCtx); // open profiles lose their times at once
  await notify(c.env, id, { icon: 'circle-alert', tone: 'error', title: 'Your companion profile was removed', body: 'ZeitMit took your listing down. You can still withdraw what you’ve earned. Contact support if you have questions.', go: 'payouts' }, c.executionCtx);
  return c.json({ ok: true, refunded });
});

// ---- Payouts (sent by hand as bank transfers) ----

admin.get('/payouts', async (c) => {
  const status = ['requested', 'paid', 'rejected'].includes(c.req.query('status') ?? '') ? c.req.query('status')! : 'requested';
  const r = await c.env.DB.prepare(
    `SELECT p.*, u.email, u.name AS user_name, cp.display_name FROM payouts p JOIN users u ON u.id = p.companion_id
     LEFT JOIN companions cp ON cp.user_id = p.companion_id WHERE p.status = ?
     ORDER BY ${status === 'requested' ? 'p.created_at' : 'p.decided_at DESC'} LIMIT 200`,
  ).bind(status).all<{
    id: string; companion_id: string; amount: number; status: string; holder_name: string; iban: string; reference: string | null; note: string | null;
    created_at: number; decided_at: number | null; email: string; user_name: string; display_name: string | null;
  }>();
  const rows = await Promise.all(r.results.map(async (p) => {
    // A refund after the request can leave them owing money: show by how much the request is now too high.
    const shortBy = status === 'requested' ? Math.max(0, -(await balanceOf(c.env, p.companion_id)).available) : 0;
    return {
      id: p.id, amount: p.amount, status: p.status, holderName: p.holder_name, iban: groupIban(p.iban), reference: p.reference, note: p.note,
      createdAt: p.created_at, decidedAt: p.decided_at, email: p.email, name: p.display_name || p.user_name, accountName: p.user_name, shortBy,
    };
  }));
  return c.json(rows);
});

admin.post('/payouts/:id/paid', async (c) => {
  const { reference } = await c.req.json<{ reference?: string }>().catch(() => ({}) as { reference?: string });
  const p = await c.env.DB.prepare("SELECT * FROM payouts WHERE id = ? AND status = 'requested'").bind(c.req.param('id')).first<{ id: string; companion_id: string; amount: number; iban: string }>();
  if (!p) fail(409, 'This payout was already handled.');
  const res = await c.env.DB.prepare("UPDATE payouts SET status = 'paid', reference = ?, decided_at = unixepoch() WHERE id = ? AND status = 'requested'")
    .bind((reference ?? '').trim().slice(0, 80) || null, p!.id).run();
  if (!res.meta.changes) fail(409, 'This payout was already handled.');
  await notify(c.env, p!.companion_id, {
    icon: 'wallet', tone: 'success', title: 'Payout sent', body: `${euros(p!.amount)} is on its way to ${maskIban(p!.iban)}. Bank transfers usually arrive within 1–2 working days.`, go: 'payouts',
  }, c.executionCtx);
  return c.json({ ok: true });
});

admin.post('/payouts/:id/reject', async (c) => {
  const { reason } = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
  const why = (reason ?? '').trim().slice(0, 200);
  if (why.length < 3) fail(400, 'Add a short reason. The companion will see it.');
  const p = await c.env.DB.prepare("SELECT id, companion_id, amount FROM payouts WHERE id = ? AND status = 'requested'").bind(c.req.param('id')).first<{ id: string; companion_id: string; amount: number }>();
  if (!p) fail(409, 'This payout was already handled.');
  const res = await c.env.DB.prepare("UPDATE payouts SET status = 'rejected', note = ?, decided_at = unixepoch() WHERE id = ? AND status = 'requested'").bind(why, p!.id).run();
  if (!res.meta.changes) fail(409, 'This payout was already handled.');
  await notify(c.env, p!.companion_id, {
    icon: 'circle-alert', tone: 'error', title: 'Payout not sent', body: `${why} The ${euros(p!.amount)} is back in your balance.`, go: 'payouts',
  }, c.executionCtx);
  return c.json({ ok: true });
});

admin.get('/reviews', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT r.id, r.author_name, r.activity, r.stars, r.text, r.created_at, cp.display_name AS companion, cp.user_id AS companion_id
     FROM reviews r JOIN companions cp ON cp.user_id = r.companion_id ORDER BY r.created_at DESC LIMIT 200`,
  ).all();
  return c.json(r.results);
});

admin.delete('/reviews/:id', async (c) => {
  const r = await c.env.DB.prepare('SELECT companion_id FROM reviews WHERE id = ?').bind(c.req.param('id')).first<{ companion_id: string }>();
  if (!r) fail(404, 'Review not found.');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM reviews WHERE id = ?').bind(c.req.param('id')),
    c.env.DB.prepare(RATING_SQL).bind(r!.companion_id),
  ]);
  return c.json({ ok: true });
});
