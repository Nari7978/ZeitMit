import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { NEVER_OFFERED } from '../types';
import { nextFreeAll, timesFor, toCompanion, type CompanionRow } from '../lib/companions';
import { fail } from '../lib/util';

export const companions = new Hono<AppEnv>();

/**
 * Approved companions. Filtering and sorting happen client-side for this catalogue size. Each comes with when they're
 * next free (`next`, unix), whether that's today, and the weekdays with open times, counting bookings: for each kind
 * they offer in `free` (in person, video), and for either at the top level.
 */
companions.get('/', async (c) => {
  const [r, freeOf] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM companions WHERE status = 'approved' ORDER BY rating IS NULL, rating DESC, review_count DESC LIMIT 500").all<CompanionRow>(),
    nextFreeAll(c.env),
  ]);
  c.header('Cache-Control', 'no-store'); // free times change with every booking
  return c.json(r.results.map((row) => ({ ...toCompanion(row), ...freeOf(row) })));
});

companions.get('/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare("SELECT * FROM companions WHERE user_id = ? AND status = 'approved'").bind(id).first<CompanionRow>();
  if (!row) fail(404, 'This companion isn’t available.');
  const reviews = await c.env.DB.prepare('SELECT author_name AS n, activity AS a, stars, text AS t, created_at FROM reviews WHERE companion_id = ? ORDER BY created_at DESC LIMIT 20')
    .bind(id)
    .all();
  const comp = toCompanion(row!);
  const times = await timesFor(c.env, id, comp.acts);
  c.header('Cache-Control', 'no-store'); // open times change with every booking
  // `slots`: one list for app versions from before video dates had their own hours.
  const slots = times.meet ?? times.video ?? [];
  return c.json({ ...comp, no: NEVER_OFFERED, reviewList: reviews.results, slots, times, today: [times.meet, times.video].some((k) => !!k?.[0].times.length) });
});

/** Open times of each kind the companion offers: { meet, video } (null for a kind they don't offer). */
companions.get('/:id/times', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await timesFor(c.env, c.req.param('id')));
});

/** One list of open times, for app versions from before video dates had their own hours. */
companions.get('/:id/slots', async (c) => {
  c.header('Cache-Control', 'no-store');
  const times = await timesFor(c.env, c.req.param('id'));
  return c.json(times.meet ?? times.video ?? []);
});
