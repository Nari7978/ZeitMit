// A video date's call in plain words, for the admin panel: when each side was in the call, which stretches the
// companion isn't paid for and why (the rules in lib/videoDate.ts), and what happened: joins, rings, pings, video,
// hang-ups, drops. Pure functions, checked by scripts/engine-check.ts; the call room keeps the logs (calls.ts).
import { unpaidTime, type Presence, type Side } from './videoDate';

/** Something else that happened in the call: rings and pings (by the one waiting), video on/off, hang-ups, drops. */
export type CallEvent = { t: number; s: Side; e: 'ring' | 'ping' | 'video' | 'no-video' | 'bye' | 'drop' };
export type Bar = { from: number; to: number };
export type Line = { t: number; text: string; tone?: 'ok' | 'warn' };
type Names = Record<Side, string>;

/** Stretches shorter than this aren't worth a sentence (a reconnect, a blip). */
const MIN_S = 30;
const SIDES: Side[] = ['customer', 'companion'];

/** In time order; things noted in the same second keep the order they were noted in. */
const inOrder = <T extends { t: number }>(xs: T[]) => xs.map((x, i) => ({ x, i })).sort((a, b) => a.x.t - b.x.t || a.i - b.i).map((y) => y.x);
const minutesOf = (s: number) => Math.max(1, Math.round(s / 60));
const mins = (s: number) => `${minutesOf(s)} minute${minutesOf(s) === 1 ? '' : 's'}`;
const notPaid = (s: number) => `${mins(s)} ${minutesOf(s) === 1 ? 'isn’t' : 'aren’t'} paid`;

/** When each side was in the call, cut to `from`–`to` (someone still in the call runs to `to`). */
export function presenceBars(log: Presence[], from: number, to: number): Record<Side, Bar[]> {
  const out: Record<Side, Bar[]> = { customer: [], companion: [] };
  const open: Partial<Record<Side, number>> = {};
  const add = (s: Side, a: number, b: number) => {
    const x = Math.max(a, from), y = Math.min(b, to);
    if (y > x) out[s].push({ from: x, to: y });
  };
  for (const e of inOrder(log)) {
    if (e.on) open[e.s] ??= e.t;
    else if (open[e.s] !== undefined) { add(e.s, open[e.s]!, e.t); delete open[e.s]; }
  }
  for (const s of SIDES) if (open[s] !== undefined) add(s, open[s]!, to);
  return out;
}

/**
 * Why the companion is paid what they are, in plain sentences: each stretch of the booked time (up to now, while it's
 * on) when they weren't both in the call, 30 seconds or longer, with whose absence it was and whether it's paid. Also
 * the stretches that aren't paid, for the timeline.
 */
export function explainCall(x: {
  log: Presence[]; events: CallEvent[]; start: number; end: number; wait: number; now: number; names: Names; clock: (t: number) => string;
}) {
  const until = Math.min(x.end, x.now);
  if (until <= x.start || !x.log.length) return { why: [] as string[], unpaid: [] as Bar[] };
  const u = unpaidTime(x.log, x.start, until, x.wait);
  const { clock } = x;
  const C = x.names.customer, P = x.names.companion;
  const name = (s: Side) => x.names[s];
  const log = inOrder(x.log);
  /** When this side last left the call, at or before `t` (null: they hadn't been in it yet). */
  const leftAt = (s: Side, t: number) => {
    let last: number | null = null;
    for (const e of log) if (e.s === s && e.t <= t) last = e.on ? null : e.t;
    return last;
  };
  const joinedBy = (s: Side, t: number) => log.some((e) => e.s === s && e.on && e.t <= t);
  /** How they left: hung up, the connection dropped, or just gone (older calls didn't note which). */
  const howLeft = (s: Side, t: number) => {
    const ev = x.events.find((e) => e.s === s && (e.e === 'bye' || e.e === 'drop') && Math.abs(e.t - t) <= 2);
    return ev?.e === 'bye' ? `${name(s)} hung up` : ev?.e === 'drop' ? `${name(s)}’s connection dropped` : `${name(s)} left the call`;
  };

  const why: string[] = [];
  u.spans.forEach((sp, i) => {
    if (sp.customer && sp.companion) return;
    const d = sp.to - sp.from;
    if (d < MIN_S) return;
    const next = u.spans[i + 1];
    const range = `${clock(sp.from)}–${clock(sp.to)}`;
    const ongoing = sp.to === until && until < x.end;
    const toEnd = sp.to === x.end;

    if (!sp.customer && !sp.companion) {
      if (ongoing) return void why.push(`Right now nobody is in the call (since ${clock(sp.from)}).`);
      if (!joinedBy('customer', sp.from) && !joinedBy('companion', sp.from)) return void why.push(`Nobody was in the call for the first ${mins(d)} (${range}).`);
      const c = leftAt('customer', sp.from), p = leftAt('companion', sp.from);
      const cause = sp.unpaid
        ? (p === null ? `${P} hadn’t come` : c === null || p <= c ? `${P} left first` : `${C} had waited ${mins(x.wait)} for ${P}`)
        : (c === null ? `${C} hadn’t come` : p === null || c <= p ? `${C} left first` : `${P} had waited ${mins(x.wait)} for ${C}`);
      return void why.push(`Neither was in the call for ${mins(d)} (${range}): ${sp.unpaid ? 'not paid' : 'paid'}, as ${cause}.`);
    }

    const here: Side = sp.customer ? 'customer' : 'companion';
    const away: Side = sp.customer ? 'companion' : 'customer';
    const H = name(here), A = name(away);
    const back = !!next?.[away];
    const gone = leftAt(away, sp.from);

    if (here === 'customer' && !sp.unpaid) {
      // The companion had waited long enough for the customer before: covered.
      return void why.push(`${C} was in the call alone for ${mins(d)} (${range}), after ${P} had waited ${mins(x.wait)} for them: still paid.`);
    }
    if (here === 'companion' && sp.unpaid) {
      // The customer had waited long enough for the companion and gone: the companion coming afterwards isn't paid.
      return void why.push(`${C} had waited ${mins(x.wait)} for ${P} and left. ${P} was in the call alone afterwards for ${mins(d)} (${range}): not paid.`);
    }
    const paid = here === 'companion';
    const verdict = paid ? 'paid' : 'not paid';
    if (gone === null) {
      // The other one hadn't come yet.
      if (ongoing) return void why.push(`${H} has been waiting for ${A} since ${clock(sp.from)}: ${paid ? 'paid' : 'not paid while ' + P + ' isn’t there'}.`);
      if (back) {
        return void why.push(paid
          ? `${C} came ${mins(sp.to - x.start)} late (${clock(sp.to)}). ${P} was there and waited, so that time is paid.`
          : `${P} came ${mins(sp.to - x.start)} late (${clock(sp.to)}). ${C} was waiting in the call, so ${notPaid(d)}.`);
      }
      return void why.push(`${H} waited ${mins(d)} in the call (${range}), but ${A} didn’t come: ${verdict}.`);
    }
    const left = `${howLeft(away, gone)} at ${clock(gone)}`;
    if (ongoing) return void why.push(`${left} and isn’t back yet. ${H} is in the call: ${paid ? 'paid' : 'not paid while ' + P + ' isn’t there'}.`);
    if (back) return void why.push(`${left} and was back at ${clock(sp.to)}. ${H} was in the call meanwhile, so ${paid ? 'that time is paid' : notPaid(d)}.`);
    if (toEnd) return void why.push(`${left}, ${mins(x.end - gone)} before the end, while ${H} stayed: ${paid ? 'still paid' : notPaid(d)}.`);
    return void why.push(`${left}. ${H} was in the call without them for ${mins(d)} (${range}): ${verdict}.`);
  });
  if (until === x.end && u.customerAtEnd && u.companionAtEnd) why.push(`Both were in the call at the booked end (${clock(x.end)}).`);
  return { why, unpaid: u.spans.filter((s) => s.unpaid).map(({ from, to }) => ({ from, to })) };
}

