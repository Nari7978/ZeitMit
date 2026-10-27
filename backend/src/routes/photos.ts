import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { requireAuth, verifySession } from '../lib/auth';
import { fail, newId } from '../lib/util';

const MAX_B64 = 700_000; // ≈ 500 KB image; the app sends ~100 KB JPEGs
const KINDS = ['avatar', 'companion', 'id'] as const;

export const photos = new Hono<AppEnv>();

/**
 * Upload a photo. Body: { kind: 'avatar' | 'companion' | 'id', data: base64, mime? }
 * avatar → becomes the user's picture; companion → the companion listing photo (if a listing exists);
 * id → kept private for the admin review and deleted after the decision.
 */
photos.post('/', requireAuth, async (c) => {
  const u = c.get('user');
  const { kind, data, mime } = await c.req.json<{ kind: (typeof KINDS)[number]; data: string; mime?: string }>();
  if (!KINDS.includes(kind)) fail(400, 'Unknown photo type.');
  if (!data || typeof data !== 'string' || data.length > MAX_B64) fail(400, 'That photo is too large. Try another one.');
  if (!/^[A-Za-z0-9+/=]+$/.test(data.slice(0, 200))) fail(400, 'Invalid image data.');
  const type = mime === 'image/png' ? 'image/png' : 'image/jpeg';
  const id = newId('ph');
  await c.env.DB.prepare('INSERT INTO photos (id, owner_id, kind, mime, data) VALUES (?, ?, ?, ?, ?)').bind(id, u.id, kind, type, data).run();

  if (kind === 'avatar') {
    const old = await c.env.DB.prepare('SELECT avatar_id FROM users WHERE id = ?').bind(u.id).first<{ avatar_id: string | null }>();
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE users SET avatar_id = ? WHERE id = ?').bind(id, u.id),
      c.env.DB.prepare('DELETE FROM photos WHERE id = ? AND owner_id = ?').bind(old?.avatar_id ?? '', u.id),
    ]);
  } else if (kind === 'companion') {
    const old = await c.env.DB.prepare('SELECT photo_id FROM companions WHERE user_id = ?').bind(u.id).first<{ photo_id: string | null }>();
    if (old) {
      await c.env.DB.batch([
        c.env.DB.prepare('UPDATE companions SET photo_id = ? WHERE user_id = ?').bind(id, u.id),
        c.env.DB.prepare('DELETE FROM photos WHERE id = ? AND owner_id = ?').bind(old.photo_id ?? '', u.id),
      ]);
    }
  }
  return c.json({ id, url: `/photos/${id}` }, 201);
});

/** Serve a photo. Profile photos are public; ID photos only to their owner and admins. */
photos.get('/:id', async (c) => {
  const p = await c.env.DB.prepare('SELECT owner_id, kind, mime, data FROM photos WHERE id = ?').bind(c.req.param('id'))
    .first<{ owner_id: string; kind: string; mime: string; data: string }>();
  if (!p) fail(404, 'Photo not found.');
  if (p!.kind === 'id') {
    const h = c.req.header('Authorization') ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : c.req.query('token') ?? '';
    const viewer = token ? await verifySession(token, c.env.JWT_SECRET) : null;
    if (!viewer || (viewer.role !== 'admin' && viewer.id !== p!.owner_id)) fail(403, 'Not allowed.');
  }
  const bytes = Uint8Array.from(atob(p!.data), (ch) => ch.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      'Content-Type': p!.mime,
      'Cache-Control': p!.kind === 'id' ? 'private, no-store' : 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
    },
  });
});
