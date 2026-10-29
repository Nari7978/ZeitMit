// WebSockets for live updates (see lib/live.ts). Auth via ?token=, as for chat sockets.
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { joinRoom } from '../lib/live';
import { fail } from '../lib/util';

export const live = new Hono<AppEnv>();

/** Your own room: the app reloads when something changes for you (a request, a cancellation, a message…). */
live.get('/', (c) => {
  if (c.req.header('Upgrade') !== 'websocket') fail(400, 'Expected a WebSocket upgrade.');
  const u = c.get('user');
  return joinRoom(c.env, `user:${u.id}`, u.id, c.req.raw);
});

/** A companion's open times, sent again whenever someone books or cancels, or they change their availability. */
live.get('/slots/:id', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') fail(400, 'Expected a WebSocket upgrade.');
  const id = c.req.param('id');
  const known = await c.env.DB.prepare("SELECT 1 FROM companions WHERE user_id = ? AND status = 'approved'").bind(id).first();
  if (!known) fail(404, 'This companion isn’t available.');
  return joinRoom(c.env, `slots:${id}`, c.get('user').id, c.req.raw);
});
