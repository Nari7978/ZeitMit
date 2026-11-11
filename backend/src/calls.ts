// Video dates: the two phones talk directly to each other (WebRTC). The server only introduces them: one CallRoom
// per booking passes the call setup between them, sees who is there and when each side came and went, counts the time
// both had video connected, and settles the payment at the booked end (routes/bookings.ts settleVideoDate). No video
// ever goes through the server.
import { DurableObject } from 'cloudflare:workers';
import { Hono } from 'hono';
import type { AppEnv, Env } from './types';
import { VIDEO_ACT } from './types';
import { broadcast } from './lib/live';
import { ring } from './lib/notify';
import { fail, now } from './lib/util';
import { settleVideoDate, waitSeconds, type CallSummary } from './routes/bookings';
import { unpaidTime, type Presence } from './lib/videoDate';

type Side = 'customer' | 'companion';
type Attachment = { uid: string; side: Side; media: boolean; gone?: boolean };
/** The video date, and who's on each side (rooms from before pings didn't keep that). */
type Meta = { booking: string; start: number; end: number; customer?: string; companion?: string };
/** One side's rings of the other: when the last went out and how many of them were pings. */
type Rang = { at: number; pings: number };
/** Why a ping didn't go out: not in the call yourself, the other person is there, too soon, or too many. */
type PingResult = { ok: true; pingIn: number; pingsLeft: number } | { ok: false; why: 'not-in' | 'here' | 'max' | 'wait'; wait?: number };

/** The call opens this long before the start. */
export const JOIN_EARLY_S = 10 * 60;
/**
 * Pings: the waiting person can ring the other every 30 seconds (`CALL_PING_GAP_SECONDS`), at most PING_MAX times per
 * video date. Joining alone rings them too, but not again for a reconnect within 4 times that (2 minutes).
 */
export const pingGap = (env: Env) => Math.max(1, Number(env.CALL_PING_GAP_SECONDS) || 30);
export const PING_MAX = 10;
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
    startsAt: b.starts_at, endsAt: end, wait: waitSeconds(c.env),
    iceServers: await iceServersFor(c.env, end - now() + 1800),
  });
});

/** The call room's socket (auth with ?token=, as WebSockets can't send headers from every client). */
calls.get('/:id/ws', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') fail(400, 'Expected a WebSocket upgrade.');
  const { b, side, end } = await joinable(c.env, c.req.param('id'), c.get('user').id);
  const url = new URL('https://call/ws');
  for (const [k, v] of Object.entries({
    uid: c.get('user').id, side, booking: b.id, start: String(b.starts_at), end: String(end), customer: b.customer_id, companion: b.companion_id,
  })) url.searchParams.set(k, v);
  return c.env.CALLS.get(c.env.CALLS.idFromName(b.id)).fetch(url.toString(), c.req.raw);
});

/**
 * Pings the other person from the call: their phone rings again. From the booked start, only while you're in the call
 * and they aren't, at most every `pingGap` seconds and PING_MAX times per video date. Returns in how many seconds the
 * next one can go out.
 */
calls.post('/:id/ping', async (c) => {
  const { b, side } = await joinable(c.env, c.req.param('id'), c.get('user').id);
  const peer = side === 'customer' ? b.companion_name : firstName(b.customer_name) || 'your customer';
  // Joining early rings them once; pinging again and again is for when they're late.
  if (now() < b.starts_at) fail(409, `You can ping ${peer} once the video date starts.`);
  const res = await c.env.CALLS.get(c.env.CALLS.idFromName(b.id)).fetch(`https://call/ping?side=${side}`, { method: 'POST' });
  const r = await res.json<PingResult>();
  if (!r.ok) {
    if (r.why === 'not-in') fail(409, 'Join the call first, then ping.');
    if (r.why === 'here') fail(409, `${peer} is already in the call.`);
    if (r.why === 'max') fail(429, `You’ve pinged ${peer} ${PING_MAX} times. They know you’re waiting.`);
    fail(429, `You can ping ${peer} again in ${r.wait} second${r.wait === 1 ? '' : 's'}.`);
  }
  return c.json(r);
});

