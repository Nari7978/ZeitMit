import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { toCompanion, type CompanionRow } from '../lib/companions';
import { notify } from '../lib/notify';
import { fail } from '../lib/util';

/** Endpoints for the admin panel (admin/ folder). All require role = admin. */
export const admin = new Hono<AppEnv>();

admin.get('/stats', async (c) => {
  const q = (sql: string) => c.env.DB.prepare(sql).first<{ n: number }>().then((r) => r?.n ?? 0);
  const [users, companions, pendingCompanions, bookings, held, openReports, sos] = await Promise.all([
    q('SELECT COUNT(*) AS n FROM users'),
    q("SELECT COUNT(*) AS n FROM companions WHERE status = 'approved'"),
    q("SELECT COUNT(*) AS n FROM companions WHERE status = 'pending'"),
    q('SELECT COUNT(*) AS n FROM bookings'),
    q("SELECT COALESCE(SUM(total), 0) AS n FROM bookings WHERE pay_status = 'held'"),
    q("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
    q("SELECT COUNT(*) AS n FROM checkins WHERE status IN ('sos', 'alerted')"),
  ]);
  return c.json({ users, companions, pendingCompanions, bookings, heldCents: held, openReports, sos });
});

admin.get('/companions', async (c) => {
  const status = c.req.query('status') ?? 'pending';
  const r = await c.env.DB.prepare('SELECT c.*, u.email FROM companions c JOIN users u ON u.id = c.user_id WHERE c.status = ? ORDER BY c.created_at LIMIT 200')
    .bind(status).all<CompanionRow & { email: string }>();
  return c.json(r.results.map((x) => ({ ...toCompanion(x), email: x.email })));
});

admin.post('/companions/:id/:decision', async (c) => {
  const decision = c.req.param('decision');
  if (decision !== 'approve' && decision !== 'reject') fail(400, 'Use approve or reject.');
  const id = c.req.param('id');
  const res = await c.env.DB.prepare('UPDATE companions SET status = ?, id_verified = ? WHERE user_id = ?')
    .bind(decision === 'approve' ? 'approved' : 'rejected', decision === 'approve' ? 1 : 0, id).run();
  if (!res.meta.changes) fail(404, 'Companion not found.');
  await notify(c.env, id, decision === 'approve'
    ? { icon: 'badge-check', tone: 'success', title: 'Your companion profile is live', body: 'You’re verified and visible in search. Requests will appear in companion mode.', go: 'comp:overview' }
    : { icon: 'circle-alert', tone: 'error', title: 'Companion profile not approved', body: 'We couldn’t approve your profile. Check your email for details.', go: '' }, c.executionCtx);
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
  // TODO(payments): refund through Stripe.
  const res = await c.env.DB.prepare("UPDATE bookings SET status = 'cancelled', pay_status = 'refunded', cancel_note = 'Refunded by ZeitMit support' WHERE id = ? AND pay_status = 'held'")
    .bind(c.req.param('id')).run();
  if (!res.meta.changes) fail(409, 'Only held payments can be refunded.');
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
  const r = await c.env.DB.prepare('SELECT id, email, name, role, suspended, created_at FROM users WHERE lower(email) LIKE ? OR lower(name) LIKE ? ORDER BY created_at DESC LIMIT 200')
    .bind(q, q).all();
  return c.json(r.results);
});

admin.post('/users/:id/suspend', async (c) => {
  const { suspended } = await c.req.json<{ suspended: boolean }>();
  if (c.req.param('id') === c.get('user').id) fail(400, 'You can’t suspend yourself.');
  await c.env.DB.prepare('UPDATE users SET suspended = ? WHERE id = ?').bind(suspended ? 1 : 0, c.req.param('id')).run();
  return c.json({ ok: true });
});
