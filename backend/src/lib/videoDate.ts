// Video dates: what the companion earns when someone isn't there for the whole booked time. Pure functions (the call
// room keeps the log, bookings settle the money), so the engine check can test every case.
//
// The rule, for both sides:
// - The customer has booked the companion's time. If the customer is late, leaves early or drops out, the companion
//   is still paid in full.
// - The companion has to be there for the whole time. Any time the customer is in the call and the companion isn't
//   (late, left, dropped) isn't paid, and the customer gets it back.
// - Whoever has waited WAIT seconds for the other is covered from then on: they can leave without losing anything,
//   even if the other comes back after they've gone. If the last one in the call leaves without waiting that long,
//   the one who left first carries the time until they're together again.

export type Side = 'customer' | 'companion';
/** One side coming into the call or leaving it (a second phone taking over isn't either). */
export type Presence = { s: Side; t: number; on: boolean };

const other = (s: Side): Side => (s === 'customer' ? 'companion' : 'customer');

/**
 * Seconds of the booked time (`start` to `end`) the companion isn't paid for, how long both were in the call at the
 * same time, whether each was still there at the end, and who is covered then (has waited long enough for the other
 * and hasn't been together with them since; with `end` = now, that's what the call screen tells whoever joins).
 */
export function unpaidTime(log: Presence[], start: number, end: number, wait: number) {
  const here: Record<Side, boolean> = { customer: false, companion: false };
  /** The side that has waited `wait` for the other during this time apart. */
  let covered: Side | null = null;
  /** While neither is in the call: whose absence it is. */
  let blame: Side | null = null;
  /** When the one in the call began waiting for the other (never before the start). */
  let waitFrom: number | null = null;
  let unpaid = 0, overlap = 0, cursor = start;

  const count = (to: number) => {
    const from = cursor;
    cursor = Math.max(cursor, Math.min(to, end));
    const dt = cursor - from;
    if (dt <= 0) return;
    const c = here.customer, p = here.companion;
    if (c && p) overlap += dt;
    else if (c) { if (covered !== 'companion') unpaid += dt; } // the customer waits for the companion
    else if (p) { if (covered === 'customer') unpaid += dt; } // back only after the customer had waited long enough
    else if (blame === 'companion') unpaid += dt;
  };
  const checkWait = (t: number) => {
    const c = here.customer, p = here.companion;
    if (covered || waitFrom === null || c === p) return;
    if (Math.min(t, end) - waitFrom >= wait) covered = c ? 'customer' : 'companion';
  };

  const events = log.map((e, i) => ({ ...e, i })).filter((e) => e.t < end).sort((a, b) => a.t - b.t || a.i - b.i);
  for (const e of events) {
    count(e.t);
    checkWait(e.t);
    const was = here[e.s];
    here[e.s] = e.on;
    if (was === e.on) continue;
    const o = other(e.s);
    if (here.customer && here.companion) {
      // Together again: nothing is held against anyone.
      covered = null; blame = null; waitFrom = null;
    } else if (e.on) {
      // In the call alone: waiting for the other (from the start at the earliest).
      waitFrom = Math.max(e.t, start);
    } else if (here[o]) {
      // Left the other waiting.
      waitFrom = Math.max(e.t, start);
    } else {
      // The last one in the call left: whoever waited long enough is covered; otherwise the one who left first.
      blame = covered ? other(covered) : o;
      waitFrom = null;
    }
  }
  count(end);
  checkWait(end);
  return { unpaid, overlap, customerAtEnd: here.customer, companionAtEnd: here.companion, covered };
}

/** What the companion earns (cents, never more than the booking's share) for the booked time minus the unpaid time. */
export function earned(subtotal: number, bookedSeconds: number, unpaidSeconds: number) {
  if (bookedSeconds <= 0) return 0;
  const paid = Math.max(0, Math.min(bookedSeconds, bookedSeconds - unpaidSeconds));
  return Math.min(subtotal, Math.round((subtotal * paid) / bookedSeconds));
}
