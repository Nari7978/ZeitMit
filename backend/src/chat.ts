import { DurableObject } from 'cloudflare:workers';
import { Hono } from 'hono';
import type { AppEnv, Env } from './types';
import { notify } from './lib/notify';
import { fail, hasContactDetails, newId, now, shouldFlag } from './lib/util';

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

/**
 * Chats open only with a paid booking between the two: while it's pending or confirmed,
 * and for 7 days after the meeting. Otherwise the history stays readable but nobody can write.
 */
const CHAT_DAYS_AFTER = 7;
const OPEN_SQL = `EXISTS (SELECT 1 FROM bookings ob WHERE ob.customer_id = cv.customer_id AND ob.companion_id = cv.companion_id AND ob.paid = 1
  AND (ob.status IN ('pending', 'confirmed') OR (ob.status = 'completed' AND ob.starts_at + ob.duration_h * 3600 > ?)))`;
const closedAfter = () => now() - CHAT_DAYS_AFTER * 86400;

async function chatOpen(env: Env, customerId: string, companionId: string) {
  const r = await env.DB.prepare(`SELECT ${OPEN_SQL} AS open FROM (SELECT ? AS customer_id, ? AS companion_id) cv`)
    .bind(closedAfter(), customerId, companionId).first<{ open: number }>(); // OPEN_SQL's cut-off comes first in the text
  return !!r?.open;
}

export const chat = new Hono<AppEnv>();

/** Inbox. `side=customer` (default) or `side=companion`. */
chat.get('/', async (c) => {
  const u = c.get('user');
  const side = c.req.query('side') === 'companion' ? 'companion' : 'customer';
  const r = await c.env.DB.prepare(
    `SELECT cv.*, cp.display_name AS companion_name, cp.hue, cp.photo_id, cu.name AS customer_name, cu.avatar_id,
            b.activity, b.starts_at, b.status AS booking_status, ${OPEN_SQL} AS open,
            (SELECT body FROM messages m WHERE m.conversation_id = cv.id ORDER BY created_at DESC LIMIT 1) AS last_body,
            (SELECT sender_id FROM messages m WHERE m.conversation_id = cv.id ORDER BY created_at DESC LIMIT 1) AS last_sender
     FROM conversations cv
     JOIN companions cp ON cp.user_id = cv.companion_id
     JOIN users cu ON cu.id = cv.customer_id
     LEFT JOIN bookings b ON b.id = cv.booking_id
     WHERE ${side === 'customer' ? 'cv.customer_id' : 'cv.companion_id'} = ?
     ORDER BY cv.last_at DESC LIMIT 100`,
  ).bind(closedAfter(), u.id).all<ConvRow & { open: number; companion_name: string; hue: number; photo_id: string | null; avatar_id: string | null; customer_name: string; activity: string | null; starts_at: number | null; booking_status: string | null; last_body: string | null; last_sender: string | null }>();
  return c.json(r.results.map((x) => ({
    id: x.id,
    cid: x.companion_id,
    customerId: x.customer_id,
    name: side === 'customer' ? x.companion_name : x.customer_name || 'Customer',
    hue: x.hue,
    photoUrl: side === 'customer' ? (x.photo_id ? `/photos/${x.photo_id}` : null) : x.avatar_id ? `/photos/${x.avatar_id}` : null,
    bookingId: x.booking_id,
    act: x.activity,
    startsAt: x.starts_at,
    status: x.booking_status ?? 'none',
    last: x.last_body ? { me: x.last_sender === u.id, t: x.last_body } : null,
    lastAt: x.last_at,
    unread: side === 'customer' ? x.customer_unread : x.companion_unread,
    canSend: !!x.open,
  })));
});

/** Opens the chat with a companion you have a paid booking with. */
chat.post('/', async (c) => {
  const u = c.get('user');
  const { companionId } = await c.req.json<{ companionId: string }>();
  const comp = await c.env.DB.prepare("SELECT display_name FROM companions WHERE user_id = ? AND status = 'approved'").bind(companionId).first<{ display_name: string }>();
  if (!comp || companionId === u.id) fail(404, 'This companion isn’t available.');
  if (!(await chatOpen(c.env, u.id, companionId))) fail(403, `You can message ${comp!.display_name} once you’ve booked and paid. Add a note to your booking request instead.`);
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
  if (!(await chatOpen(c.env, cv.customer_id, cv.companion_id))) fail(403, 'This chat is closed. Chats are open while you have a paid booking, and for 7 days after you meet.');
  if (hasContactDetails(body)) fail(400, 'For everyone’s safety, phone numbers and email addresses can’t be shared in chat. Keep talking here in ZeitMit.');
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
