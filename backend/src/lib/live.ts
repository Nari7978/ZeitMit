// Live updates over WebSockets. Uses the chat Durable Object class with its own room names:
//   slots:<companionId>  a companion's open times, for everyone on their profile or booking them
//   user:<userId>        "something changed for you", so open apps refresh at once instead of waiting
import type { Env } from '../types';
import { slotsFor } from './companions';

type Ctx = { waitUntil(p: Promise<unknown>): void };

const room = (env: Env, name: string) => env.CHAT.get(env.CHAT.idFromName(name));

/** Sends an event to every socket in a room. Never throws: live updates are a bonus, the data is in D1. */
export function broadcast(env: Env, name: string, event: object, ctx?: Ctx) {
  const send = room(env, name).fetch('https://live/broadcast', { method: 'POST', body: JSON.stringify(event) }).then(() => undefined, () => undefined);
  if (ctx) ctx.waitUntil(send);
  return send;
}

/** Pushes a companion's current open times to everyone looking at them (after a booking, cancellation or availability change). */
export function slotsChanged(env: Env, companionId: string, ctx?: Ctx) {
  const send = slotsFor(env, companionId).then((slots) => broadcast(env, `slots:${companionId}`, { type: 'slots', slots }), () => undefined);
  if (ctx) ctx.waitUntil(send);
  return send;
}

/** Tells a person's open apps to reload (`go` says what changed, as in notifications). */
export const userChanged = (env: Env, userId: string, go: string, ctx?: Ctx) => broadcast(env, `user:${userId}`, { type: 'changed', go }, ctx);

/** Hands a WebSocket upgrade to a room. Rooms only send; the caller has checked who may listen. */
export function joinRoom(env: Env, name: string, userId: string, req: Request) {
  const url = new URL('https://live/ws');
  url.searchParams.set('uid', userId);
  url.searchParams.set('kind', 'live');
  return room(env, name).fetch(url.toString(), req);
}
