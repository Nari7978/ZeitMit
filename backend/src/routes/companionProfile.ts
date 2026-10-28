import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { ACTIVITIES, BOUNDARY_OPTIONS, LANGUAGES, WINDOWS } from '../types';
import { toCompanion, type CompanionRow } from '../lib/companions';
import { CONTACT_MSG, fail, hasContactDetails } from '../lib/util';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type Listing = {
  name?: string; showAge?: boolean; age?: number; about?: string; interests?: string[]; acts?: string[]; ok?: string[];
  langs?: string[]; rate?: number; days?: string[]; wins?: string[]; area?: string; gender?: 'w' | 'm' | 'nb'; pronouns?: string; lgbtq?: boolean;
  tagline?: string; levels?: Record<string, string>; photoId?: string; idPhotoId?: string;
};

const LEVELS = ['Native', 'Fluent', 'Conversational', 'Intermediate', 'Basic'];

function validate(b: Listing, full: boolean) {
  if ([b.name, b.about, b.tagline, b.area, b.pronouns].some((x) => x && hasContactDetails(x))) fail(400, CONTACT_MSG);
  if (full || b.name !== undefined) if (!b.name?.trim() || b.name.length > 40) fail(400, 'Add a display name (up to 40 characters).');
  if (full || b.about !== undefined) if ((b.about ?? '').trim().length < 40) fail(400, 'Write at least 40 characters about yourself.');
  if (b.about && b.about.length > 400) fail(400, 'About is limited to 400 characters.');
  if (full || b.acts !== undefined) if (!b.acts?.length || !b.acts.every((a) => (ACTIVITIES as readonly string[]).includes(a))) fail(400, 'Pick at least one activity.');
  if (full || b.langs !== undefined) if (!b.langs?.length || !b.langs.every((l) => LANGUAGES.includes(l))) fail(400, 'Pick at least one language.');
  if (b.ok && !b.ok.every((o) => BOUNDARY_OPTIONS.includes(o))) fail(400, 'Unknown boundary option.');
  if (full || b.rate !== undefined) if (!Number.isInteger(b.rate) || b.rate! < 15 || b.rate! > 80) fail(400, 'Rate must be €15–€80 per hour.');
  if (full || b.age !== undefined) if (!Number.isInteger(b.age) || b.age! < 18 || b.age! > 99) fail(400, 'Enter your age. You must be 18 or older.');
  if (full || b.gender !== undefined) if (!['w', 'm', 'nb'].includes(b.gender ?? '')) fail(400, 'Choose how you identify.');
  if (b.pronouns && b.pronouns.length > 20) fail(400, 'Pronouns are limited to 20 characters.');
  if (full) {
    if (!b.days?.length || !b.wins?.length) fail(400, 'Choose at least one day and time of day.');
  }
}

export const companionProfile = new Hono<AppEnv>();

companionProfile.get('/', async (c) => {
  const id = c.get('user').id;
  const row = await c.env.DB.prepare('SELECT * FROM companions WHERE user_id = ?').bind(id).first<CompanionRow>();
  if (!row) return c.json({ status: 'none' });
  const avail = await c.env.DB.prepare('SELECT day, win FROM availability WHERE companion_id = ?').bind(id).all<{ day: number; win: string }>();
  return c.json({ ...toCompanion(row), ageValue: row.age, avail: avail.results.map((a) => `${WEEK[a.day]}-${a.win}`) });
});

