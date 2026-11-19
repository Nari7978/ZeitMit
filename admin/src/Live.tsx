// Live now: who is Free now for video dates (and whether customers can see them), requests ringing on a companion's
// phone, video dates on right now and who is in the call, what starts in the next hour, and open SOS. Updates itself
// every 10 seconds; the countdowns tick every second.
import { useCallback, useEffect, useState } from 'react';
import { api, eur } from './api';
import { Avatar, ago, clock, clockS, length, mmss, type Ctx } from './shared';

type Side = 'customer' | 'companion';
type Live = {
  now: number;
  freeNow: {
    id: string; name: string; rate: number; hue: number; photoUrl: string | null; until: number; seen: number | null; bg: boolean;
    /** Shown to customers for up to this many minutes; null: hidden, and why. */
    max: number | null; hidden: 'away' | 'busy' | 'short' | null; answered: number; missed: number;
  }[];
  ringing: { id: string; instant: boolean; act: string; video: boolean; startsAt: number; minutes: number; total: number; createdAt: number; expiresAt: number; customer: string; companion: string }[];
  calls: {
    id: string; startsAt: number; endsAt: number; customer: string; companion: string; here: Record<Side, boolean>; video: boolean; together: number; joined: boolean;
    alone: { side: Side; since: number | null; pings: number } | null;
  }[];
  soon: { id: string; act: string; video: boolean; startsAt: number; endsAt: number; customer: string; companion: string; checkin: boolean }[];
  sos: { id: string; status: string; sos_at: number | null; created_at: number; name: string | null; email: string }[];
};

