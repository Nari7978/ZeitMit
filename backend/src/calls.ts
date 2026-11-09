// Video dates: the two phones talk directly to each other (WebRTC). The server only introduces them: one CallRoom
// per booking passes the call setup between them, sees who is there, counts the time both are on the call together
// and releases the payment once it's long enough. No video ever goes through the server.
import { DurableObject } from 'cloudflare:workers';
import { Hono } from 'hono';
import type { AppEnv, Env } from './types';
import { VIDEO_ACT } from './types';
import { notify } from './lib/notify';
import { fail, now } from './lib/util';
import { completeVideoDate } from './routes/bookings';

type Side = 'customer' | 'companion';
type Attachment = { uid: string; side: Side; media: boolean; gone?: boolean };
type Meta = { booking: string; end: number; release: number };

/** The call opens this long before the start. */
export const JOIN_EARLY_S = 10 * 60;
/** Seconds on the call together before the payment is released. */
export const releaseSeconds = (env: Env) => Math.max(1, Number(env.CALL_RELEASE_SECONDS) || 600);
const otherSide = (s: Side): Side => (s === 'customer' ? 'companion' : 'customer');

// Free public STUN servers: enough for most networks. A TURN relay is added when a Cloudflare TURN key is set.
const STUN = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
type Ice = { urls: string | string[]; username?: string; credential?: string };

/** Servers that help the phones reach each other: Cloudflare's TURN relay with short-lived credentials if set up. */
async function iceServersFor(env: Env, ttl: number): Promise<Ice[]> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return STUN;
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: Math.min(Math.max(ttl, 900), 48 * 3600) }),
    });
    if (!r.ok) throw new Error(`TURN credentials: ${r.status}`);
    const j = await r.json<{ iceServers?: Ice | Ice[] }>();
    const list = Array.isArray(j.iceServers) ? j.iceServers : j.iceServers ? [j.iceServers] : [];
    // Browsers block port 53, so those addresses would only time out.
    const clean = list
      .map((s) => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)) }))
      .filter((s) => s.urls.length);
    return clean.length ? clean : STUN;
  } catch (e) {
    console.error('TURN credentials failed', e);
    return STUN;
  }
}

type CallRow = {
  id: string; customer_id: string; companion_id: string; activity: string; starts_at: number; duration_h: number; status: string; paid: number;
  companion_name: string; customer_name: string | null;
};

/** Why a video date that ended before it happened has no call. */
const CLOSED: Record<string, string> = {
  cancelled: 'This booking was cancelled.',
  rejected: 'This request was declined.',
  expired: 'This request expired without an answer.',
  conflicted: 'That time was booked by someone else, so this request was refunded.',
};

/** The video date this person may join right now, or why not. */
async function joinable(env: Env, bookingId: string, userId: string) {
  const b = await env.DB.prepare(
    `SELECT b.id, b.customer_id, b.companion_id, b.activity, b.starts_at, b.duration_h, b.status, b.paid, c.display_name AS companion_name, u.name AS customer_name
     FROM bookings b JOIN companions c ON c.user_id = b.companion_id JOIN users u ON u.id = b.customer_id WHERE b.id = ?`,
  ).bind(bookingId).first<CallRow>();
  if (!b || !b.paid || (b.customer_id !== userId && b.companion_id !== userId)) fail(404, 'Booking not found.');
  const side: Side = b!.customer_id === userId ? 'customer' : 'companion';
  const end = b!.starts_at + b!.duration_h * 3600;
  if (b!.activity !== VIDEO_ACT) fail(409, 'This booking isn’t a video date.');
  if (b!.status === 'pending') fail(409, side === 'customer' ? `Your video date opens once ${b!.companion_name} accepts.` : 'Accept the request first.');
  // Only a confirmed video date has a call (`completed`: confirmed by the call itself, which carries on until the end).
  if (b!.status !== 'confirmed' && b!.status !== 'completed') fail(409, CLOSED[b!.status] ?? 'This booking was cancelled.');
  if (now() >= end) fail(409, 'This video date has ended.');
  if (now() < b!.starts_at - JOIN_EARLY_S) fail(409, 'You can join from 10 minutes before the start.');
  return { b: b!, side, end };
}

export const calls = new Hono<AppEnv>();

