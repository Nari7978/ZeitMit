import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { toCompanion, type CompanionRow } from '../lib/companions';
import { slotsChanged } from '../lib/live';
import { notify } from '../lib/notify';
import { berlinWhen, euros, fail } from '../lib/util';
import { ACT_LABEL } from '../types';
import { balanceOf, groupIban, maskIban, owesPayout } from './payouts';
import { refundBooking } from './bookings';
import { refundPayment, stripeOn } from '../lib/stripe';

/** Endpoints for the admin panel (admin/ folder). All require role = admin. */
export const admin = new Hono<AppEnv>();

admin.get('/stats', async (c) => {
  const q = (sql: string) => c.env.DB.prepare(sql).first<{ n: number }>().then((r) => r?.n ?? 0);
  const [users, companions, pendingCompanions, bookings, held, openReports, sos, pendingIds, pendingPayouts] = await Promise.all([
    q('SELECT COUNT(*) AS n FROM users'),
    q("SELECT COUNT(*) AS n FROM companions WHERE status = 'approved'"),
    q("SELECT COUNT(*) AS n FROM companions WHERE status = 'pending'"),
    q('SELECT COUNT(*) AS n FROM bookings'),
    q("SELECT COALESCE(SUM(total), 0) AS n FROM bookings WHERE pay_status = 'held'"),
    q("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
    q("SELECT COUNT(*) AS n FROM checkins WHERE status IN ('sos', 'alerted')"),
    q("SELECT COUNT(*) AS n FROM users WHERE id_status = 'pending'"),
    q("SELECT COUNT(*) AS n FROM payouts WHERE status = 'requested'"),
  ]);
  return c.json({ users, companions, pendingCompanions, bookings, heldCents: held, openReports, sos, pendingIds, pendingPayouts });
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

admin.get('/bookings', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT b.id, b.status, b.pay_status, b.activity, b.starts_at, b.total, b.cancel_note, b.cancelled_by, b.cancel_reason, u.email AS customer, cp.display_name AS companion
     FROM bookings b JOIN users u ON u.id = b.customer_id JOIN companions cp ON cp.user_id = b.companion_id
     ORDER BY b.created_at DESC LIMIT 200`,
  ).all();
  return c.json(r.results);
});

/**
 * Support refund. A held payment is released (never charged); money that was already taken
 * (completed or late-cancelled bookings) is refunded through Stripe.
 */
admin.post('/bookings/:id/refund', async (c) => {
  const b = await c.env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(c.req.param('id')).first<Parameters<typeof refundBooking>[1]>();
  if (!b) fail(404, 'Booking not found.');
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
      "UPDATE bookings SET pay_status = 'refunded', cancel_note = ?, updated_at = unixepoch() WHERE id = ? AND pay_status = 'released'",
    ).bind(`Refunded by ZeitMit support · ${euros(b!.total)}`, b!.id).run();
    if (!res.meta.changes) fail(409, 'This payment was just updated. Reload and try again.');
    if (b!.credit_used) await c.env.DB.prepare('UPDATE users SET credit = credit + ? WHERE id = ?').bind(b!.credit_used, b!.customer_id).run();
    await notify(c.env, b!.companion_id, {
      icon: 'receipt', tone: 'warning', title: 'A booking was refunded',
      body: `ZeitMit refunded ${ACT_LABEL[b!.activity]} on ${berlinWhen(b!.starts_at).day} to the customer. ${euros(b!.subtotal)} comes off your earnings.`, go: 'payouts',
    }, c.executionCtx);
  } else {
    fail(409, 'This booking was already refunded.');
  }
  await notify(c.env, b!.customer_id, { icon: 'receipt', tone: 'neutral', title: 'Refund issued', body: `ZeitMit support refunded ${euros(b!.total)} for your booking.`, go: 'tab:cancelled' }, c.executionCtx);
  return c.json({ ok: true });
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
    c.env.DB.prepare('DELETE FROM availability WHERE companion_id = ?').bind(id),
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
