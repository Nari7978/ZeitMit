import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { NEVER_OFFERED } from '../types';
import { nextFreeAll, slotsFor, toCompanion, type CompanionRow } from '../lib/companions';
import { fail } from '../lib/util';

export const companions = new Hono<AppEnv>();

/**
 * Approved companions. Filtering and sorting happen client-side for this catalogue size. Each comes with when they're
 * next free (`next`, unix), whether that's today, and the weekdays with open times, counting bookings.
 */
companions.get('/', async (c) => {
  const [r, freeOf] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM companions WHERE status = 'approved' ORDER BY rating IS NULL, rating DESC, review_count DESC LIMIT 500").all<CompanionRow>(),
    nextFreeAll(c.env),
  ]);
  c.header('Cache-Control', 'no-store'); // free times change with every booking
  return c.json(r.results.map((row) => ({ ...toCompanion(row), ...freeOf(row.user_id) })));
});

companions.get('/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare("SELECT * FROM companions WHERE user_id = ? AND status = 'approved'").bind(id).first<CompanionRow>();
  if (!row) fail(404, 'This companion isn’t available.');
  const reviews = await c.env.DB.prepare('SELECT author_name AS n, activity AS a, stars, text AS t, created_at FROM reviews WHERE companion_id = ? ORDER BY created_at DESC LIMIT 20')
    .bind(id)
    .all();
  const slots = await slotsFor(c.env, id);
  c.header('Cache-Control', 'no-store'); // open times change with every booking
  return c.json({ ...toCompanion(row!), no: NEVER_OFFERED, reviewList: reviews.results, slots, today: slots[0].times.length > 0 });
});

companions.get('/:id/slots', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await slotsFor(c.env, c.req.param('id')));
});