/** What the app needs to start the call: who with, until when, and the servers that help the phones connect. */
calls.post('/:id', async (c) => {
  const { b, side, end } = await joinable(c.env, c.req.param('id'), c.get('user').id);
  return c.json({
    bookingId: b.id, side,
    peer: side === 'customer' ? b.companion_name : (b.customer_name || '').trim().split(/\s+/)[0] || 'Customer',
    peerId: side === 'customer' ? b.companion_id : b.customer_id,
    startsAt: b.starts_at, endsAt: end, releaseAfter: releaseSeconds(c.env), confirmed: b.status === 'completed',
    iceServers: await iceServersFor(c.env, end - now() + 1800),
  });
});

/** The call room's socket (auth with ?token=, as WebSockets can't send headers from every client). */
calls.get('/:id/ws', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') fail(400, 'Expected a WebSocket upgrade.');
  const { b, side, end } = await joinable(c.env, c.req.param('id'), c.get('user').id);
  const url = new URL('https://call/ws');
  for (const [k, v] of Object.entries({ uid: c.get('user').id, side, booking: b.id, end: String(end), release: String(releaseSeconds(c.env)) })) url.searchParams.set(k, v);
  return c.env.CALLS.get(c.env.CALLS.idFromName(b.id)).fetch(url.toString(), c.req.raw);
});

/** Tells the other person that someone is waiting for them in the call (once per side). */
async function tellWaiting(env: Env, bookingId: string, joined: Side) {
  const b = await env.DB.prepare(
    `SELECT b.customer_id, b.companion_id, c.display_name AS companion_name, u.name AS customer_name FROM bookings b
     JOIN companions c ON c.user_id = b.companion_id JOIN users u ON u.id = b.customer_id WHERE b.id = ?`,
  ).bind(bookingId).first<{ customer_id: string; companion_id: string; companion_name: string; customer_name: string | null }>();
  if (!b) return;
  const who = joined === 'customer' ? (b.customer_name || '').trim().split(/\s+/)[0] || 'Your customer' : b.companion_name;
  await notify(env, joined === 'customer' ? b.companion_id : b.customer_id, {
    icon: 'video', tone: 'violet', title: `${who} is waiting in your video date`, body: 'Join the call from your booking.', go: `call:${bookingId}`,
  });
}

/**
 * One room per video date. Holds both sockets (hibernation API), passes the call setup (offer, answer, network
 * candidates) between them, and counts the seconds both have video connected. State lives in the room's storage so
 * it survives the room sleeping between messages.
 */