export function LiveNow({ say, refresh, openCall, go }: Ctx & { openCall: (id: string) => void; go: (page: 'safety') => void }) {
  const [d, setD] = useState<Live | null>(null);
  const [at, setAt] = useState(0);
  const [t, setT] = useState(() => Date.now() / 1000);
  const load = useCallback(() => {
    api<Live>('GET', '/admin/live').then((x) => { setD(x); setAt(Date.now() / 1000); }).catch((e) => say(e.message));
  }, [say]);
  useEffect(() => {
    load();
    const poll = setInterval(() => { load(); refresh(); }, 10_000);
    const tick = setInterval(() => setT(Date.now() / 1000), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [load, refresh]);
  // The server's clock, moved on by the time since it answered (so countdowns don't depend on this computer's clock).
  const now = d ? d.now + (t - at) : t;

  const cancel = async (r: Live['ringing'][number]) => {
    if (!confirm(`Cancel ${r.customer}’s request to ${r.companion} and refund ${eur(r.total)}? Both are told.`)) return;
    try { await api('POST', `/admin/bookings/${r.id}/cancel`); say('Cancelled and refunded.'); } catch (e) { say((e as Error).message); }
    load(); refresh();
  };
  const switchOff = async (f: Live['freeNow'][number]) => {
    if (!confirm(`Switch off Free now for ${f.name}? Customers can’t start a video date with them right away until they switch it on again. They’re told.`)) return;
    try { await api('POST', `/admin/companions/${f.id}/free-now/off`); say(`Free now is off for ${f.name}.`); } catch (e) { say((e as Error).message); }
    load(); refresh();
  };

  if (!d) return <><h1>Live now</h1><p className="muted">Loading…</p></>;
  const tiles: [string, number, string?][] = [
    ['Free now for video dates', d.freeNow.filter((f) => !f.hidden).length],
    [d.ringing.length === 1 ? 'Request ringing' : 'Requests ringing', d.ringing.length, d.ringing.length ? 'var(--butter)' : undefined],
    ['Video dates in progress', d.calls.length],
    ['Starting in the next hour', d.soon.length],
    ['Open SOS', d.sos.length, d.sos.length ? 'var(--red-soft)' : undefined],
  ];
  return (
    <>
      <h1>Live now</h1>
      <p className="muted small sub">Updates by itself · {clockS(at)}</p>
      <div className="grid stats">
        {tiles.map(([l, n, bg]) => (
          <div key={l} className="card stat" style={bg ? { background: bg } : undefined}><div className="n">{n}</div><div className="l">{l}</div></div>
        ))}
      </div>

      <div className="sec">
        <h2>Ringing now</h2>
        {!d.ringing.length ? <p className="muted small">Nothing is ringing right now.</p> : d.ringing.map((r) => (
          <div key={r.id} className="ring" data-testid="ringing">
            <Avatar name={r.customer} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{r.customer} → {r.companion}</div>
              <div className="small lite">
                {r.instant ? `Video date now · ${r.minutes} min` : `Short notice · ${r.act} at ${clock(r.startsAt)} · ${r.minutes} min`} · {eur(r.total)} paid · sent {clock(r.createdAt)}
              </div>
            </div>
            <div><div className="cd">{mmss(r.expiresAt - now)}</div><div className="small lite" style={{ textAlign: 'right' }}>to answer</div></div>
            <button className="btn" onClick={() => void cancel(r)}>Cancel &amp; refund</button>
          </div>
        ))}
      </div>

      <div className="sec">
        <h2>Free now <span className="count">{d.freeNow.length}</span></h2>
        <div className="card" style={{ padding: '6px 12px', overflowX: 'auto' }}>
          {!d.freeNow.length ? <p className="muted small">Nobody has Free now switched on.</p> : (
            <table>
              <thead><tr><th>Companion</th><th>On until</th><th>Phone</th><th>Today</th><th /></tr></thead>
              <tbody>{d.freeNow.map((f) => (
                <tr key={f.id} data-testid="free-now">
                  <td><div className="who"><Avatar name={f.name} url={f.photoUrl} hue={f.hue} /><div><b>{f.name}</b><div className="small muted">{eur(f.rate * 100)} / hour</div></div></div></td>
                  <td>{clock(f.until)}</td>
                  <td><Reach f={f} now={now} /></td>
                  <td className="small">{f.answered} answered · {f.missed ? <b style={{ color: 'var(--red)' }}>{f.missed} missed</b> : '0 missed'}</td>
                  <td><button className="btn" onClick={() => void switchOff(f)}>Switch off</button></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>

      <div className="two sec">
        <div>
          <h2>Video dates in progress <span className="count">{d.calls.length}</span></h2>
          <div className="card" style={{ display: 'grid', gap: 12 }}>
            {!d.calls.length ? <p className="muted small" style={{ margin: 0 }}>No video date is on right now.</p> : d.calls.map((x, i) => (
              <div key={x.id} style={{ display: 'grid', gap: 6, borderTop: i ? '1px solid var(--hair)' : undefined, paddingTop: i ? 12 : 0 }} data-testid="call">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <b>{x.companion} &amp; {x.customer}</b>
                    <div className="small muted">
                      {clock(x.startsAt)}–{clock(x.endsAt)} · {now < x.startsAt ? `starts in ${length(x.startsAt - now)}` : `${length(x.endsAt - now)} left`}
                    </div>
                  </div>
                  <CallState x={x} now={now} />
                </div>
                <button className="link" style={{ justifySelf: 'start' }} onClick={() => openCall(x.id)}>Call log →</button>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h2>Starting in the next hour <span className="count">{d.soon.length}</span></h2>
          <div className="card" style={{ padding: '6px 12px' }}>
            {!d.soon.length ? <p className="muted small">Nothing starts in the next hour.</p> : (
              <table><tbody>{d.soon.map((x) => (
                <tr key={x.id}>
                  <td style={{ width: 56 }}><b>{clock(x.startsAt)}</b></td>
                  <td>{x.companion} &amp; {x.customer} · {x.act}</td>
                  <td className="small muted">{x.video ? length(x.endsAt - x.startsAt) : `In person · ${x.checkin ? 'check-in on' : 'no check-in yet'}`}</td>
                </tr>
              ))}</tbody></table>
            )}
          </div>
        </div>
      </div>

      <div className="sec">
        <h2>Safety right now</h2>
        {!d.sos.length ? (
          <div className="card row" style={{ gap: 12 }}>
            <span className="chip ok">✓ Nothing open</span>
            <span className="small muted">No SOS, no missed check-ins. You’d also get an email and a push the moment one comes in.</span>
          </div>
        ) : (
          <div className="card" style={{ display: 'grid', gap: 8 }}>
            {d.sos.map((k) => (
              <div key={k.id} className="row">
                <span className="chip bad"><span className="dot r" />{k.status === 'sos' ? 'SOS' : 'Missed check-in'}</span>
                <b>{k.name || k.email}</b><span className="small muted">{k.email} · {ago(k.sos_at ?? k.created_at, now)}</span>
              </div>
            ))}
            <button className="link" style={{ justifySelf: 'start' }} onClick={() => go('safety')}>Open Reports &amp; safety →</button>
          </div>
        )}
      </div>
    </>
  );
}

/** Whether a Free now companion can be reached, as their phone last told us. */
function Reach({ f, now }: { f: Live['freeNow'][number]; now: number }) {
  const seen = f.seen ? ago(f.seen, now) : 'never';
  if (f.hidden === 'away') return <span className="chip bad"><span className="dot r" />Not reached for {f.seen ? length(now - f.seen) : 'a while'} · hidden from customers</span>;
  if (f.hidden === 'busy') return <span className="chip warn"><span className="dot a" />Busy: in a video date or answering a request</span>;
  if (f.hidden === 'short') return <span className="chip warn"><span className="dot a" />Too little time before the next booking · hidden</span>;
  return f.bg
    ? <span className="chip warn"><span className="dot a" />App closed · rings in the background · {seen}</span>
    : <span className="chip ok"><span className="dot g" />App open · checked in {seen}</span>;
}

/** Who is in a video date's call right now. */
function CallState({ x, now }: { x: Live['calls'][number]; now: number }) {
  if (x.here.customer && x.here.companion) {
    return x.video
      ? <span className="chip ok"><span className="dot g" />Both in the call · {length(x.together)} together</span>
      : <span className="chip warn"><span className="dot a" />Both in the call · video not connected</span>;
  }
  if (x.alone) {
    const who = x.alone.side === 'customer' ? x.customer : x.companion;
    return (
      <span className="chip warn">
        <span className="dot a" />{who} waiting alone{x.alone.since ? ` · ${mmss(now - x.alone.since)}` : ''}{x.alone.pings ? ` · pinged ${x.alone.pings}×` : ''}
      </span>
    );
  }
  return <span className="chip"><span className="dot x" />{x.joined ? 'Nobody in the call right now' : 'Nobody in the call yet'}</span>;
}
