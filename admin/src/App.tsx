import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, eur, photoSrc, session, when } from './api';

type Page = 'overview' | 'ids' | 'companions' | 'bookings' | 'safety' | 'users';
type Stats = { users: number; companions: number; pendingCompanions: number; bookings: number; heldCents: number; openReports: number; sos: number; pendingIds: number };

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function App() {
  const [token, setToken] = useState(session.get());
  const [page, setPage] = useState<Page>('overview');
  const [stats, setStats] = useState<Stats | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const say = useCallback((m: string) => {
    clearTimeout(toastTimer);
    setToast(m);
    toastTimer = setTimeout(() => setToast(null), 3000);
  }, []);
  const loadStats = useCallback(() => {
    api<Stats>('GET', '/admin/stats').then(setStats).catch((e) => { say(e.message); if (!session.get()) setToken(null); });
  }, [say]);
  useEffect(() => { if (token) loadStats(); }, [token, loadStats]);

  if (!token) return <Login onIn={(t) => { session.set(t); setToken(t); }} />;

  const nav: [Page, string, number?][] = [
    ['overview', 'Overview'],
    ['ids', 'ID checks', stats?.pendingIds],
    ['companions', 'Companion reviews', stats?.pendingCompanions],
    ['bookings', 'Bookings & payments'],
    ['safety', 'Reports & safety', (stats?.openReports ?? 0) + (stats?.sos ?? 0)],
    ['users', 'Users'],
  ];
  const ctx = { say, refresh: loadStats };
  return (
    <div className="shell">
      <nav className="side">
        <div className="logo display">zeitmit<span>!</span> admin</div>
        {nav.map(([k, l, n]) => (
          <button key={k} className={page === k ? 'on' : ''} onClick={() => setPage(k)}>
            {l}
            {n ? <span className="badge">{n}</span> : null}
          </button>
        ))}
        <div className="foot">
          <span>Changes apply immediately.</span>
          <button onClick={() => { session.set(null); setToken(null); }}>Log out</button>
        </div>
      </nav>
      <main className="main">
        {page === 'overview' && <Overview stats={stats} go={setPage} />}
        {page === 'ids' && <IdChecks {...ctx} />}
        {page === 'companions' && <Companions {...ctx} />}
        {page === 'bookings' && <Bookings {...ctx} />}
        {page === 'safety' && <Safety {...ctx} />}
        {page === 'users' && <Users {...ctx} />}
      </main>
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}

type Ctx = { say: (m: string) => void; refresh: () => void };

function Login({ onIn }: { onIn: (token: string) => void }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <form className="card" onSubmit={(e) => {
        e.preventDefault();
        if (step === 'email') void run(async () => { await api('POST', '/auth/request-code', { email }); setStep('code'); });
        else void run(async () => {
          const r = await api<{ token: string; user: { role: string } }>('POST', '/auth/verify', { email, code });
          if (r.user.role !== 'admin') throw new Error('This account isn’t an admin. Admin emails are set in backend/wrangler.toml (ADMIN_EMAILS), and admin login needs real email login (not test mode).');
          onIn(r.token);
        });
      }}>
        <h1 className="display" style={{ fontSize: 30 }}>zeitmit<span style={{ color: 'var(--pink)' }}>!</span> admin</h1>
        {step === 'email' ? (
          <>
            <label className="small" htmlFor="email">Admin email</label>
            <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </>
        ) : (
          <>
            <label className="small" htmlFor="code">6-digit code sent to {email}</label>
            <input id="code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} required />
          </>
        )}
        {err ? <div className="err">{err}</div> : null}
        <button className="btn dark" disabled={busy}>{busy ? 'Please wait…' : step === 'email' ? 'Send code' : 'Log in'}</button>
      </form>
    </div>
  );
}

