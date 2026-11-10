import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { ACTIVITIES, BOUNDARY_OPTIONS, LANGUAGES, VIDEO_BOUNDARY_OPTIONS, WINDOWS } from '../types';
import { GALLERY_MAX, GALLERY_MIN, toCompanion, type CompanionRow } from '../lib/companions';
import {
  changeCoverage, cleanRanges, dayJson, normalize, parseDay, parseWeek, PLAN_DAYS, rangesOn, span, STEP_S, weekJson, type Range, type WeekRange,
} from '../lib/hours';
import { slotsChanged } from '../lib/live';
import { addDays, clock, dateIn, DEFAULT_TZ, localToUnix, minutes, realDate, validTz, weekdayOf, whenIn } from '../lib/time';
import { CONTACT_MSG, fail, hasContactDetails, newId, now, parseJson } from '../lib/util';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** The fixed windows of older app versions, in minutes of the day. */
const WIN_MIN: Record<string, [number, number]> = { am: [540, 720], pm: [720, 1020], eve: [1020, 1440] };
const MASKS = { meet: 1, video: 2, both: 3 } as const;

type Listing = {
  name?: string; showAge?: boolean; age?: number; about?: string; interests?: string[]; acts?: string[]; ok?: string[]; okVideo?: string[];
  langs?: string[]; rate?: number; days?: string[]; wins?: string[]; area?: string; gender?: 'w' | 'm' | 'nb'; pronouns?: string; lgbtq?: boolean;
  tagline?: string; levels?: Record<string, string>; photoId?: string; idPhotoId?: string; galleryIds?: string[]; timezone?: string;
};

const LEVELS = ['Native', 'Fluent', 'Conversational', 'Intermediate', 'Basic'];

function validate(b: Listing, full: boolean) {
  if ([b.name, b.about, b.tagline, b.area, b.pronouns].some((x) => x && hasContactDetails(x))) fail(400, CONTACT_MSG);
  if (full || b.name !== undefined) if (!b.name?.trim() || b.name.length > 40) fail(400, 'Add a display name (up to 40 characters).');
  if (full || b.about !== undefined) if ((b.about ?? '').trim().length < 40) fail(400, 'Write at least 40 characters about yourself.');
  if (b.about && b.about.length > 400) fail(400, 'About is limited to 400 characters.');
  if (full || b.acts !== undefined) if (!b.acts?.length || !b.acts.every((a) => (ACTIVITIES as readonly string[]).includes(a))) fail(400, 'Pick at least one activity.');
  if (full || b.langs !== undefined) if (!b.langs?.length || !b.langs.every((l) => LANGUAGES.includes(l))) fail(400, 'Pick at least one language.');
  if (b.ok != null && (!Array.isArray(b.ok) || !b.ok.every((o) => BOUNDARY_OPTIONS.includes(o)))) fail(400, 'Unknown boundary option.');
  if (b.okVideo != null && (!Array.isArray(b.okVideo) || !b.okVideo.every((o) => VIDEO_BOUNDARY_OPTIONS.includes(o)))) fail(400, 'Unknown video date boundary option.');
  if (full || b.rate !== undefined) if (!Number.isInteger(b.rate) || b.rate! < 15 || b.rate! > 80) fail(400, 'Rate must be €15–€80 per hour.');
  if (full || b.age !== undefined) if (!Number.isInteger(b.age) || b.age! < 18 || b.age! > 99) fail(400, 'Enter your age. You must be 18 or older.');
  if (full || b.gender !== undefined) if (!['w', 'm', 'nb'].includes(b.gender ?? '')) fail(400, 'Choose how you identify.');
  if (b.pronouns && b.pronouns.length > 20) fail(400, 'Pronouns are limited to 20 characters.');
  if (b.timezone !== undefined && !validTz(b.timezone)) fail(400, 'Unknown time zone.');
  if (full) {
    if (!b.days?.length || !b.wins?.length) fail(400, 'Choose at least one day and time of day.');
  }
}

export const companionProfile = new Hono<AppEnv>();

