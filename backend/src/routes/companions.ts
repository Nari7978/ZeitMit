import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { NEVER_OFFERED } from '../types';
import { slotsFor, toCompanion, type CompanionRow } from '../lib/companions';
import { berlinParts, fail, now } from '../lib/util';

export const companions = new Hono<AppEnv>();

/** Approved companions. Filtering and sorting happen client-side for this catalogue size. */
companions.get('/', async (c) => {
  const r = await c.env.DB.prepare("SELECT * FROM companions WHERE status = 'approved' ORDER BY rating IS NULL, rating DESC, review_count DESC LIMIT 500").all<CompanionRow>();
  // "Available today": has a window later today (Berlin time).
  const { day, hour } = berlinParts(now());
  const later = (['am', 'pm', 'eve'] as const).filter((w) => (w === 'am' ? hour < 11 : w === 'pm' ? hour < 16 : hour < 20));
  const todayOpen = later.length
    ? await c.env.DB.prepare(`SELECT DISTINCT companion_id FROM availability WHERE day = ? AND win IN (${later.map(() => '?').join(',')})`)
        .bind(day, ...later)
        .all<{ companion_id: string }>()
    : { results: [] as { companion_id: string }[] };
  const today = new Set(todayOpen.results.map((x) => x.companion_id));
  return c.json(r.results.map((row) => ({ ...toCompanion(row), today: today.has(row.user_id) })));
});

companions.get('/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare("SELECT * FROM companions WHERE user_id = ? AND status = 'approved'").bind(id).first<CompanionRow>();
  if (!row) fail(404, 'This companion isn’t available.');
  const reviews = await c.env.DB.prepare('SELECT author_name AS n, activity AS a, stars, text AS t, created_at FROM reviews WHERE companion_id = ? ORDER BY created_at DESC LIMIT 20')
    .bind(id)
    .all();
  const slots = await slotsFor(c.env, id);
  return c.json({ ...toCompanion(row!), no: NEVER_OFFERED, reviewList: reviews.results, slots, today: slots[0].times.length > 0 });
});

companions.get('/:id/slots', async (c) => c.json(await slotsFor(c.env, c.req.param('id'))));
