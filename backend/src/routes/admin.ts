import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { toCompanion, type CompanionRow } from '../lib/companions';
import { notify } from '../lib/notify';
import { euros, fail } from '../lib/util';
import { refundBooking } from './bookings';

/** Endpoints for the admin panel (admin/ folder). All require role = admin. */
export const admin = new Hono<AppEnv>();

admin.get('/stats', async (c) => {
  const q = (sql: string) => c.env.DB.prepare(sql).first<{ n: number }>().then((r) => r?.n ?? 0);
  const [users, companions, pendingCompanions, bookings, held, openReports, sos, pendingIds] = await Promise.all([
    q('SELECT COUNT(*) AS n FROM users'),
    q("SELECT COUNT(*) AS n FROM companions WHERE status = 'approved'"),
    q("SELECT COUNT(*) AS n FROM companions WHERE status = 'pending'"),
    q('SELECT COUNT(*) AS n FROM bookings'),
    q("SELECT COALESCE(SUM(total), 0) AS n FROM bookings WHERE pay_status = 'held'"),
    q("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
    q("SELECT COUNT(*) AS n FROM checkins WHERE status IN ('sos', 'alerted')"),
    q("SELECT COUNT(*) AS n FROM users WHERE id_status = 'pending'"),
  ]);
  return c.json({ users, companions, pendingCompanions, bookings, heldCents: held, openReports, sos, pendingIds });
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
    : { icon: 'circle-alert', tone: 'error', title: 'Companion profile not approved', body: 'We couldn’t approve your profile. Check your email for details.', go: '' }, c.executionCtx);
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
    ? { icon: 'badge-check', tone: 'success', title: 'You’re verified', body: 'Your ID check is done. You can book companions now.', go: '' }
    : { icon: 'circle-alert', tone: 'error', title: 'ID check not approved', body: note!, go: 'verify' }, c.executionCtx);
  return c.json({ ok: true });
});

admin.get('/bookings', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT b.id, b.status, b.pay_status, b.activity, b.starts_at, b.total, u.email AS customer, cp.display_name AS companion
     FROM bookings b JOIN users u ON u.id = b.customer_id JOIN companions cp ON cp.user_id = b.companion_id
     ORDER BY b.created_at DESC LIMIT 200`,
  ).all();
  return c.json(r.results);
});

admin.post('/bookings/:id/refund', async (c) => {
  const b = await c.env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(c.req.param('id')).first<Parameters<typeof refundBooking>[1]>();
  if (!b || !(await refundBooking(c.env, b, (amt) => `Refunded by ZeitMit support · ${amt}`))) fail(409, 'Only held payments can be refunded.');
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
