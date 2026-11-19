// Profile changes: an approved companion's new texts and photos wait here before customers see them (the live listing
// stays until then). One card per companion: the old and new text word by word (with what ZeitMit's check points out),
// the old and new photos. Approve, leave single new photos out, or reject with a note; the companion is told either way.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, photoSrc } from './api';
import { Avatar, ago, day, month, type Ctx } from './shared';

type Hint = { label: string; words: string[] };
type TextChange = { id: string; field: 'about' | 'tagline'; label: string; createdAt: number; before: string; after: string; hints: Hint[] };
type PhotoChange = { id: string; field: 'photo'; label: string; createdAt: number; before: string | null; after: string };
type GalleryChange = { id: string; field: 'gallery'; label: string; createdAt: number; after: { id: string; url: string; added: boolean }[]; removed: { id: string; url: string }[] };
type Change = TextChange | PhotoChange | GalleryChange;
type Card = { companion: { id: string; name: string; email: string; hue: number; photoUrl: string | null; since: number }; changes: Change[]; firstAt: number; lastAt: number };
type Decided = { id: string; companionId: string; name: string; field: Change['field']; label: string; createdAt: number; decidedAt: number; note: string | null; text: string | null; photos: (string | null)[] };

const isText = (c: Change): c is TextChange => c.field === 'about' || c.field === 'tagline';
const listOf = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
/** A note to start from, for what the check found (the admin can change it). */
const SUGGEST: Record<string, string> = {
  'Social media or messenger': 'Social media and messengers aren’t allowed on ZeitMit. Please remove that part.',
  'Payment outside ZeitMit': 'Payments only go through ZeitMit. Please remove that part.',
  'Sexual content': 'ZeitMit is strictly non-sexual. Please remove that part.',
  'Meeting at home or in private': 'Meet-ups happen in public places only. Please remove that part.',
};

