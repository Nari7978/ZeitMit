// Incoming video date calls: the other person is waiting in the call (they joined alone, or pinged you from it). The
// server rings over the live socket and by push; while the app is open, RingBanner shows the call over any screen.
import { create } from 'zustand';

/** Who's waiting, in which video date, when the server rang (`at`, unix) and until when the banner shows. */
export type Ring = { bookingId: string; who: string; why: 'join' | 'ping'; at: number; until: number };

/** A ring shows this long, like a phone ringing; the next ping shows it again. */
export const RING_SHOW_S = 30;

type RingState = { ring: Ring | null; inCall: string | null };
export const useRing = create<RingState>(() => ({ ring: null, inCall: null }));

/**
 * Per video date, the newest ring already answered, dismissed or called off (server time). The same ring comes by live
 * event and by push: once it's dealt with on one, the other doesn't bring it back.
 */
const settled = new Map<string, number>();

/** Shows a ring from a live event or a push (left out while you're in that call already, or once it's settled). */
export function showRing(r: Record<string, unknown>) {
  const bookingId = typeof r.bookingId === 'string' ? r.bookingId : '';
  const at = typeof r.at === 'number' ? r.at : Math.floor(Date.now() / 1000);
  if (!bookingId || useRing.getState().inCall === bookingId || at <= (settled.get(bookingId) ?? 0)) return;
  const cur = useRing.getState().ring;
  if (cur && cur.bookingId === bookingId && cur.at >= at) return; // the same ring again, from the other channel
  const until = Math.min(Date.now() / 1000 + RING_SHOW_S, typeof r.endsAt === 'number' ? r.endsAt : Infinity);
  if (until <= Date.now() / 1000) return;
  useRing.setState({ ring: { bookingId, who: typeof r.who === 'string' && r.who ? r.who : 'Someone', why: r.why === 'ping' ? 'ping' : 'join', at, until } });
}

/**
 * Stops the ring: answered, dismissed, timed out, or called off (`bookingId`: only that call's; `at`: rings up to then
 * are over, even ones still on their way).
 */
export function endRing(bookingId?: string, at?: number) {
  const cur = useRing.getState().ring;
  const id = bookingId ?? cur?.bookingId;
  if (!id) return;
  settled.set(id, Math.max(settled.get(id) ?? 0, at ?? 0, cur?.bookingId === id ? cur.at : 0));
  if (cur?.bookingId === id) useRing.setState({ ring: null });
}

/** The video date open on this phone (its rings are left out), or null when none is. */
export function setInCall(bookingId: string | null) {
  useRing.setState({ inCall: bookingId });
  if (bookingId) endRing(bookingId);
}
