import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { NEVER_OFFERED } from '../types';
import { toCompanion, type CompanionRow } from '../lib/companions';
import { availabilityOf, legacyViews, nextFreeAll } from '../lib/hours';
import { fail } from '../lib/util';

export const companions = new Hono<AppEnv>();

/**
 * Approved companions. Filtering and sorting happen client-side for this catalogue size. Each comes with when they're
 * next free (`next`, unix), whether that's today, and the weekdays with a free start, counting bookings and blocks:
 * for each kind they offer in `free` (in person, video), and for either at the top level.
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
  const [reviews, a] = await Promise.all([
    c.env.DB.prepare('SELECT author_name AS n, activity AS a, stars, text AS t, created_at FROM reviews WHERE companion_id = ? ORDER BY created_at DESC LIMIT 20').bind(id).all(),
    availabilityOf(c.env, id),
  ]);
  c.header('Cache-Control', 'no-store'); // free times change with every booking
  const old = a ? legacyViews(a) : { slots: [], meet: null, video: null };
  return c.json({
    ...toCompanion(row!), no: NEVER_OFFERED, reviewList: reviews.results, availability: a,
    // Older app versions: half-hour start times, one list and per kind.
    slots: old.slots, times: { meet: old.meet, video: old.video }, today: old.slots.length ? old.slots[0].times.length > 0 : false,
  });
});

/**
 * When a companion can be booked: her time zone, the earliest and latest start, the 15-minute step and, for each kind
 * of date she offers, the shortest and longest booking and the free intervals (unix). Everything else is unavailable.
 */
companions.get('/:id/availability', async (c) => {
  const a = await availabilityOf(c.env, c.req.param('id'));
  if (!a) fail(404, 'This companion isn’t available.');
  c.header('Cache-Control', 'no-store');
  return c.json(a);
});

/** Older app versions: half-hour start times per kind ({ meet, video }, null for a kind not offered). */
companions.get('/:id/times', async (c) => {
  const a = await availabilityOf(c.env, c.req.param('id'));
  c.header('Cache-Control', 'no-store');
  const v = a ? legacyViews(a) : { meet: null, video: null };
  return c.json({ meet: v.meet, video: v.video });
});

/** Older app versions: one list of half-hour start times. */
companions.get('/:id/slots', async (c) => {
  const a = await availabilityOf(c.env, c.req.param('id'));
  c.header('Cache-Control', 'no-store');
  return c.json(a ? legacyViews(a).slots : []);
});