companionProfile.get('/', async (c) => {
  const id = c.get('user').id;
  const row = await c.env.DB.prepare('SELECT * FROM companions WHERE user_id = ?').bind(id).first<CompanionRow>();
  if (!row) return c.json({ status: 'none' });
  const tz = row.timezone || DEFAULT_TZ;
  const { week, days, blocks } = await hoursRows(c.env, id, tz);
  const byDay = (d: number) => week.filter((r) => r.day === d);
  // Older app versions: fixed windows that are fully open for a kind, and the dates whose hours for a kind differ
  // from the weekly ones, with those hours (cut at midnight: they can't show later).
  const windows = (mask: number) => WEEK.flatMap((name, d) => Object.entries(WIN_MIN).filter(([, [a, b]]) => covers(byDay(d), a, b, mask)).map(([w]) => `${name}-${w}`));
  const datesOf = (mask: number) => days.flatMap((x) => {
    const own = coverage(x.ranges, mask);
    if (JSON.stringify(own) === JSON.stringify(coverage(byDay(weekdayOf(x.date)), mask))) return [];
    return [{ date: x.date, ranges: own.map(([a, b]) => [clock(a), b >= 1440 ? '24:00' : clock(b)]) }];
  });
  return c.json({
    ...toCompanion(row), ageValue: row.age, galleryIds: parseJson<string[]>(row.gallery, []),
    // One calendar, in her zone: weekly hours, dates with their own hours, blocked time (unix).
    timezone: tz, week, days, blocks,
    avail: windows(1), dates: datesOf(1), availVideo: windows(2), datesVideo: datesOf(2),
  });
});

/** Her stored hours, tidied: the week per day, dates from today on (in her zone), blocks that haven't ended. */
async function hoursRows(env: AppEnv['Bindings'], id: string, tz: string) {
  const today = dateIn(now(), tz);
  const [w, d, bl] = await env.DB.batch([
    env.DB.prepare('SELECT ranges FROM hours_week WHERE companion_id = ?').bind(id),
    env.DB.prepare('SELECT date, ranges FROM hours_days WHERE companion_id = ? AND date >= ? ORDER BY date').bind(id, today),
    env.DB.prepare('SELECT id, starts_at, ends_at, note FROM hours_blocks WHERE companion_id = ? AND ends_at > ? ORDER BY starts_at').bind(id, now()),
  ]);
  const weekRaw = parseWeek((w.results as { ranges: string }[])[0]?.ranges);
  const week: WeekRange[] = [0, 1, 2, 3, 4, 5, 6].flatMap((day) => normalize(weekRaw.filter((r) => r.day === day)).map((r) => ({ day, ...r })));
  const days = (d.results as { date: string; ranges: string }[]).map((x) => ({ date: x.date, ranges: normalize(parseDay(x.ranges)) }));
  const blocks = (bl.results as { id: string; starts_at: number; ends_at: number; note: string }[]).map((b) => ({ id: b.id, startsAt: b.starts_at, endsAt: b.ends_at, note: b.note }));
  return { week, days, blocks, weekRaw };
}