export class CallRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private live(side: Side, except?: WebSocket) {
    return this.ctx.getWebSockets(side).filter((w) => w !== except && w.readyState === WebSocket.READY_STATE_OPEN);
  }
  private send(to: WebSocket[], msg: object) {
    for (const w of to) try { w.send(JSON.stringify(msg)); } catch { /* gone */ }
  }

  async fetch(req: Request) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const q = new URL(req.url).searchParams;
    const uid = q.get('uid') ?? '', side = q.get('side') === 'companion' ? 'companion' : 'customer';
    const meta: Meta = { booking: q.get('booking') ?? '', end: Number(q.get('end')), release: Number(q.get('release')) || 600 };
    await this.ctx.storage.put('meta', meta);
    // One connection per person: rejoining (or a second phone) replaces the old one.
    const old = this.live(side);
    this.send(old, { type: 'replaced' });
    for (const w of old) { w.serializeAttachment({ ...(w.deserializeAttachment() as Attachment), media: false }); try { w.close(4000, 'replaced'); } catch { /* closed */ } }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [side, uid]);
    pair[1].serializeAttachment({ uid, side, media: false } satisfies Attachment);
    const peer = this.live(otherSide(side));
    this.send([pair[1]], { type: 'hello', peer: peer.length > 0, confirmed: !!(await this.ctx.storage.get('released')), together: await this.together(), release: meta.release, endsAt: meta.end });
    this.send(peer, { type: 'peer-joined' });
    // The first time in: noted for the no-show rules, and the other person hears they're being waited for.
    const col = side === 'customer' ? 'call_customer_at' : 'call_companion_at';
    await this.env.DB.prepare(`UPDATE bookings SET ${col} = COALESCE(${col}, ?) WHERE id = ?`).bind(now(), meta.booking).run();
    if (!peer.length && !(await this.ctx.storage.get(`told:${side}`))) {
      await this.ctx.storage.put(`told:${side}`, true);
      this.ctx.waitUntil(tellWaiting(this.env, meta.booking, side).catch((e) => console.error('Waiting note failed', e)));
    }
    await this.recount();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== 'string' || data.length > 100_000) return;
    let m: { type?: string; data?: unknown; on?: boolean };
    try { m = JSON.parse(data); } catch { return; }
    const me = ws.deserializeAttachment() as Attachment | null;
    if (!me) return;
    const peer = this.live(otherSide(me.side));
    if (m.type === 'signal') this.send(peer, { type: 'signal', data: m.data });
    else if (m.type === 'media') { ws.serializeAttachment({ ...me, media: !!m.on }); await this.recount(); }
    else if (m.type === 'bye') {
      // Hung up on purpose: the other phone can end its side of the call straight away.
      ws.serializeAttachment({ ...me, media: false, gone: true });
      if (!this.live(me.side, ws).length) this.send(peer, { type: 'peer-left', bye: true });
      try { ws.close(1000, 'bye'); } catch { /* closed */ }
      await this.recount(ws);
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    // 1005/1006 ("no status", "connection dropped") are reserved and can't be sent back.
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye'); } catch { /* closed */ }
    await this.left(ws);
  }
  async webSocketError(ws: WebSocket) {
    await this.left(ws);
  }

  /** The connection dropped (the video between the phones may still be running; they say if it stops). */
  private async left(ws: WebSocket) {
    const me = ws.deserializeAttachment() as Attachment | null;
    if (!me) return;
    if (!me.gone) {
      ws.serializeAttachment({ ...me, media: false });
      // Replaced by a newer connection of the same person: nothing changed for the other side.
      if (!this.live(me.side, ws).length) this.send(this.live(otherSide(me.side)), { type: 'peer-left', bye: false });
    }
    await this.recount(ws);
  }

  /** Seconds both have been on the call together so far. */
  private async together() {
    const total = (await this.ctx.storage.get<number>('together')) ?? 0;
    const since = await this.ctx.storage.get<number>('since');
    return total + (since ? now() - since : 0);
  }

  /** Starts or stops the together clock, releases the payment when it's reached, and sets the next wake-up. */
  private async recount(except?: WebSocket) {
    const meta = await this.ctx.storage.get<Meta>('meta');
    if (!meta) return;
    const on = (s: Side) => this.live(s, except).some((w) => (w.deserializeAttachment() as Attachment | null)?.media);
    const both = on('customer') && on('companion') && now() < meta.end;
    const since = await this.ctx.storage.get<number>('since');
    if (both && !since) await this.ctx.storage.put('since', now());
    if (!both && since) {
      const total = ((await this.ctx.storage.get<number>('together')) ?? 0) + (now() - since);
      await this.ctx.storage.put('together', total);
      await this.ctx.storage.delete('since');
      await this.env.DB.prepare('UPDATE bookings SET call_together_s = MAX(call_together_s, ?) WHERE id = ?').bind(total, meta.booking).run();
    }
    await this.release(meta);
    await this.wake(meta);
  }

  private async release(meta: Meta) {
    if (await this.ctx.storage.get('released')) return;
    const t = await this.together();
    if (t < meta.release) return;
    await this.ctx.storage.put('released', true);
    await this.env.DB.prepare('UPDATE bookings SET call_together_s = MAX(call_together_s, ?) WHERE id = ?').bind(t, meta.booking).run();
    if (await completeVideoDate(this.env, meta.booking)) this.send(this.ctx.getWebSockets(), { type: 'confirmed' });
  }

  /** Wakes up when the together clock reaches the release time, or at the booked end. */
  private async wake(meta: Meta) {
    let at = meta.end;
    const since = await this.ctx.storage.get<number>('since');
    if (since && !(await this.ctx.storage.get('released'))) at = Math.min(at, since + meta.release - ((await this.ctx.storage.get<number>('together')) ?? 0));
    await this.ctx.storage.setAlarm(Math.max(at, now() + 1) * 1000);
  }

  async alarm() {
    const meta = await this.ctx.storage.get<Meta>('meta');
    if (!meta) return;
    if (now() < meta.end) return this.recount();
    // The booked time is over: stop the clock and end the call for both.
    await this.recount();
    for (const w of this.ctx.getWebSockets()) {
      try { w.send(JSON.stringify({ type: 'ended' })); w.close(1000, 'ended'); } catch { /* closed */ }
    }
    await this.ctx.storage.deleteAlarm();
  }
}
