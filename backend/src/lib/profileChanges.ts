// Approved companions' new texts and photos wait for an admin before customers see them (admin → Profile changes);
// the live listing stays as it was until then. One change waits per thing (About, tagline, profile photo, gallery): a
// newer one replaces it, and changing it back to what's live withdraws it. Companions still applying (or applying
// again) change their listing directly, since the whole listing is reviewed then.
import type { Env } from '../types';
import { newId, parseJson } from './util';

export type Field = 'about' | 'tagline' | 'photo' | 'gallery';
export type ChangeRow = {
  id: string; companion_id: string; field: Field; value: string; previous: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'replaced'; note: string | null; created_at: number; decided_at: number | null;
};

/** The changes waiting for review, by thing. */
export async function waitingOf(env: Env, userId: string) {
  const r = await env.DB.prepare("SELECT * FROM profile_changes WHERE companion_id = ? AND status = 'pending'").bind(userId).all<ChangeRow>();
  return new Map(r.results.map((x) => [x.field, x]));
}

/**
 * A new value for review, as statements for one batch: the change waiting for the same thing is replaced (a profile
 * photo nobody saw is deleted with it), and a value that's back to what's live just withdraws it. Sending the value
 * that's already waiting changes nothing (the app saves every field each time).
 */
export function propose(env: Env, userId: string, field: Field, value: string, live: string | null, waiting?: ChangeRow): D1PreparedStatement[] {
  if (waiting?.value === value) return [];
  const out: D1PreparedStatement[] = [];
  if (waiting) {
    out.push(env.DB.prepare("UPDATE profile_changes SET status = 'replaced', decided_at = unixepoch() WHERE id = ? AND status = 'pending'").bind(waiting.id));
    if (field === 'photo') out.push(env.DB.prepare("DELETE FROM photos WHERE id = ? AND owner_id = ? AND kind = 'companion'").bind(waiting.value, userId));
  }
  if (value !== (live ?? '')) {
    out.push(env.DB.prepare('INSERT INTO profile_changes (id, companion_id, field, value, previous) VALUES (?, ?, ?, ?, ?)').bind(newId('pc'), userId, field, value, live));
  }
  return out;
}

/** Withdraws whatever waits for review (applying again: the whole listing is reviewed then), with photos nobody saw. */
export const withdrawAll = (env: Env, userId: string, keepPhoto: string | null) => [
  env.DB.prepare(
    `DELETE FROM photos WHERE owner_id = ?1 AND kind = 'companion' AND id <> ?2
       AND id IN (SELECT value FROM profile_changes WHERE companion_id = ?1 AND field = 'photo' AND status = 'pending')`,
  ).bind(userId, keepPhoto ?? ''),
  env.DB.prepare("UPDATE profile_changes SET status = 'replaced', decided_at = unixepoch() WHERE companion_id = ? AND status = 'pending'").bind(userId),
];

/** Gallery photos the person uploaded but no longer uses (removed, rejected, or left from an earlier try) are deleted. */
export const dropUnusedGallery = (env: Env, userId: string, keep: string[]) =>
  env.DB.prepare(`DELETE FROM photos WHERE owner_id = ? AND kind = 'gallery'${keep.length ? ` AND id NOT IN (${keep.map(() => '?').join(',')})` : ''}`).bind(userId, ...keep);

/** What the companion's own listing screen shows of it: what waits for review, and the latest note on anything rejected. */
export async function reviewState(env: Env, userId: string, liveGallery: string[]) {
  const [waiting, rejected] = await Promise.all([
    waitingOf(env, userId),
    env.DB.prepare(
      `SELECT field, note, decided_at FROM profile_changes p WHERE companion_id = ?1 AND status = 'rejected' AND decided_at > unixepoch() - 30 * 86400
         AND NOT EXISTS (SELECT 1 FROM profile_changes q WHERE q.companion_id = ?1 AND q.field = p.field AND q.id <> p.id AND q.created_at >= p.decided_at)
       ORDER BY decided_at DESC`,
    ).bind(userId).all<{ field: Field; note: string | null; decided_at: number }>(),
  ]);
  const gallery = waiting.get('gallery');
  const ids = gallery ? parseJson<string[]>(gallery.value, []) : null;
  const seen = new Set<Field>();
  const times = [...waiting.values()].map((x) => x.created_at);
  return {
    about: waiting.get('about')?.value,
    tagline: waiting.get('tagline')?.value,
    photoUrl: waiting.has('photo') ? `/photos/${waiting.get('photo')!.value}` : undefined,
    gallery: ids ? { ids, urls: ids.map((id) => `/photos/${id}`), added: ids.filter((id) => !liveGallery.includes(id)) } : undefined,
    since: times.length ? Math.min(...times) : undefined,
    rejected: rejected.results.filter((r) => !seen.has(r.field) && seen.add(r.field)).map((r) => ({ field: r.field, note: r.note ?? '', at: r.decided_at })),
  };
}
