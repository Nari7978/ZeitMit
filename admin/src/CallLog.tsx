// One video date's call: the booking and the money, who was in the call when (and which stretches weren't paid), why
// it was settled like that, and what happened, from the call room's own log. Refund the customer in full, or pay the
// companion in full when the missing minutes weren't their fault. Updates itself while the video date is on.
import { useCallback, useEffect, useState } from 'react';
import { api, eur } from './api';
import { clock, day, length, type Ctx } from './shared';

type Bar = { from: number; to: number };
type Call = {
  booking: {
    id: string; status: string; payStatus: 'held' | 'released' | 'refunded'; instant: boolean; startsAt: number; endsAt: number; minutes: number;
    createdAt: number; decidedAt: number | null; settledAt: number | null; cancelNote: string | null;
    customer: { id: string; name: string; first: string; email: string; verified: boolean };
    companion: { id: string; name: string; email: string };
  };
  money: { total: number; fee: number; share: number; refunded: number; paid: number; earned: number; topup: number; billedMinutes: number | null; held: boolean };
  now: { here: { customer: boolean; companion: boolean }; video: boolean } | null;
  axis: Bar;
  bars: { customer: Bar[]; companion: Bar[] };
  unpaid: Bar[];
  together: number;
  why: string[];
  timeline: { t: number; text: string; tone?: 'ok' | 'warn' }[];
  reports: number; concerns: number;
  canPayInFull: boolean; canRefund: boolean;
};

const STATUS: Record<string, string> = { pending: 'pending', confirmed: 'confirmed', completed: 'completed', rejected: 'declined', expired: 'expired', conflicted: 'conflicted', cancelled: 'cancelled' };

/** Tick marks for the timeline: every 5, 10, 15, 30 or 60 minutes, so there are about five. */
function ticks(a: number, b: number) {
  const step = [300, 600, 900, 1800, 3600, 7200].find((s) => (b - a) / s <= 6) ?? 7200;
  const out: number[] = [];
  for (let x = Math.ceil(a / step) * step; x <= b; x += step) out.push(x);
  return out;
}