/** "Become a Companion" submission. Goes to the admin review queue. */
companionProfile.post('/apply', async (c) => {
  const u = c.get('user');
  const b = await c.req.json<Listing & { adult?: boolean; rules?: boolean }>();
  validate(b, true);
  if (!b.adult || !b.rules) fail(400, 'Confirm you’re 18+ and agree to keep bookings non-sexual and in public.');
  const idPhoto = b.idPhotoId
    ? await c.env.DB.prepare("SELECT id FROM photos WHERE id = ? AND owner_id = ? AND kind = 'id'").bind(b.idPhotoId, u.id).first()
    : null;
  if (!idPhoto) fail(400, 'Upload a photo of your ID with your face first.');
  const photo = b.photoId
    ? await c.env.DB.prepare("SELECT id FROM photos WHERE id = ? AND owner_id = ? AND kind = 'companion'").bind(b.photoId, u.id).first()
    : null;
  const exists = await c.env.DB.prepare('SELECT status FROM companions WHERE user_id = ?').bind(u.id).first<{ status: string }>();
  if (exists && exists.status !== 'rejected') fail(409, 'You already have a companion profile.');
  const interests = (b.interests ?? []).slice(0, 12);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM companions WHERE user_id = ?').bind(u.id),
    c.env.DB.prepare(
      `INSERT INTO companions (user_id, display_name, age, show_age, pronouns, gender, area, hue, tagline, bio, rate, interests, languages, activities, boundaries, lgbtq, photo_id, id_photo_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      u.id, b.name!.trim(), b.age ?? null, b.showAge === false ? 0 : 1, b.pronouns?.trim() || null, b.gender!, b.area ?? 'Berlin',
      Math.floor(Math.random() * 360), b.tagline?.trim().slice(0, 60) || interests.slice(0, 2).join(' and ') || 'New in Berlin', b.about!.trim(), b.rate!,
      JSON.stringify(interests), JSON.stringify(b.langs!.map((l) => [l, LEVELS.includes(b.levels?.[l] ?? '') ? b.levels![l] : 'Fluent'])), JSON.stringify(b.acts), JSON.stringify(b.ok ?? []), b.lgbtq ? 1 : 0,
      photo ? b.photoId! : null, b.idPhotoId!,
    ),
    c.env.DB.prepare('DELETE FROM availability WHERE companion_id = ?').bind(u.id),
    ...b.days!.flatMap((d) => b.wins!.filter((w) => (WINDOWS as readonly string[]).includes(w)).map((w) =>
      c.env.DB.prepare('INSERT OR IGNORE INTO availability (companion_id, day, win) VALUES (?, ?, ?)').bind(u.id, WEEK.indexOf(d), w))),
  ]);
  return c.json({ status: 'pending' }, 201);
});

/** "Your listing": everything except name/age/verification can be edited after applying. */
companionProfile.patch('/', async (c) => {
  const u = c.get('user');
  const b = await c.req.json<Listing>();
  validate(b, false);
  if (b.tagline !== undefined && b.tagline.length > 60) fail(400, 'Tagline is limited to 60 characters.');
  if (b.interests && b.interests.length > 12) fail(400, 'Pick up to 12 interests.');
  if (b.area !== undefined && (!b.area.trim() || b.area.length > 40)) fail(400, 'Add your area, e.g. Kreuzberg.');
  const langs = b.langs ? JSON.stringify(b.langs.map((l) => [l, LEVELS.includes(b.levels?.[l] ?? '') ? b.levels![l] : 'Fluent'])) : null;
  const res = await c.env.DB.prepare(
    `UPDATE companions SET rate = COALESCE(?, rate), activities = COALESCE(?, activities), boundaries = COALESCE(?, boundaries),
       bio = COALESCE(?, bio), tagline = COALESCE(?, tagline), interests = COALESCE(?, interests), languages = COALESCE(?, languages),
       area = COALESCE(?, area), show_age = COALESCE(?, show_age), lgbtq = COALESCE(?, lgbtq),
       age = COALESCE(?, age), gender = COALESCE(?, gender), pronouns = CASE WHEN ? THEN ? ELSE pronouns END WHERE user_id = ?`,
  ).bind(
    b.rate ?? null, b.acts ? JSON.stringify(b.acts) : null, b.ok ? JSON.stringify(b.ok) : null, b.about?.trim() ?? null,
    b.tagline?.trim() ?? null, b.interests ? JSON.stringify(b.interests) : null, langs, b.area?.trim() ?? null,
    b.showAge === undefined ? null : b.showAge ? 1 : 0, b.lgbtq === undefined ? null : b.lgbtq ? 1 : 0,
    b.age ?? null, b.gender ?? null, b.pronouns !== undefined ? 1 : 0, b.pronouns?.trim() || null, u.id,
  ).run();
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
