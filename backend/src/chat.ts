import { DurableObject } from 'cloudflare:workers';
import { Hono } from 'hono';
import type { AppEnv, Env } from './types';
import { notify } from './lib/notify';
import { fail, newId, now, shouldFlag } from './lib/util';

/**
 * One Durable Object per conversation. Holds the open WebSockets (hibernation API)
 * and fans out new messages and typing indicators. Messages themselves live in D1.
 */
export class ChatRoom extends DurableObject<Env> {
  async fetch(req: Request) {
    const url = new URL(req.url);
    if (url.pathname === '/broadcast') {
      const msg = await req.text();
      for (const ws of this.ctx.getWebSockets()) ws.send(msg);
      return new Response('ok');
    }
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const userId = url.searchParams.get('uid') ?? '';
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [userId]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== 'string') return;
    let m: { type?: string };
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    // Only typing indicators travel over the socket; messages are sent via the REST API.
    if (m.type !== 'typing') return;
    const [from] = this.ctx.getTags(ws);
    for (const other of this.ctx.getWebSockets()) if (other !== ws) other.send(JSON.stringify({ type: 'typing', from }));
  }

  async webSocketClose(ws: WebSocket, code: number) {
    ws.close(code, 'bye');
  }
}

type ConvRow = { id: string; customer_id: string; companion_id: string; booking_id: string | null; customer_unread: number; companion_unread: number; last_at: number };

async function member(env: Env, convId: string, userId: string) {
  const cv = await env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(convId).first<ConvRow>();
  if (!cv || (cv.customer_id !== userId && cv.companion_id !== userId)) fail(404, 'Conversation not found.');
  return cv!;
}

export const chat = new Hono<AppEnv>();

/** Inbox. `side=customer` (default) or `side=companion`. */
chat.get('/', async (c) => {
  const u = c.get('user');
  const side = c.req.query('side') === 'companion' ? 'companion' : 'customer';
  const r = await c.env.DB.prepare(
    `SELECT cv.*, cp.display_name AS companion_name, cp.hue, cu.name AS customer_name,
            b.activity, b.starts_at, b.status AS booking_status,
            (SELECT body FROM messages m WHERE m.conversation_id = cv.id ORDER BY created_at DESC LIMIT 1) AS last_body,
            (SELECT sender_id FROM messages m WHERE m.conversation_id = cv.id ORDER BY created_at DESC LIMIT 1) AS last_sender
     FROM conversations cv
     JOIN companions cp ON cp.user_id = cv.companion_id
     JOIN users cu ON cu.id = cv.customer_id
     LEFT JOIN bookings b ON b.id = cv.booking_id
     WHERE ${side === 'customer' ? 'cv.customer_id' : 'cv.companion_id'} = ?
     ORDER BY cv.last_at DESC LIMIT 100`,
  ).bind(u.id).all<ConvRow & { companion_name: string; hue: number; customer_name: string; activity: string | null; starts_at: number | null; booking_status: string | null; last_body: string | null; last_sender: string | null }>();
  return c.json(r.results.map((x) => ({
    id: x.id,
    cid: x.companion_id,
    name: side === 'customer' ? x.companion_name : x.customer_name || 'Customer',
    hue: x.hue,
    bookingId: x.booking_id,
    act: x.activity,
    startsAt: x.starts_at,
    status: x.booking_status ?? 'none',
    last: x.last_body ? { me: x.last_sender === u.id, t: x.last_body } : null,
    lastAt: x.last_at,
    unread: side === 'customer' ? x.customer_unread : x.companion_unread,
  })));
});

/** Start (or reopen) a chat with a companion before booking. */
chat.post('/', async (c) => {
  const u = c.get('user');
  const { companionId } = await c.req.json<{ companionId: string }>();
  const comp = await c.env.DB.prepare("SELECT 1 FROM companions WHERE user_id = ? AND status = 'approved'").bind(companionId).first();
  if (!comp || companionId === u.id) fail(404, 'This companion isn’t available.');
  await c.env.DB.prepare('INSERT OR IGNORE INTO conversations (id, customer_id, companion_id) VALUES (?, ?, ?)').bind(newId('cv'), u.id, companionId).run();
  const cv = await c.env.DB.prepare('SELECT id FROM conversations WHERE customer_id = ? AND companion_id = ?').bind(u.id, companionId).first<{ id: string }>();
  return c.json({ id: cv!.id });
});

chat.get('/:id/messages', async (c) => {
  const u = c.get('user');
  const cv = await member(c.env, c.req.param('id'), u.id);
  const before = Number(c.req.query('before') ?? now() + 1);
  const r = await c.env.DB.prepare('SELECT id, sender_id, body, created_at FROM messages WHERE conversation_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT 100')
    .bind(cv.id, before).all<{ id: string; sender_id: string; body: string; created_at: number }>();
  await c.env.DB.prepare(`UPDATE conversations SET ${cv.customer_id === u.id ? 'customer_unread' : 'companion_unread'} = 0 WHERE id = ?`).bind(cv.id).run();
  return c.json(r.results.reverse().map((m) => ({ id: m.id, me: m.sender_id === u.id, t: m.body, at: m.created_at })));
});

chat.post('/:id/messages', async (c) => {
  const u = c.get('user');
  const cv = await member(c.env, c.req.param('id'), u.id);
  const { text } = await c.req.json<{ text?: string }>();
  const body = (text ?? '').trim().slice(0, 2000);
  if (!body) fail(400, 'Message is empty.');
  const other = cv.customer_id === u.id ? cv.companion_id : cv.customer_id;
  const blocked = await c.env.DB.prepare('SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?').bind(other, u.id).first();
  if (blocked) fail(403, 'You can’t message this person.');
  const id = newId('m');
  const at = now();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO messages (id, conversation_id, sender_id, body, flagged, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, cv.id, u.id, body, shouldFlag(body) ? 1 : 0, at),
    c.env.DB.prepare(`UPDATE conversations SET last_at = ?, ${cv.customer_id === u.id ? 'companion_unread' : 'customer_unread'} = ${cv.customer_id === u.id ? 'companion_unread' : 'customer_unread'} + 1 WHERE id = ?`).bind(at, cv.id),
  ]);
  const event = JSON.stringify({ type: 'message', id, from: u.id, t: body, at });
  c.executionCtx.waitUntil(c.env.CHAT.get(c.env.CHAT.idFromName(cv.id)).fetch('https://chat/broadcast', { method: 'POST', body: event }));
  const senderName = cv.customer_id === u.id
    ? (await c.env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(u.id).first<{ name: string }>())?.name || 'A customer'
    : (await c.env.DB.prepare('SELECT display_name FROM companions WHERE user_id = ?').bind(u.id).first<{ display_name: string }>())!.display_name;
  await notify(c.env, other, { icon: 'message-circle', tone: 'violet', title: 'New message from ' + senderName, body: `“${body.slice(0, 120)}”`, go: 'chat:' + cv.id }, c.executionCtx);
  return c.json({ id, me: true, t: body, at }, 201);
});

/** WebSocket for live messages + typing. Auth via ?token= (WebSockets can't send headers from every client). */
chat.get('/:id/ws', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') fail(400, 'Expected a WebSocket upgrade.');
  const u = c.get('user');
  const cv = await member(c.env, c.req.param('id'), u.id);
  const url = new URL('https://chat/ws');
  url.searchParams.set('uid', u.id);
  return c.env.CHAT.get(c.env.CHAT.idFromName(cv.id)).fetch(url.toString(), c.req.raw);
});