export function CallLog({ id, back, backLabel, say, refresh }: Ctx & { id: string; back: () => void; backLabel: string }) {
  const [d, setD] = useState<Call | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Call>('GET', `/admin/bookings/${id}/call`).then((x) => { setD(x); setErr(null); }).catch((e) => setErr(e.message));
  }, [id]);
  useEffect(load, [load]);
  // While it's on (or about to settle), it updates itself.
  const live = !!d && d.booking.payStatus === 'held' && d.booking.status === 'confirmed';
  useEffect(() => {
    if (!live) return;
    const poll = setInterval(load, 10_000);
    return () => clearInterval(poll);
  }, [live, load]);

  const crumb = <div className="crumb"><button onClick={back}>{backLabel}</button> › {id}</div>;
  if (err) return <>{crumb}<h1>Video date</h1><div className="err">{err}</div></>;
  if (!d) return <>{crumb}<h1>Video date</h1><p className="muted">Loading…</p></>;
  const b = d.booking, m = d.money;
  const C = b.customer.first, P = b.companion.name;
  const missing = m.share - m.earned;

  const refund = async () => {
    if (!confirm(`Refund ${C} in full (${eur(m.paid)} they still paid)? ${m.earned ? `${eur(m.earned)} comes off ${P}’s earnings. ` : ''}Both are told.`)) return;
    try { await api('POST', `/admin/bookings/${b.id}/refund`); say('Refunded in full.'); } catch (e) { say((e as Error).message); }
    load(); refresh();
  };
  const payInFull = async () => {
    if (!confirm(`Pay ${P} the missing ${eur(missing)}, so they get the full ${eur(m.share)}? ZeitMit pays it; ${C} keeps their refund. ${P} is told.`)) return;
    try { await api('POST', `/admin/bookings/${b.id}/pay-in-full`); say(`${P} is paid in full.`); } catch (e) { say((e as Error).message); }
    load(); refresh();
  };

  const span = d.axis.to - d.axis.from || 1;
  const pct = (t: number) => `${((Math.min(Math.max(t, d.axis.from), d.axis.to) - d.axis.from) / span) * 100}%`;
  const seg = (x: Bar, color: string, cls = 'seg') => <div key={`${x.from}-${x.to}`} className={cls} style={{ left: pct(x.from), width: `calc(${pct(x.to)} - ${pct(x.from)})`, background: color || undefined }} />;
  const nowAt = Date.now() / 1000;
  const marks = ticks(d.axis.from, d.axis.to);
  const anyone = d.bars.customer.length + d.bars.companion.length > 0;
  const pay = b.payStatus === 'held' ? 'payment held' : b.payStatus === 'refunded' ? (m.refunded >= m.total ? 'refunded in full' : 'refunded but the fee') : m.billedMinutes !== null && !m.topup ? 'paid in part' : 'paid in full';

  return (
    <>
      {crumb}
      <h1>Video date · {P} &amp; {C}</h1>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)' }}>
        <div className="card">
          <div className="lbl">Booking</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{day(b.startsAt)} · {clock(b.startsAt)}–{clock(b.endsAt)} · {b.minutes} min booked</div>
          <div className="small muted" style={{ marginTop: 4 }}>
            {b.instant ? 'Video date now' : 'Booked'} by {b.customer.name} ({b.customer.verified ? 'ID verified' : 'ID not verified'}, {b.customer.email})
            {b.decidedAt && b.status !== 'pending' ? ` · ${b.status === 'rejected' || b.status === 'expired' ? 'closed' : `accepted by ${P}`} at ${clock(b.decidedAt)}${day(b.decidedAt) !== day(b.startsAt) ? ` on ${day(b.decidedAt)}` : ''}` : ''}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <span className={`status s-${b.status}`}>{STATUS[b.status] ?? b.status} · {pay}</span>
            {d.reports || d.concerns
              ? <span className="chip bad">{d.reports ? `${d.reports} report${d.reports === 1 ? '' : 's'} between them` : ''}{d.reports && d.concerns ? ' · ' : ''}{d.concerns ? 'safety concern after this date' : ''}</span>
              : <span className="chip info">No reports or concerns</span>}
          </div>
        </div>
        <div className="card">
          <div className="lbl">Money</div>
          <div className="kv"><span>{C} paid</span><b>{eur(m.total)}</b></div>
          {m.held ? <div className="kv"><span>Held until the booked end</span><b>{eur(m.total)}</b></div> : (
            <>
              <div className="kv"><span>{P} earned{m.billedMinutes !== null ? ` · ${m.billedMinutes} of ${b.minutes} min` : ''}{m.topup ? ` + ${eur(m.topup)} from ZeitMit` : ''}</span><b>{eur(m.earned)}</b></div>
              <div className="kv"><span>Back to {C}</span><b>{eur(m.refunded)}</b></div>
            </>
          )}
          <div className="kv"><span className="muted">ZeitMit’s fee</span><span className="muted">{m.refunded >= m.total ? '€0 (refunded)' : eur(m.fee)}</span></div>
        </div>
      </div>

      <div className="card sec">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="lbl" style={{ margin: 0 }}>Who was in the call</div>
          <span className="small muted">Together with video <b style={{ color: 'var(--ink)' }}>{length(d.together)}</b></span>
        </div>
        {d.now ? (
          <p className="small" style={{ margin: '8px 0 0' }}>
            <b>Right now:</b> {d.now.here.customer && d.now.here.companion ? `both in the call${d.now.video ? ', video connected' : ', video not connected'}` : d.now.here.customer ? `${C} is waiting for ${P}` : d.now.here.companion ? `${P} is waiting for ${C}` : 'nobody is in the call'}
          </p>
        ) : null}
        {!anyone ? <p className="muted small">{nowAt < b.startsAt - 600 ? 'The call opens 10 minutes before the start.' : 'Nobody joined the call.'}</p> : (
          <div style={{ marginTop: 8 }}>
            <div className="lane"><span>{P} <span className="muted small">(companion)</span></span><div className="bar">{d.bars.companion.map((x) => seg(x, 'var(--mint)'))}{live ? <div className="now-line" style={{ left: pct(nowAt) }} /> : null}</div></div>
            <div className="lane"><span>{C} <span className="muted small">(customer)</span></span><div className="bar">{d.bars.customer.map((x) => seg(x, 'var(--lilac)'))}{live ? <div className="now-line" style={{ left: pct(nowAt) }} /> : null}</div></div>
            {d.unpaid.length ? <div className="lane"><span className="muted small">Not paid</span><div className="bar thin">{d.unpaid.map((x) => seg(x, '', 'seg unpaid'))}</div></div> : null}
            <div className="ticks"><span /><div className="t">
              {marks.map((x) => <span key={x} style={{ left: pct(x) }}>{clock(x)}{x === b.startsAt ? ' · start' : x === b.endsAt ? ' · end' : ''}</span>)}
            </div></div>
            <div className="legend">
              <span><span className="sw" style={{ background: 'var(--mint)' }} />{P} in the call</span>
              <span><span className="sw" style={{ background: 'var(--lilac)' }} />{C} in the call</span>
              <span><span className="sw" style={{ background: 'repeating-linear-gradient(45deg,#f3f0e0,#f3f0e0 3px,#ece8d4 3px,#ece8d4 6px)' }} />Not in the call</span>
              {d.unpaid.length ? <span><span className="sw" style={{ background: 'var(--red)' }} />Not paid to {P}</span> : null}
            </div>
          </div>
        )}
      </div>

      <div className="two sec">
        <div className="card">
          <div className="lbl">Why it was settled like this</div>
          {d.why.length ? <ul className="why">{d.why.map((w) => <li key={w}>{w}</li>)}</ul> : <p className="muted small">Nothing to explain yet.</p>}
          {d.canRefund || d.canPayInFull ? (
            <>
              <div className="row" style={{ marginTop: 14 }}>
                {d.canRefund ? <button className="btn red" onClick={() => void refund()}>Refund {C} in full</button> : null}
                {d.canPayInFull ? <button className="btn" onClick={() => void payInFull()}>Pay {P} in full</button> : null}
              </div>
              <div className="small muted" style={{ marginTop: 8 }}>
                {d.canPayInFull ? `Pay in full: ZeitMit pays ${P} the missing ${eur(missing)}; ${C} keeps the refund. ` : ''}Whoever it affects is told, with the amount.
              </div>
            </>
          ) : null}
        </div>
        <div className="card" style={{ padding: '6px 12px' }}>
          {!d.timeline.length ? <p className="muted small">Nothing happened in the call.</p> : (
            <table>
              <thead><tr><th style={{ width: 60 }}>Time</th><th>What happened</th></tr></thead>
              <tbody>{d.timeline.map((l, i) => (
                <tr key={i}>
                  <td>{clock(l.t)}</td>
                  <td>{l.tone ? <span className={`chip ${l.tone}`}>{l.text}</span> : l.text}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