function Overview({ stats, go }: { stats: Stats | null; go: (p: Page) => void }) {
  const tiles: [string, ReactNode, Page][] = stats ? [
    ['ID checks waiting', stats.pendingIds, 'ids'],
    ['Companions waiting for review', stats.pendingCompanions, 'companions'],
    ['Open reports', stats.openReports, 'safety'],
    ['SOS / missed check-ins', stats.sos, 'safety'],
    ['Money held now', eur(stats.heldCents), 'bookings'],
    ['Bookings', stats.bookings, 'bookings'],
    ['Live companions', stats.companions, 'companions'],
    ['Users', stats.users, 'users'],
  ] : [];
  return (
    <>
      <h1>Overview</h1>
      {!stats ? <p className="muted">Loading…</p> : (
        <div className="grid stats">
          {tiles.map(([l, n, p]) => (
            <button key={l} className="card stat" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => go(p)}>
              <div className="n">{n}</div>
              <div className="l">{l}</div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

type IdCheck = { id: string; email: string; name: string; status: string; submittedAt: number | null; note: string | null; idPhotoUrl: string | null; selfieUrl: string | null };

function IdChecks({ say, refresh }: Ctx) {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [list, setList] = useState<IdCheck[] | null>(null);
  const load = useCallback(() => { setList(null); api<IdCheck[]>('GET', `/admin/verifications?status=${status}`).then(setList).catch((e) => say(e.message)); }, [status, say]);
  useEffect(load, [load]);
  const decide = async (u: IdCheck, d: 'approve' | 'reject') => {
    let reason: string | undefined;
    if (d === 'reject') {
      const r = prompt(`Why can’t ${u.email} be verified? They’ll see this message.`, 'The photos weren’t clear enough to verify you.');
      if (r === null) return;
      reason = r;
    }
    try {
      await api('POST', `/admin/verifications/${u.id}/${d}`, { reason });
      say(d === 'approve' ? `${u.email} can book now. Photos deleted.` : `${u.email} rejected. Photos deleted.`);
      load(); refresh();
    } catch (e) { say((e as Error).message); }
  };
  return (
    <>
      <h1>ID checks</h1>
      <p className="muted">Customers verify once before their first booking. Approved companions are verified automatically.</p>
      <div className="tabs">
        {(['pending', 'approved', 'rejected'] as const).map((s) => <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{s[0].toUpperCase() + s.slice(1)}</button>)}
      </div>
      {!list ? <p className="muted">Loading…</p> : !list.length ? <p className="muted">Nothing here.</p> : (
        <div className="grid">
          {list.map((u) => (
            <div key={u.id} className="card" style={{ display: 'grid', gap: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2 style={{ fontSize: 22 }}>{u.name || '—'}</h2>
                <span className="muted small">{u.email}{u.submittedAt ? ` · sent ${when(u.submittedAt)}` : ''}</span>
              </div>
              {status === 'pending' ? (
                <>
                  <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    {([['ID document', u.idPhotoUrl], ['Selfie with ID', u.selfieUrl]] as const).map(([l, url]) => (
                      <div key={l} style={{ display: 'grid', gap: 4 }}>
                        <div className="small" style={{ fontWeight: 700 }}>{l}</div>
                        {url ? <a href={photoSrc(url, true)} target="_blank" rel="noreferrer"><img className="idphoto" src={photoSrc(url, true)} alt={l} /></a> : <div className="err">Missing</div>}
                      </div>
                    ))}
                  </div>
                  <div className="small muted">Check: the ID looks genuine, the person is 18+, the face in the selfie matches the ID, and the name matches the account. Click a photo to enlarge it. Both photos are deleted when you decide.</div>
                  <div className="row">
                    <button className="btn green" disabled={!u.idPhotoUrl || !u.selfieUrl} onClick={() => void decide(u, 'approve')}>Approve</button>
                    <button className="btn red" onClick={() => void decide(u, 'reject')}>Reject</button>
                  </div>
                </>
              ) : u.note ? <div className="small muted">Reason: {u.note}</div> : null}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

type Applicant = {
  id: string; name: string; email: string; ageValue: number | null; area: string; tagline: string; bio: string; rate: number;
  interests: string[]; langs: [string, string][]; acts: string[]; ok: string[]; photoUrl: string | null; idPhotoUrl: string | null; status: string;
  g: 'w' | 'm' | 'nb'; pron?: string;
};

function Companions({ say, refresh }: Ctx) {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [list, setList] = useState<Applicant[] | null>(null);
  const load = useCallback(() => { setList(null); api<Applicant[]>('GET', `/admin/companions?status=${status}`).then(setList).catch((e) => say(e.message)); }, [status, say]);
  useEffect(load, [load]);
  const decide = async (a: Applicant, d: 'approve' | 'reject') => {
    if (d === 'reject' && !confirm(`Reject ${a.name}? Their ID photo will be deleted.`)) return;
    try {
      await api('POST', `/admin/companions/${a.id}/${d}`);
      say(d === 'approve' ? `${a.name} is live. ID photo deleted.` : `${a.name} rejected. ID photo deleted.`);
      load(); refresh();
    } catch (e) { say((e as Error).message); }
  };
  return (
    <>
      <h1>Companion reviews</h1>
      <div className="tabs">
        {(['pending', 'approved', 'rejected'] as const).map((s) => <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{s[0].toUpperCase() + s.slice(1)}</button>)}
      </div>
      {!list ? <p className="muted">Loading…</p> : !list.length ? <p className="muted">Nothing here.</p> : (
        <div className="grid">
          {list.map((a) => (
            <div key={a.id} className="card app-card">
              {a.photoUrl ? <img className="photo" src={photoSrc(a.photoUrl)} alt={`${a.name}’s listing photo`} /> : <div className="photo">No listing photo</div>}
              <div style={{ display: 'grid', gap: 8 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h2 style={{ fontSize: 24 }}>{a.name}{a.ageValue ? `, ${a.ageValue}` : ''}</h2>
                  <span className="muted small">{a.email}</span>
                </div>
                <div className="small"><b>{eur(a.rate * 100)}/h</b> · {({ w: 'Woman', m: 'Man', nb: 'Non-binary' } as const)[a.g]}{a.pron ? ` (${a.pron})` : ''} · {a.area} · “{a.tagline}”</div>
                <div className="small" style={{ lineHeight: 1.55 }}>{a.bio}</div>
                <div>{a.acts.map((x) => <span key={x} className="pill">{x}</span>)}</div>
                <div className="small muted">Languages: {a.langs.map(([l, lv]) => `${l} (${lv})`).join(', ') || '—'} · Interests: {a.interests.join(', ') || '—'} · Boundaries: {a.ok.join(', ') || '—'}</div>
                {status === 'pending' ? (
                  <>
                    <div className="small" style={{ fontWeight: 700, marginTop: 6 }}>ID check: selfie holding ID</div>
                    {a.idPhotoUrl ? <img className="idphoto" src={photoSrc(a.idPhotoUrl, true)} alt="ID verification photo" /> : <div className="err">No ID photo uploaded.</div>}
                    <div className="small muted">Check: face matches the ID, the person is 18+, the ID looks genuine. The photo is deleted when you decide.</div>
                    <div className="row" style={{ marginTop: 6 }}>
                      <button className="btn green" disabled={!a.idPhotoUrl} onClick={() => void decide(a, 'approve')}>Approve</button>
                      <button className="btn red" onClick={() => void decide(a, 'reject')}>Reject</button>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

type BookingRow = { id: string; status: string; pay_status: string; activity: string; starts_at: number; total: number; customer: string; companion: string };

function Bookings({ say, refresh }: Ctx) {
  const [list, setList] = useState<BookingRow[] | null>(null);
  const load = useCallback(() => { api<BookingRow[]>('GET', '/admin/bookings').then(setList).catch((e) => say(e.message)); }, [say]);
  useEffect(load, [load]);
  const refund = async (b: BookingRow) => {
    if (!confirm(`Refund ${eur(b.total)} to ${b.customer} and cancel the booking?`)) return;
    try { await api('POST', `/admin/bookings/${b.id}/refund`); say('Refunded.'); load(); refresh(); } catch (e) { say((e as Error).message); }
  };
  return (
    <>
      <h1>Bookings & payments</h1>
      <div className="card" style={{ overflowX: 'auto' }}>
        {!list ? <p className="muted">Loading…</p> : (
          <table>
            <thead><tr><th>When</th><th>Customer</th><th>Companion</th><th>Activity</th><th>Status</th><th>Payment</th><th>Total</th><th /></tr></thead>
            <tbody>
              {list.map((b) => (
                <tr key={b.id}>
                  <td>{when(b.starts_at)}</td><td>{b.customer}</td><td>{b.companion}</td><td>{b.activity}</td>
                  <td><span className={`status s-${b.status}`}>{b.status}</span></td>
                  <td>{b.pay_status}</td><td>{eur(b.total)}</td>
                  <td>{b.pay_status === 'held' ? <button className="btn" onClick={() => void refund(b)}>Refund</button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

type Reports = {
  reports: { id: string; reason: string; status: string; created_at: number; reporter: string; target: string; target_id: string }[];
  flaggedMessages: { id: string; body: string; created_at: number; sender: string }[];
  sos: { id: string; status: string; email: string; contact_name: string; contact_phone: string; last_lat: number | null; last_lng: number | null; created_at: number }[];
};

function Safety({ say, refresh }: Ctx) {
  const [d, setD] = useState<Reports | null>(null);
  const load = useCallback(() => { api<Reports>('GET', '/admin/reports').then(setD).catch((e) => say(e.message)); }, [say]);
  useEffect(load, [load]);
  const resolve = async (id: string) => { try { await api('POST', `/admin/reports/${id}/resolve`); load(); refresh(); } catch (e) { say((e as Error).message); } };
  const suspend = async (id: string, email: string) => {
    if (!confirm(`Suspend ${email}? They’ll be logged out and can’t use ZeitMit.`)) return;
    try { await api('POST', `/admin/users/${id}/suspend`, { suspended: true }); say(`${email} suspended.`); } catch (e) { say((e as Error).message); }
  };
  if (!d) return <><h1>Reports & safety</h1><p className="muted">Loading…</p></>;
  return (
    <>
      <h1>Reports & safety</h1>
      <h2 style={{ fontSize: 20, margin: '6px 0 10px' }}>SOS and missed check-ins</h2>
      <div className="card" style={{ overflowX: 'auto', marginBottom: 22 }}>
        {!d.sos.length ? <p className="muted">None.</p> : (
          <table>
            <thead><tr><th>Started</th><th>User</th><th>Status</th><th>Trusted contact</th><th>Last location</th></tr></thead>
            <tbody>{d.sos.map((s) => (
              <tr key={s.id}>
                <td>{when(s.created_at)}</td><td>{s.email}</td><td><b>{s.status === 'sos' ? 'SOS' : 'Missed check-in'}</b></td>
                <td>{s.contact_name} · <a href={`tel:${s.contact_phone}`}>{s.contact_phone}</a></td>
                <td>{s.last_lat != null ? <a target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${s.last_lat}&mlon=${s.last_lng}#map=17/${s.last_lat}/${s.last_lng}`}>Open map</a> : <span className="muted">Not shared</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <h2 style={{ fontSize: 20, margin: '6px 0 10px' }}>Reports</h2>
      <div className="card" style={{ overflowX: 'auto', marginBottom: 22 }}>
        {!d.reports.length ? <p className="muted">None.</p> : (
          <table>
            <thead><tr><th>When</th><th>Reported</th><th>Reason</th><th>By</th><th /></tr></thead>
            <tbody>{d.reports.map((r) => (
              <tr key={r.id} style={{ opacity: r.status === 'resolved' ? 0.5 : 1 }}>
                <td>{when(r.created_at)}</td><td>{r.target}</td><td>{r.reason}</td><td>{r.reporter}</td>
                <td className="row">
                  {r.status === 'open' ? <button className="btn" onClick={() => void resolve(r.id)}>Resolve</button> : <span className="small muted">Resolved</span>}
                  <button className="btn red" onClick={() => void suspend(r.target_id, r.target)}>Suspend</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <h2 style={{ fontSize: 20, margin: '6px 0 10px' }}>Flagged messages</h2>
      <p className="small muted" style={{ marginTop: -4 }}>Automatically flagged for off-platform payment, contact swaps or sexual requests.</p>
      <div className="card" style={{ overflowX: 'auto' }}>
        {!d.flaggedMessages.length ? <p className="muted">None.</p> : (
          <table>
            <thead><tr><th>When</th><th>Sender</th><th>Message</th></tr></thead>
            <tbody>{d.flaggedMessages.map((m) => <tr key={m.id}><td>{when(m.created_at)}</td><td>{m.sender}</td><td>{m.body}</td></tr>)}</tbody>
          </table>
        )}
      </div>
    </>
  );
}

type UserRow = { id: string; email: string; name: string; role: string; suspended: number; id_status: string; created_at: number };

function Users({ say }: Ctx) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<UserRow[] | null>(null);
  const load = useCallback(() => { api<UserRow[]>('GET', `/admin/users?q=${encodeURIComponent(q)}`).then(setList).catch((e) => say(e.message)); }, [q, say]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  const toggle = async (u: UserRow) => {
    const s = !u.suspended;
    if (s && !confirm(`Suspend ${u.email}?`)) return;
    try { await api('POST', `/admin/users/${u.id}/suspend`, { suspended: s }); say(s ? 'Suspended.' : 'Reactivated.'); load(); } catch (e) { say((e as Error).message); }
  };
  return (
    <>
      <h1>Users</h1>
      <input className="search" placeholder="Search email or name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
      <div className="card" style={{ overflowX: 'auto' }}>
        {!list ? <p className="muted">Loading…</p> : (
          <table>
            <thead><tr><th>Email</th><th>Name</th><th>Role</th><th>ID</th><th>Joined</th><th /></tr></thead>
            <tbody>{list.map((u) => (
              <tr key={u.id} style={{ opacity: u.suspended ? 0.55 : 1 }}>
                <td>{u.email}</td><td>{u.name || '—'}</td><td>{u.role}</td><td>{u.id_status}</td><td>{when(u.created_at)}</td>
                <td>{u.role !== 'admin' ? <button className={`btn ${u.suspended ? '' : 'red'}`} onClick={() => void toggle(u)}>{u.suspended ? 'Reactivate' : 'Suspend'}</button> : null}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
