import { DurableObject } from 'cloudflare:workers';
import { Hono } from 'hono';
import type { AppEnv, Env } from './types';
import { notify } from './lib/notify';
import { CONTACT_MSG, fail, hasContactDetails, newId, now, shouldFlag } from './lib/util';
import { ensureThread } from './routes/bookings';

/**
 * One Durable Object per conversation. Holds the open WebSockets (hibernation API)
 * and fans out new messages and typing indicators. Messages themselves live in D1.
 */
export class ChatRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep-alive pings are answered without waking the object up.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req: Request) {
    const url = new URL(req.url);
    if (url.pathname === '/broadcast') {
      const msg = await req.text();
      for (const ws of this.ctx.getWebSockets()) ws.send(msg);
      return new Response('ok');
    }
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const userId = url.searchParams.get('uid') ?? '';
    const kind = url.searchParams.get('kind') === 'live' ? 'live' : 'chat';
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [userId, kind]);
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
    // Only typing indicators travel over the socket; messages are sent via the REST API. Live rooms only send.
    const [from, kind] = this.ctx.getTags(ws);
    if (m.type !== 'typing' || kind === 'live') return;
    for (const other of this.ctx.getWebSockets()) if (other !== ws) other.send(JSON.stringify({ type: 'typing', from }));
  }

  async webSocketClose(ws: WebSocket, code: number) {
    // 1005/1006 ("no status", "connection dropped") are reserved and can't be sent back.
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye');
    } catch {
      // Already closed.
    }
  }
}

type ConvRow = { id: string; customer_id: string; companion_id: string; booking_id: string | null; customer_unread: number; companion_unread: number; last_at: number };

async function member(env: Env, convId: string, userId: string) {
  const cv = await env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(convId).first<ConvRow>();
  if (!cv || (cv.customer_id !== userId && cv.companion_id !== userId)) fail(404, 'Conversation not found.');
  return cv!;
}

/**
 * Every paid booking has its own thread. It's open while the booking is pending or confirmed and ends for
 * both sides once the meet code is entered (or the booking is cancelled). History stays readable.
 */
const OPEN_SQL = `EXISTS (SELECT 1 FROM bookings ob WHERE ob.id = cv.booking_id AND ob.paid = 1 AND ob.status IN ('pending', 'confirmed'))`;

async function threadOpen(env: Env, convId: string) {
  const r = await env.DB.prepare(`SELECT ${OPEN_SQL} AS open FROM conversations cv WHERE cv.id = ?`).bind(convId).first<{ open: number }>();
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
  ).bind(u.id).all<ConvRow & { open: number; companion_name: string; hue: number; photo_id: string | null; avatar_id: string | null; customer_name: string; activity: string | null; starts_at: number | null; booking_status: string | null; last_body: string | null; last_sender: string | null }>();
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

/**
 * Finds the thread to open: `{ bookingId }` for a specific booking (either side), or `{ companionId }` for the
 * customer's current booking with that companion. Chat starts only with a paid booking.
 */
chat.post('/', async (c) => {
  const u = c.get('user');
  const { companionId, bookingId } = await c.req.json<{ companionId?: string; bookingId?: string }>();
  if (bookingId) {
    const b = await c.env.DB.prepare('SELECT id, customer_id, companion_id, status, paid FROM bookings WHERE id = ?').bind(bookingId)
      .first<{ id: string; customer_id: string; companion_id: string; status: string; paid: number }>();
    if (!b || (b.customer_id !== u.id && b.companion_id !== u.id) || !b.paid) fail(404, 'Booking not found.');
    const existing = await c.env.DB.prepare('SELECT id FROM conversations WHERE booking_id = ?').bind(b!.id).first<{ id: string }>();
    if (existing) return c.json({ id: existing.id });
    // Bookings from before threads existed get one on first open, if they're still running.
    if (b!.status !== 'pending' && b!.status !== 'confirmed') fail(404, 'This booking has no chat.');
    return c.json({ id: await ensureThread(c.env, b!) });
  }
  const comp = await c.env.DB.prepare("SELECT display_name FROM companions WHERE user_id = ? AND status = 'approved'").bind(companionId ?? '').first<{ display_name: string }>();
  if (!comp || companionId === u.id) fail(404, 'This companion isn’t available.');
  const open = await c.env.DB.prepare(
    `SELECT b.id, b.customer_id, b.companion_id FROM bookings b WHERE b.customer_id = ? AND b.companion_id = ? AND b.paid = 1 AND b.status IN ('pending', 'confirmed')
     ORDER BY b.starts_at LIMIT 1`,
  ).bind(u.id, companionId).first<{ id: string; customer_id: string; companion_id: string }>();
  if (!open) fail(403, `You can message ${comp!.display_name} once you’ve booked and paid. Add a note to your booking request instead.`);
  return c.json({ id: await ensureThread(c.env, open!) });
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
  if (!(await threadOpen(c.env, cv.id))) fail(403, 'This chat has ended. Each booking has its own chat, open until you meet.');
  if (hasContactDetails(body)) fail(400, CONTACT_MSG);
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