export function ProfileChanges({ say, refresh }: Ctx) {
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [cards, setCards] = useState<Card[] | null>(null);
  const [decided, setDecided] = useState<Decided[] | null>(null);
  const load = useCallback(() => {
    if (tab === 'pending') api<Card[]>('GET', '/admin/profile-changes').then(setCards).catch((e) => say(e.message));
    else { setDecided(null); api<Decided[]>('GET', `/admin/profile-changes?status=${tab}`).then(setDecided).catch((e) => say(e.message)); }
  }, [tab, say]);
  useEffect(load, [load]);
  return (
    <>
      <h1>Profile changes</h1>
      <p className="muted sub" style={{ maxWidth: 760 }}>
        Approved companions’ new photos and texts wait here. Customers keep seeing the old version until you approve. The companion is told either way, with your note.
      </p>
      <div className="tabs">
        <button className={tab === 'pending' ? 'on' : ''} onClick={() => setTab('pending')}>Waiting{cards ? ` (${cards.length})` : ''}</button>
        <button className={tab === 'approved' ? 'on' : ''} onClick={() => setTab('approved')}>Approved</button>
        <button className={tab === 'rejected' ? 'on' : ''} onClick={() => setTab('rejected')}>Rejected</button>
      </div>
      {tab === 'pending' ? (
        !cards ? <p className="muted">Loading…</p> : !cards.length ? <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing waits for review.</p></div> : (
          <div className="grid" style={{ gap: 18 }}>
            {cards.map((c) => <ChangeCard key={c.companion.id + c.lastAt} card={c} say={say} done={() => { load(); refresh(); }} />)}
          </div>
        )
      ) : !decided ? <p className="muted">Loading…</p> : !decided.length ? <p className="muted">Nothing here yet.</p> : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Companion</th><th>What</th><th>Decided</th><th>Note</th><th>Change</th></tr></thead>
            <tbody>{decided.map((x) => (
              <tr key={x.id}>
                <td><b>{x.name}</b></td>
                <td>{x.label.charAt(0).toUpperCase() + x.label.slice(1)}</td>
                <td className="small">{day(x.decidedAt)}<div className="muted">sent {ago(x.createdAt, x.decidedAt).replace(' ago', ' before')}</div></td>
                <td className="small">{x.note ?? <span className="muted">—</span>}</td>
                <td className="small" style={{ maxWidth: 380 }}>
                  {x.text !== null ? <span className="muted">“{x.text.length > 160 ? x.text.slice(0, 160) + '…' : x.text}”</span> : (
                    <div className="row" style={{ gap: 6 }}>{x.photos.map((u, i) => (u ? <img key={i} className="thumb" src={photoSrc(u)} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : null))}</div>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ChangeCard({ card, say, done }: { card: Card; say: (m: string) => void; done: () => void }) {
  const name = card.companion.name;
  const texts = card.changes.filter(isText);
  const pics = card.changes.filter((c): c is PhotoChange | GalleryChange => !isText(c));
  const hints = texts.flatMap((c) => c.hints);
  const [note, setNote] = useState(() => (hints[0] ? SUGGEST[hints[0].label] ?? '' : ''));
  const [out, setOut] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const gallery = pics.find((c): c is GalleryChange => c.field === 'gallery');

  const decide = async (approve: Change[], reject: Change[], ok: string) => {
    const leaving = approve.includes(gallery!) ? out : [];
    if ((reject.length || leaving.length) && note.trim().length < 3) return say(`Add a short note for ${name} first. They see it.`);
    if (gallery && approve.includes(gallery) && gallery.after.length - leaving.length < 3) return say('That leaves fewer than 3 photos. Reject the photos instead.');
    setBusy(true);
    try {
      await api('POST', `/admin/profile-changes/${card.companion.id}`, { approve: approve.map((c) => c.id), reject: reject.map((c) => c.id), dropPhotos: leaving, note: note.trim() });
      say(ok);
      done();
    } catch (e) {
      say((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const both = texts.length > 0 && pics.length > 0;
  return (
    <div className="card" style={{ display: 'grid', gap: 16 }} data-testid="change-card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="who">
          <Avatar name={name} url={card.companion.photoUrl} hue={card.companion.hue} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{name}</div>
            <div className="small muted">Changed {listOf([...new Set(card.changes.map((c) => c.label))])} · {ago(card.lastAt)} · companion since {month(card.companion.since)}</div>
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {hints.length
            ? hints.map((h) => <span key={h.label} className="chip bad">⚠ {h.label}: {h.words.join(', ')}</span>)
            : <span className="chip ok">Nothing found by the check</span>}
        </div>
      </div>

      {texts.map((c) => <TextDiff key={c.id} c={c} />)}

      {pics.length ? (
        <div>
          <div className="lbl">Photos</div>
          <div className="row" style={{ gap: 18, alignItems: 'flex-start' }}>
            {pics.map((c) => c.field === 'photo' ? (
              <div key={c.id} className="row" style={{ gap: 18, alignItems: 'flex-start' }}>
                {c.before ? <Tile url={c.before} cap="Profile photo now" /> : null}
                <Tile url={c.after} cap="New profile photo" added />
              </div>
            ) : (
              <div key={c.id} className="row" style={{ gap: 18, alignItems: 'flex-start' }}>
                {c.after.map((p) => (
                  <Tile key={p.id} url={p.url} cap={p.added ? (out.includes(p.id) ? 'Left out' : 'New photo') : 'Same'} added={p.added && !out.includes(p.id)} faded={out.includes(p.id)}>
                    {p.added ? (
                      <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                        <input type="checkbox" checked={out.includes(p.id)} onChange={(e) => setOut((o) => (e.target.checked ? [...o, p.id] : o.filter((x) => x !== p.id)))} />
                        Leave out
                      </label>
                    ) : null}
                  </Tile>
                ))}
                {c.removed.map((p) => <Tile key={p.id} url={p.url} cap="Removed" faded />)}
              </div>
            ))}
          </div>
          {gallery?.after.some((p) => p.added) ? <div className="small muted" style={{ marginTop: 8 }}>Tick “Leave out” under a new photo to approve the others without it.</div> : null}
        </div>
      ) : null}

      <textarea className="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300}
        placeholder={`Note to ${name}, sent when something isn’t approved: what to change, e.g. “Please use a photo where your face is visible.”`} aria-label={`Note to ${name}`} />
      <div className="row">
        {both ? (
          <>
            <button className="btn green" disabled={busy} onClick={() => void decide(card.changes, [], `Approved. ${name} is told.`)}>Approve all</button>
            <button className="btn" disabled={busy} onClick={() => void decide(pics, [], `Photos approved. The text still waits.`)}>Approve photos only</button>
            <button className="btn red" disabled={busy} onClick={() => void decide([], texts, `Text rejected. ${name} is told, with your note.`)}>Reject the text</button>
            <button className="btn red" disabled={busy} onClick={() => void decide([], pics, `Photos rejected. ${name} is told, with your note.`)}>Reject the photos</button>
          </>
        ) : (
          <>
            <button className="btn green" disabled={busy} onClick={() => void decide(card.changes, [], `Approved. ${name} is told.`)}>Approve</button>
            <button className="btn red" disabled={busy} onClick={() => void decide([], card.changes, `Rejected. ${name} is told, with your note.`)}>Reject</button>
          </>
        )}
      </div>
    </div>
  );
}

function Tile({ url, cap, added, faded, children }: { url: string; cap: string; added?: boolean; faded?: boolean; children?: ReactNode }) {
  return (
    <div style={{ opacity: faded ? 0.55 : 1 }}>
      <a href={photoSrc(url)} target="_blank" rel="noreferrer"><img className={`ph${added ? ' added' : ''}`} src={photoSrc(url)} alt={cap} /></a>
      <div className={`cap${added ? ' added' : ' muted'}`}>{cap}</div>
      {children}
    </div>
  );
}

/**
 * The old and the new text: each changed stretch as what was removed (struck through) and what was added (marked; words
 * ZeitMit's check found are outlined in red).
 */
function TextDiff({ c }: { c: TextChange }) {
  const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const flagged = new Set(c.hints.flatMap((h) => h.words.flatMap((w) => w.split(/\s+/).map(norm))));
  const bad = (w: string) => { const n = norm(w); return !!n && [...flagged].some((f) => n === f || (f.length >= 4 && n.startsWith(f))); };
  const added = (text: string) => text.split(/(\s+)/).map((w, i) => (bad(w) ? <b key={i} className="flag">{w}</b> : w));
  return (
    <div>
      <div className="lbl">{c.field === 'about' ? 'About' : 'Tagline'}</div>
      <div className="textbox">
        {!c.before ? <ins>{added(c.after)}</ins> : diffWords(c.before, c.after).map((x, i) => (
          x.same !== undefined ? <span key={i}>{x.same}</span> : (
            <span key={i}>{x.del ? <del>{x.del.trimEnd()}</del> : null}{x.del && x.ins ? ' ' : ''}{x.ins ? <ins>{added(x.ins.trimEnd())}</ins> : null}{/\s$/.test(x.ins || x.del || '') ? ' ' : ''}</span>
          )
        ))}
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>
        <span className="sw" style={{ background: '#f9cdd6' }} />removed
        <span className="sw" style={{ background: 'var(--mint-soft)', marginLeft: 10 }} />added
        {c.hints.length ? <><span className="sw" style={{ background: '#ffc9d4', borderColor: 'var(--red)', marginLeft: 10 }} />worth a look (ZeitMit’s check)</> : null}
      </div>
    </div>
  );
}

/**
 * What stayed and what changed, word by word (longest common subsequence of words, each with the space after it).
 * Changed stretches come out whole: what was removed, then what was added. A single short word left the same between
 * two changes ("me", "and") counts as part of the change, so a rewritten sentence reads as one.
 */
function diffWords(a: string, b: string) {
  const A = a.match(/\S+\s*/g) ?? [], B = b.match(/\S+\s*/g) ?? [];
  const key = (w: string) => w.trim();
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = key(A[i]) === key(B[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  type Op = { k: 'same' | 'del' | 'ins'; t: string };
  const ops: Op[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (key(A[i]) === key(B[j])) { ops.push({ k: 'same', t: B[j] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) ops.push({ k: 'del', t: A[i++] });
    else ops.push({ k: 'ins', t: B[j++] });
  }
  while (i < n) ops.push({ k: 'del', t: A[i++] });
  while (j < m) ops.push({ k: 'ins', t: B[j++] });
  // A lone short word kept between two changes becomes part of them (removed and added again).
  const clean: Op[] = [];
  ops.forEach((o, x) => {
    const lone = o.k === 'same' && key(o.t).length <= 4 && ops[x - 1] && ops[x - 1].k !== 'same' && ops[x + 1] && ops[x + 1].k !== 'same';
    if (lone) clean.push({ k: 'del', t: o.t }, { k: 'ins', t: o.t });
    else clean.push(o);
  });
  const out: { same?: string; del?: string; ins?: string }[] = [];
  for (const o of clean) {
    const last = out[out.length - 1];
    if (o.k === 'same') {
      if (last?.same !== undefined) last.same += o.t;
      else out.push({ same: o.t });
    } else if (last && last.same === undefined) last[o.k] = (last[o.k] ?? '') + o.t;
    else out.push({ [o.k]: o.t });
  }
  return out;
}
