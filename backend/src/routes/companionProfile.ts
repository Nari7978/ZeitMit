import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { ACTIVITIES, BOUNDARY_OPTIONS, LANGUAGES, WINDOWS } from '../types';
import { toCompanion, type CompanionRow } from '../lib/companions';
import { fail } from '../lib/util';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type Listing = {
  name?: string; showAge?: boolean; age?: number; about?: string; interests?: string[]; acts?: string[]; ok?: string[];
  langs?: string[]; rate?: number; days?: string[]; wins?: string[]; area?: string; gender?: 'w' | 'm' | 'nb'; pronouns?: string; lgbtq?: boolean;
};

function validate(b: Listing, full: boolean) {
  if (full || b.name !== undefined) if (!b.name?.trim() || b.name.length > 40) fail(400, 'Add a display name (up to 40 characters).');
  if (full || b.about !== undefined) if ((b.about ?? '').trim().length < 40) fail(400, 'Write at least 40 characters about yourself.');
  if (b.about && b.about.length > 400) fail(400, 'About is limited to 400 characters.');
  if (full || b.acts !== undefined) if (!b.acts?.length || !b.acts.every((a) => (ACTIVITIES as readonly string[]).includes(a))) fail(400, 'Pick at least one activity.');
  if (full || b.langs !== undefined) if (!b.langs?.length || !b.langs.every((l) => LANGUAGES.includes(l))) fail(400, 'Pick at least one language.');
  if (b.ok && !b.ok.every((o) => BOUNDARY_OPTIONS.includes(o))) fail(400, 'Unknown boundary option.');
  if (full || b.rate !== undefined) if (!Number.isInteger(b.rate) || b.rate! < 15 || b.rate! > 80) fail(400, 'Rate must be €15–€80 per hour.');
  if (full) {
    if (!b.days?.length || !b.wins?.length) fail(400, 'Choose at least one day and time of day.');
    if (b.age !== undefined && (!Number.isInteger(b.age) || b.age < 18 || b.age > 99)) fail(400, 'You must be 18 or older.');
  }
}

export const companionProfile = new Hono<AppEnv>();

companionProfile.get('/', async (c) => {
  const id = c.get('user').id;
  const row = await c.env.DB.prepare('SELECT * FROM companions WHERE user_id = ?').bind(id).first<CompanionRow>();
  if (!row) return c.json({ status: 'none' });
  const avail = await c.env.DB.prepare('SELECT day, win FROM availability WHERE companion_id = ?').bind(id).all<{ day: number; win: string }>();
  return c.json({ ...toCompanion(row), avail: avail.results.map((a) => `${WEEK[a.day]}-${a.win}`) });
});

/** "Become a Companion" submission. Goes to the admin review queue. */
companionProfile.post('/apply', async (c) => {
  const u = c.get('user');
  const b = await c.req.json<Listing & { adult?: boolean; rules?: boolean; idSubmitted?: boolean }>();
  validate(b, true);
  if (!b.adult || !b.rules) fail(400, 'Confirm you’re 18+ and agree to keep bookings non-sexual and in public.');
  if (!b.idSubmitted) fail(400, 'Complete ID verification first.');
  const exists = await c.env.DB.prepare('SELECT status FROM companions WHERE user_id = ?').bind(u.id).first<{ status: string }>();
  if (exists && exists.status !== 'rejected') fail(409, 'You already have a companion profile.');
  const interests = (b.interests ?? []).slice(0, 12);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM companions WHERE user_id = ?').bind(u.id),
    c.env.DB.prepare(
      `INSERT INTO companions (user_id, display_name, age, show_age, pronouns, gender, area, hue, tagline, bio, rate, interests, languages, activities, boundaries, lgbtq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      u.id, b.name!.trim(), b.age ?? null, b.showAge === false ? 0 : 1, b.pronouns ?? null, b.gender ?? 'nb', b.area ?? 'Berlin',
      Math.floor(Math.random() * 360), interests.slice(0, 2).join(' and ') || 'New in Berlin', b.about!.trim(), b.rate!,
      JSON.stringify(interests), JSON.stringify(b.langs!.map((l) => [l, 'Fluent'])), JSON.stringify(b.acts), JSON.stringify(b.ok ?? []), b.lgbtq ? 1 : 0,
    ),
    c.env.DB.prepare('DELETE FROM availability WHERE companion_id = ?').bind(u.id),
    ...b.days!.flatMap((d) => b.wins!.filter((w) => (WINDOWS as readonly string[]).includes(w)).map((w) =>
      c.env.DB.prepare('INSERT OR IGNORE INTO availability (companion_id, day, win) VALUES (?, ?, ?)').bind(u.id, WEEK.indexOf(d), w))),
  ]);
  return c.json({ status: 'pending' }, 201);
});

/** "Your listing": rate and activities. */
companionProfile.patch('/', async (c) => {
  const u = c.get('user');
  const b = await c.req.json<Listing>();
  validate(b, false);
  const res = await c.env.DB.prepare(
    `UPDATE companions SET rate = COALESCE(?, rate), activities = COALESCE(?, activities), boundaries = COALESCE(?, boundaries),
       bio = COALESCE(?, bio), display_name = COALESCE(?, display_name) WHERE user_id = ?`,
  ).bind(b.rate ?? null, b.acts ? JSON.stringify(b.acts) : null, b.ok ? JSON.stringify(b.ok) : null, b.about?.trim() ?? null, b.name?.trim() ?? null, u.id).run();
  if (!res.meta.changes) fail(404, 'You don’t have a companion profile yet.');
  return c.json({ ok: true });
});

/** Weekly availability grid toggle. Body: { day: 'Mon', win: 'am', on: boolean } */
companionProfile.put('/availability', async (c) => {
  const u = c.get('user');
  const { day, win, on } = await c.req.json<{ day: string; win: string; on: boolean }>();
  const d = WEEK.indexOf(day);
  if (d < 0 || !(WINDOWS as readonly string[]).includes(win)) fail(400, 'Unknown time slot.');
  const has = await c.env.DB.prepare('SELECT 1 FROM companions WHERE user_id = ?').bind(u.id).first();
  if (!has) fail(404, 'You don’t have a companion profile yet.');
  await c.env.DB.prepare(on ? 'INSERT OR IGNORE INTO availability (companion_id, day, win) VALUES (?, ?, ?)' : 'DELETE FROM availability WHERE companion_id = ? AND day = ? AND win = ?')
    .bind(u.id, d, win).run();
  return c.json({ ok: true });
});
