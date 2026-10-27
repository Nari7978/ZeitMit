import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { fail, parseJson } from '../lib/util';

export type Prefs = {
  pushMessages: boolean; pushBookings: boolean; emailUpdates: boolean; marketing: boolean;
  showOnline: boolean; readReceipts: boolean; discoveryPref: 'any' | 'w' | 'm' | 'nb'; discoveryMaxRate: number;
};
export const DEFAULT_PREFS: Prefs = {
  pushMessages: true, pushBookings: true, emailUpdates: true, marketing: false,
  showOnline: true, readReceipts: true, discoveryPref: 'any', discoveryMaxRate: 60,
};

export const me = new Hono<AppEnv>();

me.get('/', async (c) => {
  const u = c.get('user');
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.bio, u.role, u.age_confirmed, u.created_at, u.avatar_id, u.credit, u.prefs, u.language,
            c.status AS companion_status
     FROM users u LEFT JOIN companions c ON c.user_id = u.id WHERE u.id = ?`,
  ).bind(u.id).first<Record<string, unknown> & { avatar_id: string | null; prefs: string; companion_status: string | null }>();
  const saved = await c.env.DB.prepare('SELECT companion_id FROM saved WHERE user_id = ? ORDER BY created_at').bind(u.id).all<{ companion_id: string }>();
  return c.json({
    ...row,
    avatarUrl: row?.avatar_id ? `/photos/${row.avatar_id}` : null,
    prefs: { ...DEFAULT_PREFS, ...parseJson<Partial<Prefs>>(row?.prefs, {}) },
    companionStatus: row?.companion_status ?? 'none',
    saved: saved.results.map((r) => r.companion_id),
  });
});

/** Personal details, 18+ confirmation and the Expo push token. */
me.patch('/', async (c) => {
  const u = c.get('user');
  const b = await c.req.json<{ name?: string; bio?: string; ageConfirmed?: boolean; pushToken?: string | null; prefs?: Partial<Prefs>; language?: 'auto' | 'en' | 'de' }>();
  if (b.language !== undefined && !['auto', 'en', 'de'].includes(b.language)) fail(400, 'Unknown language.');
  if (b.prefs) {
    const cur = await c.env.DB.prepare('SELECT prefs FROM users WHERE id = ?').bind(u.id).first<{ prefs: string }>();
    const merged = { ...DEFAULT_PREFS, ...parseJson<Partial<Prefs>>(cur?.prefs, {}) } as Record<string, unknown>;
    for (const [k, v] of Object.entries(b.prefs)) {
      if (!(k in DEFAULT_PREFS)) continue;
      if (typeof v !== typeof (DEFAULT_PREFS as Record<string, unknown>)[k]) fail(400, `Invalid value for ${k}.`);
      merged[k] = v;
    }
    await c.env.DB.prepare('UPDATE users SET prefs = ? WHERE id = ?').bind(JSON.stringify(merged), u.id).run();
  }
  if (b.language) await c.env.DB.prepare('UPDATE users SET language = ? WHERE id = ?').bind(b.language, u.id).run();
  if (b.name !== undefined && !b.name.trim()) fail(400, 'Name can’t be empty.');
  if (b.name && b.name.length > 60) fail(400, 'Name is too long.');
  if (b.bio && b.bio.length > 400) fail(400, 'About is too long.');
  await c.env.DB.prepare(
    `UPDATE users SET name = COALESCE(?, name), bio = COALESCE(?, bio),
       age_confirmed = CASE WHEN ? THEN 1 ELSE age_confirmed END,
       push_token = CASE WHEN ? THEN ? ELSE push_token END WHERE id = ?`,
  ).bind(b.name?.trim() ?? null, b.bio ?? null, b.ageConfirmed ? 1 : 0, b.pushToken !== undefined ? 1 : 0, b.pushToken ?? null, u.id).run();
  return c.json({ ok: true });
});

/** GDPR deletion request: suspends now; the record is anonymised by an admin within 30 days. */
me.delete('/', async (c) => {
  const u = c.get('user');
  const active = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM bookings WHERE (customer_id = ? OR companion_id = ?) AND status IN ('pending', 'confirmed')",
  ).bind(u.id, u.id).first<{ n: number }>();
  if (active && active.n > 0) fail(409, 'Complete or cancel your active bookings first.');
  await c.env.DB.prepare('UPDATE users SET suspended = 1, push_token = NULL WHERE id = ?').bind(u.id).run();
  return c.json({ ok: true });
});

me.put('/saved/:cid', async (c) => {
  await c.env.DB.prepare('INSERT OR IGNORE INTO saved (user_id, companion_id) VALUES (?, ?)').bind(c.get('user').id, c.req.param('cid')).run();
  return c.json({ ok: true });
});

me.delete('/saved/:cid', async (c) => {
  await c.env.DB.prepare('DELETE FROM saved WHERE user_id = ? AND companion_id = ?').bind(c.get('user').id, c.req.param('cid')).run();
  return c.json({ ok: true });
});

me.get('/notifications', async (c) => {
  const r = await c.env.DB.prepare('SELECT id, icon, tone, title, body, go, read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
    .bind(c.get('user').id)
    .all();
  return c.json(r.results);
});

me.post('/notifications/read', async (c) => {
  const { ids } = await c.req.json<{ ids?: string[] }>();
  const uid = c.get('user').id;
  if (ids?.length) {
    const stmt = c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND id = ?');
    await c.env.DB.batch(ids.slice(0, 100).map((id) => stmt.bind(uid, id)));
  } else {
    await c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').bind(uid).run();
  }
  return c.json({ ok: true });
});

me.post('/reports', async (c) => {
  const { targetId, reason } = await c.req.json<{ targetId?: string; reason?: string }>();
  if (!targetId || !reason) fail(400, 'Choose what’s wrong.');
  await c.env.DB.prepare('INSERT INTO reports (id, reporter_id, target_id, reason) VALUES (?, ?, ?, ?)')
    .bind('rep_' + crypto.randomUUID(), c.get('user').id, targetId, reason!.slice(0, 200))
    .run();
  return c.json({ ok: true });
});

me.get('/blocks', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT b.blocked_id AS id, COALESCE(cp.display_name, NULLIF(u.name, ''), 'ZeitMit member') AS name
     FROM blocks b JOIN users u ON u.id = b.blocked_id LEFT JOIN companions cp ON cp.user_id = b.blocked_id WHERE b.user_id = ?`,
  ).bind(c.get('user').id).all();
  return c.json(r.results);
});

me.delete('/blocks/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?').bind(c.get('user').id, c.req.param('id')).run();
  return c.json({ ok: true });
});

me.post('/blocks', async (c) => {
  const { targetId } = await c.req.json<{ targetId?: string }>();
  if (!targetId) fail(400, 'Missing user.');
  await c.env.DB.prepare('INSERT OR IGNORE INTO blocks (user_id, blocked_id) VALUES (?, ?)').bind(c.get('user').id, targetId).run();
  return c.json({ ok: true });
});
