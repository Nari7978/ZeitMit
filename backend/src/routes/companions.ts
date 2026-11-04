import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { NEVER_OFFERED } from '../types';
import { berlinDate, berlinToUnix, minutes, slotsFor, toCompanion, type CompanionRow, type Range } from '../lib/companions';
import { berlinParts, fail, now, parseJson } from '../lib/util';

export const companions = new Hono<AppEnv>();

/** Approved companions. Filtering and sorting happen client-side for this catalogue size. */
companions.get('/', async (c) => {
  const t = now();
  const { day, hour, minute } = berlinParts(t);
  // The next 7 days (what customers can book). A companion's own hours for a date replace their weekly windows there.
  const noon = berlinToUnix(berlinDate(t), '12:00');
  const dates = Array.from({ length: 7 }, (_, i) => berlinDate(noon + i * 86400));
  const later = (['am', 'pm', 'eve'] as const).filter((w) => (w === 'am' ? hour < 11 : w === 'pm' ? hour < 16 : hour < 20));
  const [r, todayOpen, all, own] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM companions WHERE status = 'approved' ORDER BY rating IS NULL, rating DESC, review_count DESC LIMIT 500").all<CompanionRow>(),
    // "Available today": has a window later today (Berlin time).
    later.length
      ? c.env.DB.prepare(`SELECT DISTINCT companion_id FROM availability WHERE day = ? AND win IN (${later.map(() => '?').join(',')})`)
          .bind(day, ...later)
          .all<{ companion_id: string }>()
      : Promise.resolve({ results: [] as { companion_id: string }[] }),
    // Weekdays (0=Mon) with any weekly availability.
    c.env.DB.prepare('SELECT DISTINCT companion_id, day FROM availability').all<{ companion_id: string; day: number }>(),
    c.env.DB.prepare('SELECT companion_id, date, ranges FROM availability_dates WHERE date >= ? AND date <= ?').bind(dates[0], dates[6])
      .all<{ companion_id: string; date: string; ranges: string }>(),
  ]);
  const today = new Set(todayOpen.results.map((x) => x.companion_id));
  const weekly = new Map<string, Set<number>>();
  for (const a of all.results) weekly.set(a.companion_id, (weekly.get(a.companion_id) ?? new Set()).add(a.day));
  const custom = new Map<string, Map<string, Range[]>>();
  for (const o of own.results) custom.set(o.companion_id, (custom.get(o.companion_id) ?? new Map()).set(o.date, parseJson<Range[]>(o.ranges, [])));
  const nowMin = hour * 60 + minute;
  return c.json(r.results.map((row) => {
    const w = weekly.get(row.user_id), mine = custom.get(row.user_id);
    const todays = mine?.get(dates[0]);
    // Own hours today: open while a start an hour from now still leaves an hour before the range ends.
    const isToday = todays ? todays.some(([, to]) => minutes(to) - 120 >= nowMin) : today.has(row.user_id);
    // Weekdays with open hours in the next 7 days, for the "tomorrow / weekend / soonest" filters.
    const days: number[] = [];
    for (let i = 0; i < 7; i++) {
      const ranges = mine?.get(dates[i]);
      if (i === 0 ? isToday : ranges ? ranges.length > 0 : !!w?.has((day + i) % 7)) days.push((day + i) % 7);
    }
    return { ...toCompanion(row), today: isToday, days: days.sort() };
  }));
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