/**
 * What happened in the call, in order, one line each: who joined, came back, hung up or dropped out, rings and pings,
 * and when the video between the phones connected or was lost. Lines within 5 seconds of each other are joined.
 */
export function callTimeline(log: Presence[], events: CallEvent[], names: Names, pingMax: number): Line[] {
  type Item = { t: number; s: Side; k: 'in' | 'out' | CallEvent['e'] };
  const items = inOrder<Item>([...log.map((e) => ({ t: e.t, s: e.s, k: e.on ? 'in' as const : 'out' as const })), ...events.map((e) => ({ t: e.t, s: e.s, k: e.e }))]);
  const other = (s: Side): Side => (s === 'customer' ? 'companion' : 'customer');
  const seen: Partial<Record<Side, boolean>> = {};
  const media: Record<Side, boolean> = { customer: false, companion: false };
  const pings: Record<Side, number> = { customer: 0, companion: 0 };
  const used = new Set<Item>();
  const lines: Line[] = [];
  for (const it of items) {
    const who = names[it.s];
    const before = media.customer && media.companion;
    if (it.k === 'in') {
      lines.push({ t: it.t, text: seen[it.s] ? `${who} came back` : `${who} joined` });
      seen[it.s] = true;
    } else if (it.k === 'out') {
      media[it.s] = false;
      const how = items.find((e) => !used.has(e) && e.s === it.s && (e.k === 'bye' || e.k === 'drop') && Math.abs(e.t - it.t) <= 2);
      if (how) used.add(how);
      lines.push(how?.k === 'drop' ? { t: it.t, text: `${who}’s connection dropped`, tone: 'warn' } : { t: it.t, text: how?.k === 'bye' ? `${who} hung up` : `${who} left the call` });
    } else if (it.k === 'ring') {
      lines.push({ t: it.t, text: `${names[other(it.s)]}’s phone rang` });
    } else if (it.k === 'ping') {
      lines.push({ t: it.t, text: `${who} pinged ${names[other(it.s)]} (${++pings[it.s]} of ${pingMax})` });
    } else if (it.k === 'video' || it.k === 'no-video') {
      media[it.s] = it.k === 'video';
      const now = media.customer && media.companion;
      if (now && !before) lines.push({ t: it.t, text: 'Video connected', tone: 'ok' });
      if (!now && before) lines.push({ t: it.t, text: 'Video connection lost', tone: 'warn' });
    }
  }
  // A join and the ring it sent, or a join and the video connecting: one line.
  const out: Line[] = [];
  for (const l of lines) {
    const last = out[out.length - 1];
    if (last && l.t - last.t <= 5) {
      last.text += ` · ${l.text.startsWith('Video') ? 'v' + l.text.slice(1) : l.text}`;
      if (l.tone === 'warn' || (l.tone && !last.tone)) last.tone = l.tone;
    } else out.push({ ...l });
  }
  return out;
}