/** A day's open minutes for any of the kinds in `mask`, joined where they touch ([start, end], an end past 1440 is the next day). */
function coverage(ranges: Range[], mask: number): [number, number][] {
  const out: [number, number][] = [];
  for (const r of [...ranges].sort((x, y) => minutes(x.from) - minutes(y.from))) {
    if (!(MASKS[r.kind] & mask)) continue;
    const a = minutes(r.from), b = a + span(r), last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Whether a day's ranges open all of [a, b) (minutes) for the kinds in `mask`. */
function covers(ranges: Range[], a: number, b: number, mask: number) {
  let at = a;
  for (const r of [...normalize(ranges)].sort((x, y) => minutes(x.from) - minutes(y.from))) {
    const s = minutes(r.from), e = s + span(r);
    if ((MASKS[r.kind] & mask) !== mask) continue;
    if (s <= at && e > at) at = e;
  }
  return at >= b;
}

async function ownProfile(env: AppEnv['Bindings'], id: string) {
  const row = await env.DB.prepare('SELECT timezone FROM companions WHERE user_id = ?').bind(id).first<{ timezone: string | null }>();
  if (!row) fail(404, 'You don’t have a companion profile yet.');
  return { tz: row!.timezone || DEFAULT_TZ };
}

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
  if (!photo) fail(400, 'Add a profile photo of yourself.');
  const gallery = await ownGallery(c.env, u.id, b.galleryIds);
  if (gallery.length < GALLERY_MIN) fail(400, `Add at least ${GALLERY_MIN} more photos besides your profile photo.`);
  const exists = await c.env.DB.prepare('SELECT status FROM companions WHERE user_id = ?').bind(u.id).first<{ status: string }>();
  if (exists && exists.status !== 'rejected') fail(409, 'You already have a companion profile.');
  const interests = (b.interests ?? []).slice(0, 12);
  // Upsert, not delete + insert: someone applying again may have bookings (and earnings) tied to this row.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO companions (user_id, display_name, age, show_age, pronouns, gender, area, hue, tagline, bio, rate, interests, languages, activities, boundaries, video_boundaries, lgbtq, photo_id, id_photo_id, gallery)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         display_name = excluded.display_name, age = excluded.age, show_age = excluded.show_age, pronouns = excluded.pronouns, gender = excluded.gender,
         area = excluded.area, tagline = excluded.tagline, bio = excluded.bio, rate = excluded.rate, interests = excluded.interests,
         languages = excluded.languages, activities = excluded.activities, boundaries = excluded.boundaries, video_boundaries = excluded.video_boundaries, lgbtq = excluded.lgbtq,
         photo_id = COALESCE(excluded.photo_id, companions.photo_id), id_photo_id = excluded.id_photo_id, gallery = excluded.gallery, status = 'pending', id_verified = 0`,
    ).bind(
      u.id, b.name!.trim(), b.age ?? null, b.showAge === false ? 0 : 1, b.pronouns?.trim() || null, b.gender!, b.area ?? 'Berlin',
      Math.floor(Math.random() * 360), b.tagline?.trim().slice(0, 60) || interests.slice(0, 2).join(' and ') || 'New in Berlin', b.about!.trim(), b.rate!,
      JSON.stringify(interests), JSON.stringify(b.langs!.map((l) => [l, LEVELS.includes(b.levels?.[l] ?? '') ? b.levels![l] : 'Fluent'])), JSON.stringify(b.acts), JSON.stringify(b.ok ?? []), JSON.stringify(b.okVideo ?? []), b.lgbtq ? 1 : 0,
      b.photoId!, b.idPhotoId!, JSON.stringify(gallery),
    ),
    dropUnusedGallery(c.env, u.id, gallery),
    // The days and times of day picked are the weekly hours to start with, for both kinds of date.
    c.env.DB.prepare(
      'INSERT INTO hours_week (companion_id, ranges) VALUES (?, ?) ON CONFLICT (companion_id) DO UPDATE SET ranges = excluded.ranges, updated_at = unixepoch()',
    ).bind(u.id, weekJson(b.days!.flatMap((d) => {
      const day = WEEK.indexOf(d);
      if (day < 0) return [];
      const picked = b.wins!.filter((w) => (WINDOWS as readonly string[]).includes(w));
      return normalize(picked.map((w) => ({ from: clock(WIN_MIN[w][0]), to: WIN_MIN[w][1] === 1440 ? '24:00' : clock(WIN_MIN[w][1]), kind: 'both' as const })))
        .map((r) => ({ day, ...r }));
    }))),
  ]);
  void slotsChanged(c.env, u.id, c.executionCtx);
  return c.json({ status: 'pending' }, 201);
});

/** The person's own uploaded gallery photos among `ids`, in that order (unknown or foreign ids are left out). */
async function ownGallery(env: AppEnv['Bindings'], userId: string, ids: unknown) {
  if (!Array.isArray(ids)) return [];
  const want = [...new Set(ids.filter((x): x is string => typeof x === 'string'))].slice(0, GALLERY_MAX);
  if (!want.length) return [];
  const r = await env.DB.prepare(`SELECT id FROM photos WHERE owner_id = ? AND kind = 'gallery' AND id IN (${want.map(() => '?').join(',')})`)
    .bind(userId, ...want).all<{ id: string }>();
  const mine = new Set(r.results.map((x) => x.id));
  return want.filter((id) => mine.has(id));
}

/** Gallery photos the person uploaded but no longer uses (removed, or left from an earlier try) are deleted. */
const dropUnusedGallery = (env: AppEnv['Bindings'], userId: string, keep: string[]) =>
  env.DB.prepare(`DELETE FROM photos WHERE owner_id = ? AND kind = 'gallery'${keep.length ? ` AND id NOT IN (${keep.map(() => '?').join(',')})` : ''}`).bind(userId, ...keep);

/**
 * Replaces the gallery (ids in display order, up to 6). Photos can be added one by one, but a gallery that has
 * the minimum never drops below it: add the new photo first, then remove the old one.
 */
companionProfile.put('/gallery', async (c) => {
  const u = c.get('user');
  const { ids } = await c.req.json<{ ids?: unknown }>();
  if (!Array.isArray(ids) || ids.length > GALLERY_MAX) fail(400, `Add up to ${GALLERY_MAX} photos.`);
  const row = await c.env.DB.prepare('SELECT gallery FROM companions WHERE user_id = ?').bind(u.id).first<{ gallery: string }>();
  if (!row) fail(404, 'You don’t have a companion profile yet.');
  const gallery = await ownGallery(c.env, u.id, ids);
  if (gallery.length !== (ids as unknown[]).length) fail(400, 'One of those photos isn’t yours or was removed. Pull down to refresh.');
  const had = JSON.parse(row!.gallery || '[]') as string[];
  if (gallery.length < GALLERY_MIN && gallery.length < had.length) fail(409, `Keep at least ${GALLERY_MIN} photos. Add a new one before removing this one.`);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE companions SET gallery = ? WHERE user_id = ?').bind(JSON.stringify(gallery), u.id),
    dropUnusedGallery(c.env, u.id, gallery),
  ]);
  return c.json({ gallery: gallery.map((id) => `/photos/${id}`), ids: gallery });
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
    `UPDATE companions SET rate = COALESCE(?, rate), activities = COALESCE(?, activities), boundaries = COALESCE(?, boundaries), video_boundaries = COALESCE(?, video_boundaries),
       bio = COALESCE(?, bio), tagline = COALESCE(?, tagline), interests = COALESCE(?, interests), languages = COALESCE(?, languages),
       area = COALESCE(?, area), show_age = COALESCE(?, show_age), lgbtq = COALESCE(?, lgbtq),
       age = COALESCE(?, age), gender = COALESCE(?, gender), pronouns = CASE WHEN ? THEN ? ELSE pronouns END, timezone = COALESCE(?, timezone) WHERE user_id = ?`,
  ).bind(
    b.rate ?? null, b.acts ? JSON.stringify(b.acts) : null, b.ok ? JSON.stringify(b.ok) : null, b.okVideo ? JSON.stringify(b.okVideo) : null, b.about?.trim() ?? null,
    b.tagline?.trim() ?? null, b.interests ? JSON.stringify(b.interests) : null, langs, b.area?.trim() ?? null,
    b.showAge === undefined ? null : b.showAge ? 1 : 0, b.lgbtq === undefined ? null : b.lgbtq ? 1 : 0,
    b.age ?? null, b.gender ?? null, b.pronouns !== undefined ? 1 : 0, b.pronouns?.trim() || null, b.timezone ?? null, u.id,
  ).run();
  if (!res.meta.changes) fail(404, 'You don’t have a companion profile yet.');
  // The kinds of date offered (or the zone her hours are in) may have changed: open profiles update at once.
  if (b.acts || b.timezone) void slotsChanged(c.env, u.id, c.executionCtx);
  return c.json({ ok: true });
});

// ---------- Hours: one calendar for in-person and video dates ----------

/** A date from today to PLAN_DAYS ahead in her zone, as YYYY-MM-DD. */
function checkDate(date: string, tz: string) {
  const today = dateIn(now(), tz);
  if (!realDate(date) || date < today || date > addDays(today, PLAN_DAYS)) fail(400, `Pick a date in the next ${PLAN_DAYS} days.`);
}

/** Bookings (requests and confirmed) that start on a date in her zone: they stay when the hours change. */
async function bookingsOn(env: AppEnv['Bindings'], id: string, date: string, tz: string) {
  const from = localToUnix(date, 0, tz)!, to = localToUnix(addDays(date, 1), 0, tz)!;
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM bookings WHERE companion_id = ? AND status IN ('pending', 'confirmed') AND starts_at >= ? AND starts_at < ?").bind(id, from, to).first<{ n: number }>();
  return r?.n ?? 0;
}

const saveWeek = (env: AppEnv['Bindings'], id: string, week: WeekRange[]) => env.DB.prepare(
  'INSERT INTO hours_week (companion_id, ranges) VALUES (?, ?) ON CONFLICT (companion_id) DO UPDATE SET ranges = excluded.ranges, updated_at = unixepoch()',
).bind(id, weekJson(week)).run();
const saveDay = (env: AppEnv['Bindings'], id: string, date: string, ranges: Range[]) => env.DB.prepare(
  'INSERT INTO hours_days (companion_id, date, ranges) VALUES (?, ?, ?) ON CONFLICT (companion_id, date) DO UPDATE SET ranges = excluded.ranges, updated_at = unixepoch()',
).bind(id, date, dayJson(ranges)).run();

/**
 * Weekly hours, all at once. Body: { ranges: [{ day: 0–6 (Mon–Sun) or 'Mon', from: '18:00', to: '02:00', kind }] }:
 * any times in 15-minute steps, past midnight too, each for 'both' kinds of date (the default), 'meet' or 'video'.
 */
companionProfile.put('/hours/week', async (c) => {
  const u = c.get('user');
  await ownProfile(c.env, u.id);
  const body = await c.req.json<{ ranges?: unknown }>().catch(() => ({}) as { ranges?: unknown });
  if (!Array.isArray(body.ranges)) fail(400, 'Send the hours as a list.');
  const list = body.ranges as { day?: unknown }[];
  const dayOf = (r: { day?: unknown }) => (typeof r?.day === 'number' ? r.day : WEEK.indexOf(String(r?.day)));
  if (list.some((r) => !Number.isInteger(dayOf(r)) || dayOf(r) < 0 || dayOf(r) > 6)) fail(400, 'Each time range needs a day of the week.');
  const week: WeekRange[] = [];
  for (let day = 0; day < 7; day++) {
    try {
      week.push(...normalize(cleanRanges(list.filter((r) => dayOf(r) === day))).map((r) => ({ day, ...r })));
    } catch (e) {
      fail(400, `${WEEK[day]}: ${(e as Error).message}`);
    }
  }
  await saveWeek(c.env, u.id, week);
  void slotsChanged(c.env, u.id, c.executionCtx); // open profiles show the new times at once
  return c.json({ ok: true, week });
});

/**
 * Hours for one date (in her zone), replacing that weekday's weekly hours. Body: { ranges: [{ from, to, kind }] };
 * an empty list is a day off. A range can run past midnight into the next day. Bookings already made that day stay
 * (`kept` says how many).
 */
companionProfile.put('/hours/days/:date', async (c) => {
  const u = c.get('user');
  const { tz } = await ownProfile(c.env, u.id);
  const date = c.req.param('date');
  checkDate(date, tz);
  const body = await c.req.json<{ ranges?: unknown }>().catch(() => ({}) as { ranges?: unknown });
  let ranges: Range[] = [];
  try {
    ranges = normalize(cleanRanges(body.ranges));
  } catch (e) {
    fail(400, (e as Error).message);
  }
  await saveDay(c.env, u.id, date, ranges);
  void slotsChanged(c.env, u.id, c.executionCtx);
  return c.json({ ok: true, date, ranges, kept: await bookingsOn(c.env, u.id, date, tz) });
});

/** Back to the weekly hours on this date. */
companionProfile.delete('/hours/days/:date', async (c) => {
  const u = c.get('user');
  await c.env.DB.prepare('DELETE FROM hours_days WHERE companion_id = ? AND date = ?').bind(u.id, c.req.param('date')).run();
  void slotsChanged(c.env, u.id, c.executionCtx);
  return c.json({ ok: true });
});

/** A blocked period: moments on the 15-minute grid, ending after it starts and in the future, within PLAN_DAYS. */
function checkBlock(startsAt: unknown, endsAt: unknown) {
  const s = Number(startsAt), e = Number(endsAt), t = now();
  if (!Number.isInteger(s) || !Number.isInteger(e) || s % STEP_S || e % STEP_S) fail(400, 'Block time in 15-minute steps.');
  if (e <= s) fail(400, 'The end has to be after the start.');
  if (e <= t) fail(400, 'That time is already over.');
  if (s > t + PLAN_DAYS * 86400 || e - s > PLAN_DAYS * 86400) fail(400, `Block time up to ${PLAN_DAYS} days ahead.`);
  return [s, e] as const;
}

/** Requests and confirmed bookings inside a period: they stay when it's blocked (she can still answer or cancel them). */
const bookingsIn = async (env: AppEnv['Bindings'], id: string, s: number, e: number) =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM bookings WHERE companion_id = ? AND status IN ('pending', 'confirmed') AND starts_at < ? AND ends_at > ?").bind(id, e, s).first<{ n: number }>())?.n ?? 0;

/**
 * Blocks time (a break, time off): closed whatever the hours say, until she removes it. Body: { startsAt, endsAt,
 * note? } (unix). `kept`: bookings already in that time, which stay.
 */
companionProfile.post('/hours/blocks', async (c) => {
  const u = c.get('user');
  await ownProfile(c.env, u.id);
  const body = await c.req.json<{ startsAt?: unknown; endsAt?: unknown; note?: unknown }>().catch(() => ({}) as { startsAt?: unknown; endsAt?: unknown; note?: unknown });
  const [s, e] = checkBlock(body.startsAt, body.endsAt);
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 60) : '';
  if (note && hasContactDetails(note)) fail(400, CONTACT_MSG);
  const id = newId('hb');
  await c.env.DB.prepare('INSERT INTO hours_blocks (id, companion_id, starts_at, ends_at, note) VALUES (?, ?, ?, ?, ?)').bind(id, u.id, s, e, note).run();
  void slotsChanged(c.env, u.id, c.executionCtx);
  return c.json({ ok: true, block: { id, startsAt: s, endsAt: e, note }, kept: await bookingsIn(c.env, u.id, s, e) }, 201);
});

/** Moves a blocked period's start or end (to extend or shorten it). Body: { startsAt?, endsAt? }. */
companionProfile.patch('/hours/blocks/:id', async (c) => {
  const u = c.get('user');
  const cur = await c.env.DB.prepare('SELECT starts_at, ends_at, note FROM hours_blocks WHERE id = ? AND companion_id = ?').bind(c.req.param('id'), u.id)
    .first<{ starts_at: number; ends_at: number; note: string }>();
  if (!cur) fail(404, 'That blocked time was already removed.');
  const body = await c.req.json<{ startsAt?: unknown; endsAt?: unknown }>().catch(() => ({}) as { startsAt?: unknown; endsAt?: unknown });
  const [s, e] = checkBlock(body.startsAt ?? cur!.starts_at, body.endsAt ?? cur!.ends_at);
  await c.env.DB.prepare('UPDATE hours_blocks SET starts_at = ?, ends_at = ? WHERE id = ? AND companion_id = ?').bind(s, e, c.req.param('id'), u.id).run();
  void slotsChanged(c.env, u.id, c.executionCtx);
  return c.json({ ok: true, block: { id: c.req.param('id'), startsAt: s, endsAt: e, note: cur!.note }, kept: await bookingsIn(c.env, u.id, s, e) });
});

/** Opens blocked time again (it becomes bookable if it's inside her hours). */
companionProfile.delete('/hours/blocks/:id', async (c) => {
  const u = c.get('user');
  await c.env.DB.prepare('DELETE FROM hours_blocks WHERE id = ? AND companion_id = ?').bind(c.req.param('id'), u.id).run();
  void slotsChanged(c.env, u.id, c.executionCtx);
  return c.json({ ok: true });
});

// ---------- Older app versions' hours controls, on the same calendar ----------

/** Fixed window toggle. Body: { day: 'Mon', win: 'am' | 'pm' | 'eve', on, kind?: 'meet' | 'video' } (no kind: both). */
companionProfile.put('/availability', async (c) => {
  const u = c.get('user');
  const { day, win, on, kind } = await c.req.json<{ day: string; win: string; on: boolean; kind?: string }>();
  const d = WEEK.indexOf(day);
  if (d < 0 || !WIN_MIN[win]) fail(400, 'Unknown time slot.');
  const { tz } = await ownProfile(c.env, u.id);
  const { weekRaw } = await hoursRows(c.env, u.id, tz);
  const mask = kind === 'video' ? 2 : kind === 'meet' ? 1 : 3;
  const [a, b] = WIN_MIN[win];
  const that = changeCoverage(weekRaw.filter((r) => r.day === d), a, b, mask, !!on).map((r) => ({ day: d, ...r }));
  await saveWeek(c.env, u.id, [...weekRaw.filter((r) => r.day !== d), ...that]);
  void slotsChanged(c.env, u.id, c.executionCtx);
  return c.json({ ok: true });
});

/** A date's hours for one kind (or both). Body: { ranges: [['18:00', '23:00'], …], kind?: 'meet' | 'video' }. */
companionProfile.put('/dates/:date', async (c) => {
  const u = c.get('user');
  const { tz } = await ownProfile(c.env, u.id);
  const date = c.req.param('date');
  checkDate(date, tz);
  const body = await c.req.json<{ ranges?: unknown; kind?: string }>().catch(() => ({}) as { ranges?: unknown; kind?: string });
  let given: Range[] = [];
  try {
    given = cleanRanges(body.ranges);
  } catch (e) {
    fail(400, (e as Error).message);
  }
  let ranges: Range[];
  if (body.kind === 'meet' || body.kind === 'video') {
    // That kind's hours that day become these; the other kind keeps what it had.
    const mask = MASKS[body.kind];
    const { weekRaw, days } = await hoursRows(c.env, u.id, tz);
    const cur = days.find((x) => x.date === date)?.ranges ?? rangesOn({ tz, week: weekRaw, days: new Map(), blocks: [] }, date);
    ranges = given.reduce((acc, r) => changeCoverage(acc, minutes(r.from), minutes(r.from) + span(r), mask, true), changeCoverage(cur, 0, 2880, mask, false));
  } else ranges = normalize(given);
  await saveDay(c.env, u.id, date, ranges);
  void slotsChanged(c.env, u.id, c.executionCtx);
  return c.json({ ok: true, date, ranges: given.map((r) => [r.from, r.to]), kind: body.kind ?? 'both', kept: await bookingsOn(c.env, u.id, date, tz) });
});

/** Back to the weekly hours on this date (`?kind=`: for that kind only). */
companionProfile.delete('/dates/:date', async (c) => {
  const u = c.get('user');
  const kind = c.req.query('kind');
  const date = c.req.param('date');
  if (kind === 'meet' || kind === 'video') {
    const { tz } = await ownProfile(c.env, u.id);
    const { weekRaw, days } = await hoursRows(c.env, u.id, tz);
    const own = days.find((x) => x.date === date);
    if (own) {
      const mask = MASKS[kind];
      const weekly = rangesOn({ tz, week: weekRaw, days: new Map(), blocks: [] }, date);
      let ranges = changeCoverage(own.ranges, 0, 2880, mask, false);
      for (const r of weekly) if (MASKS[r.kind] & mask) ranges = changeCoverage(ranges, minutes(r.from), minutes(r.from) + span(r), mask, true);
      if (JSON.stringify(normalize(ranges)) === JSON.stringify(normalize(weekly))) {
        await c.env.DB.prepare('DELETE FROM hours_days WHERE companion_id = ? AND date = ?').bind(u.id, date).run();
      } else await saveDay(c.env, u.id, date, ranges);
    }
  } else await c.env.DB.prepare('DELETE FROM hours_days WHERE companion_id = ? AND date = ?').bind(u.id, date).run();
  void slotsChanged(c.env, u.id, c.executionCtx);
  return c.json({ ok: true });
});

/**
 * The profile of someone who booked you, so you know who you're meeting. Only for companions they've booked,
 * and only what's meant to be shown: never the email, phone or ID documents.
 */
companionProfile.get('/customers/:id', async (c) => {
  const id = c.req.param('id');
  const together = await c.env.DB.prepare(
    'SELECT id, activity, starts_at, duration_h, status FROM bookings WHERE companion_id = ? AND customer_id = ? AND paid = 1 ORDER BY starts_at DESC LIMIT 20',
  ).bind(c.get('user').id, id).all<{ id: string; activity: string; starts_at: number; duration_h: number; status: string }>();
  if (!together.results.length) fail(404, 'You can see someone’s profile once they’ve booked you.');
  const u = await c.env.DB.prepare('SELECT name, bio, avatar_id, id_status, created_at, gender, age, languages, interests FROM users WHERE id = ?').bind(id)
    .first<{ name: string; bio: string | null; avatar_id: string | null; id_status: string; created_at: number; gender: string | null; age: number | null; languages: string; interests: string }>();
  if (!u) fail(404, 'This account no longer exists.');
  const met = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM bookings WHERE customer_id = ? AND status = 'completed'").bind(id).first<{ n: number }>();
  return c.json({
    id, name: u!.name || 'Customer', bio: u!.bio ?? '', avatarUrl: u!.avatar_id ? `/photos/${u!.avatar_id}` : null,
    verified: u!.id_status === 'approved', since: u!.created_at, gender: u!.gender, age: u!.age,
    languages: parseJson<string[]>(u!.languages, []), interests: parseJson<string[]>(u!.interests, []),
    meetups: met?.n ?? 0,
    together: together.results.map((b) => ({ id: b.id, act: b.activity, startsAt: b.starts_at, dur: b.duration_h, status: b.status, ...whenIn(b.starts_at, c.get('user').tz) })),
  });
});