const firstName = (name: string | null) => (name || '').trim().split(/\s+/)[0];

/** Rings the other person of a video date (see `ring`): the one who's waiting joined alone or pinged. */
async function sendRing(env: Env, bookingId: string, from: Side, why: 'join' | 'ping') {
  const b = await env.DB.prepare(
    `SELECT b.customer_id, b.companion_id, b.starts_at, b.duration_h, c.display_name AS companion_name, u.name AS customer_name FROM bookings b
     JOIN companions c ON c.user_id = b.companion_id JOIN users u ON u.id = b.customer_id WHERE b.id = ?`,
  ).bind(bookingId).first<{ customer_id: string; companion_id: string; starts_at: number; duration_h: number; companion_name: string; customer_name: string | null }>();
  if (!b) return;
  const who = from === 'customer' ? firstName(b.customer_name) || 'Your customer' : b.companion_name;
  await ring(env, from === 'customer' ? b.companion_id : b.customer_id, { bookingId, who, why, endsAt: b.starts_at + Math.round(b.duration_h * 3600) });
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
    const url = new URL(req.url);
    if (url.pathname === '/ping') return Response.json(await this.ping(url.searchParams.get('side') === 'companion' ? 'companion' : 'customer'));
    if (url.pathname === '/summary') return Response.json(await this.summary());
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const q = url.searchParams;
    const uid = q.get('uid') ?? '', side = q.get('side') === 'companion' ? 'companion' : 'customer';
    const meta: Meta = {
      booking: q.get('booking') ?? '', start: Number(q.get('start')) || 0, end: Number(q.get('end')),
      customer: q.get('customer') ?? undefined, companion: q.get('companion') ?? undefined,
    };
    await this.ctx.storage.put('meta', meta);
    // One connection per person: rejoining (or a second phone) replaces the old one.
    const old = this.live(side);
    this.send(old, { type: 'replaced' });
    for (const w of old) { w.serializeAttachment({ ...(w.deserializeAttachment() as Attachment), media: false }); try { w.close(4000, 'replaced'); } catch { /* closed */ } }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [side, uid]);
    pair[1].serializeAttachment({ uid, side, media: false } satisfies Attachment);
    if (!old.length) await this.note(side, true); // a second phone taking over isn't coming in
    const peer = this.live(otherSide(side));
    // In alone: the other person's phone rings (each time, not just the first; a reconnect a moment later doesn't).
    let rang = await this.rang(side);
    if (!peer.length && now() - rang.at >= 4 * pingGap(this.env)) rang = await this.ringOther(side, 'join', rang);
    this.send([pair[1]], {
      type: 'hello', peer: peer.length > 0, together: await this.together(), endsAt: meta.end, wait: waitSeconds(this.env),
      // Who has already waited long enough for the other (so the screen says what being here alone costs).
      covered: await this.covered(meta),
      ...this.pingInfo(rang),
    });
    this.send(peer, { type: 'peer-joined' });
    // The first time in is noted for the no-show rules.
    const col = side === 'customer' ? 'call_customer_at' : 'call_companion_at';
    await this.env.DB.prepare(`UPDATE bookings SET ${col} = COALESCE(${col}, ?) WHERE id = ?`).bind(now(), meta.booking).run();
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
      if (!this.live(me.side, ws).length) {
        await this.note(me.side, false);
        this.send(peer, { type: 'peer-left', bye: true });
        if (!peer.length) await this.ringOff(me.side);
      }
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
      // (The ringing goes on: they may be back in a moment. It stops by itself, or when they hang up.)
      if (!this.live(me.side, ws).length) {
        await this.note(me.side, false);
        this.send(this.live(otherSide(me.side)), { type: 'peer-left', bye: false });
      }
    }
    await this.recount(ws);
  }

  // ---------- Ringing the other person ----------

  private async rang(side: Side) {
    return (await this.ctx.storage.get<Rang>(`rang:${side}`)) ?? { at: 0, pings: 0 };
  }
  /** In how many seconds this side can ping next and how many pings are left, for the app's Ping button. */
  private pingInfo(r: Rang) {
    return { pingIn: Math.max(0, r.at + pingGap(this.env) - now()), pingsLeft: Math.max(0, PING_MAX - r.pings) };
  }

  /** Notes the ring at once (so two can't go out together), then rings in the background. */
  private async ringOther(side: Side, why: 'join' | 'ping', last: Rang): Promise<Rang> {
    const meta = await this.ctx.storage.get<Meta>('meta');
    const next = { at: now(), pings: last.pings + (why === 'ping' ? 1 : 0) };
    await this.ctx.storage.put(`rang:${side}`, next);
    if (meta) this.ctx.waitUntil(sendRing(this.env, meta.booking, side, why).catch((e) => console.error('Ring failed', e)));
    return next;
  }

  /** A ping from the call (POST /calls/:id/ping): you have to be in it, the other person not. */
  private async ping(side: Side): Promise<PingResult> {
    if (!this.live(side).length) return { ok: false, why: 'not-in' };
    if (this.live(otherSide(side)).length) return { ok: false, why: 'here' };
    const last = await this.rang(side);
    if (last.pings >= PING_MAX) return { ok: false, why: 'max' };
    const wait = last.at + pingGap(this.env) - now();
    if (wait > 0) return { ok: false, why: 'wait', wait };
    return { ok: true, ...this.pingInfo(await this.ringOther(side, 'ping', last)) };
  }

  /** The one who rang hung up before the other came: the other's phone can stop ringing. */
  private async ringOff(side: Side) {
    const meta = await this.ctx.storage.get<Meta>('meta');
    const to = meta?.[otherSide(side)];
    if (!meta || !to || !(await this.rang(side)).at) return;
    this.ctx.waitUntil(broadcast(this.env, `user:${to}`, { type: 'ring-off', bookingId: meta.booking, at: now() }));
  }

  /** Notes a side coming into the call or leaving it, for settling the payment at the end. */
  private async note(side: Side, on: boolean) {
    const log = (await this.ctx.storage.get<Presence[]>('log')) ?? [];
    log.push({ s: side, t: now(), on });
    await this.ctx.storage.put('log', log.slice(-500));
  }

  /** Who is covered right now: waited `wait` alone for the other and not together with them since (lib/videoDate.ts). */
  private async covered(meta: Meta) {
    const log = (await this.ctx.storage.get<Presence[]>('log')) ?? [];
    return meta.start ? unpaidTime(log, meta.start, now() + 1, waitSeconds(this.env)).covered : null;
  }

  /** The final count, for settling the payment (stops the together clock first). */
  private async summary(): Promise<CallSummary> {
    await this.recount();
    return { together: await this.together(), log: (await this.ctx.storage.get<Presence[]>('log')) ?? [] };
  }

  /** Seconds both have been on the call together so far. */
  private async together() {
    const total = (await this.ctx.storage.get<number>('together')) ?? 0;
    const since = await this.ctx.storage.get<number>('since');
    return total + (since ? now() - since : 0);
  }

  /** Starts or stops the together clock, and wakes up at the booked end. */
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
    if (now() < meta.end) await this.ctx.storage.setAlarm(meta.end * 1000);
  }

  async alarm() {
    const meta = await this.ctx.storage.get<Meta>('meta');
    if (!meta) return;
    if (now() < meta.end) return this.recount();
    // The booked time is over: stop the clock, settle the payment from what the room saw (the cron does it for video
    // dates whose room never woke up), then end the call for both, so the booking already shows how it ended.
    await this.recount();
    await this.ctx.storage.deleteAlarm();
    try {
      await settleVideoDate(this.env, meta.booking, { together: await this.together(), log: (await this.ctx.storage.get<Presence[]>('log')) ?? [] });
    } catch (e) {
      console.error('Settling the video date failed', meta.booking, e);
    }
    for (const w of this.ctx.getWebSockets()) {
      try { w.send(JSON.stringify({ type: 'ended' })); w.close(1000, 'ended'); } catch { /* closed */ }
    }
  }
}
