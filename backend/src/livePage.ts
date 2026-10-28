// The page a trusted contact opens from the WhatsApp link: status, booking, last location. No login.
import type { liveCheckin } from './routes/safety';
import { now } from './lib/util';

type Live = NonNullable<Awaited<ReturnType<typeof liveCheckin>>>;

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

const T = {
  en: {
    title: 'Safety check-in', meeting: (a: string, b: string) => `${a} is meeting ${b} through ZeitMit.`,
    ok: 'Checked in, all OK', okSub: (t: string) => `Last “I’m OK”: ${t}`,
    missed: 'Missed a check-in', missedSub: (a: string, t: string) => `${a} hasn’t answered since ${t}. Try calling them. If you can’t reach them and you’re worried, call 112.`,
    sos: 'SOS pressed', sosSub: (a: string, t: string) => `${a} pressed SOS at ${t}. Call them now. If you can’t reach them, call 112 and give the location below.`,
    ended: 'Check-in ended', endedSub: 'This check-in is over. The location is no longer shared.',
    when: 'When', where: 'Where', loc: 'Last location', locAgo: (m: string) => `updated ${m}`, noLoc: 'Location sharing is off.', waitLoc: 'Waiting for the first location. It updates while the app is open.',
    maps: 'Open in Google Maps', call: 'Call 112', refresh: 'This page refreshes every minute.',
    min: (n: number) => (n < 1 ? 'just now' : n === 1 ? '1 minute ago' : `${n} minutes ago`), notFound: 'This link doesn’t exist or has expired.',
  },
  de: {
    title: 'Sicherheits-Check-in', meeting: (a: string, b: string) => `${a} trifft ${b} über ZeitMit.`,
    ok: 'Eingecheckt, alles gut', okSub: (t: string) => `Letztes „Alles gut“: ${t}`,
    missed: 'Check-in verpasst', missedSub: (a: string, t: string) => `${a} hat seit ${t} nicht reagiert. Versuch anzurufen. Wenn du niemanden erreichst und dir Sorgen machst, ruf 112.`,
    sos: 'SOS gedrückt', sosSub: (a: string, t: string) => `${a} hat um ${t} SOS gedrückt. Ruf jetzt an. Wenn du niemanden erreichst, ruf 112 und nenne den Standort unten.`,
    ended: 'Check-in beendet', endedSub: 'Dieser Check-in ist vorbei. Der Standort wird nicht mehr geteilt.',
    when: 'Wann', where: 'Wo', loc: 'Letzter Standort', locAgo: (m: string) => `aktualisiert ${m}`, noLoc: 'Standortfreigabe ist aus.', waitLoc: 'Warte auf den ersten Standort. Er wird aktualisiert, solange die App offen ist.',
    maps: 'In Google Maps öffnen', call: '112 anrufen', refresh: 'Diese Seite aktualisiert sich jede Minute.',
    min: (n: number) => (n < 1 ? 'gerade eben' : n === 1 ? 'vor 1 Minute' : `vor ${n} Minuten`), notFound: 'Dieser Link existiert nicht oder ist abgelaufen.',
  },
};

export type Lang = keyof typeof T;
export const pickLang = (accept: string | undefined): Lang => (/^\s*de\b/i.test(accept ?? '') ? 'de' : 'en');

const fmt = (lang: Lang, unix: number, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { timeZone: 'Europe/Berlin', ...o }).format(new Date(unix * 1000));
const clock = (lang: Lang, unix: number) => fmt(lang, unix, { hour: '2-digit', minute: '2-digit', hour12: false });

const shell = (lang: Lang, title: string, body: string, refresh: boolean) => `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
${refresh ? '<meta http-equiv="refresh" content="60">' : ''}<title>${esc(title)} · ZeitMit</title>
<style>
:root{--sun:#FFE94D;--ink:#111;--paper:#fff;--muted:#5B5640;--ok:#178A60;--okbg:#E7F5EE;--warn:#B37112;--warnbg:#FDF3E2;--bad:#D9435F;--badbg:#FCEBEE}
*{box-sizing:border-box}body{margin:0;background:var(--sun);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:20px 16px 40px}
main{max-width:520px;margin:0 auto;display:grid;gap:14px}.logo{font-weight:800;font-size:22px;letter-spacing:-.03em}.logo b{color:#FF4F8B}
h1{font-size:28px;line-height:1.1;letter-spacing:-.03em;margin:0}.card{background:var(--paper);border:2px solid var(--ink);border-radius:18px;box-shadow:4px 4px 0 var(--ink);padding:16px;display:grid;gap:8px}
.status{border-radius:18px;border:2px solid var(--ink);padding:16px;display:grid;gap:6px}.status.ok{background:var(--okbg)}.status.missed{background:var(--warnbg)}.status.sos{background:var(--badbg)}.status.ended{background:var(--paper)}
.status h2{margin:0;font-size:20px}.ok h2{color:var(--ok)}.missed h2{color:var(--warn)}.sos h2{color:var(--bad)}
.row{display:grid;grid-template-columns:70px 1fr;gap:8px}.label{color:var(--muted);font-size:14px}.muted{color:var(--muted);font-size:14px}
iframe{width:100%;height:260px;border:2px solid var(--ink);border-radius:14px}
a.btn{display:block;text-align:center;font-weight:700;text-decoration:none;color:#fff;background:var(--ink);border-radius:14px;padding:14px}
a.btn.red{background:var(--bad)}a.link{color:var(--ink);font-weight:600}
</style></head><body><main><div class="logo">zeitmit<b>!</b></div>${body}</main></body></html>`;

export function notFoundPage(lang: Lang) {
  const t = T[lang];
  return shell(lang, t.title, `<h1>${esc(t.title)}</h1><div class="card"><p>${esc(t.notFound)}</p></div>`, false);
}

export function livePage(live: Live, lang: Lang) {
  const t = T[lang];
  const { ck, bk, self, other } = live;
  const ended = ck.status === 'ended';
  const kind = ended ? 'ended' : ck.status === 'sos' ? 'sos' : ck.status === 'alerted' ? 'missed' : 'ok';
  const sinceOk = ck.last_ok_at ?? ck.created_at;
  const head = { ok: t.ok, missed: t.missed, sos: t.sos, ended: t.ended }[kind];
  const sub = {
    ok: t.okSub(clock(lang, sinceOk)),
    missed: t.missedSub(self, clock(lang, sinceOk)),
    sos: t.sosSub(self, clock(lang, ck.sos_at ?? now())),
    ended: t.endedSub,
  }[kind];
  const end = bk.starts_at + bk.duration_h * 3600;
  const when = `${fmt(lang, bk.starts_at, { weekday: 'short', day: 'numeric', month: 'short' })}, ${clock(lang, bk.starts_at)}–${clock(lang, end)}`;

  let location = '';
  if (!ended) {
    if (ck.share_location && ck.last_lat != null && ck.last_lng != null) {
      const { last_lat: lat, last_lng: lng } = ck;
      const d = 0.004;
      const map = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d},${lat - d * 0.6},${lng + d},${lat + d * 0.6}&layer=mapnik&marker=${lat},${lng}`;
      const ago = ck.last_loc_at ? t.locAgo(t.min(Math.floor((now() - ck.last_loc_at) / 60))) : '';
      location = `<div class="card"><div><b>${esc(t.loc)}</b> <span class="muted">${esc(ago)}</span></div>
<iframe src="${map}" title="${esc(t.loc)}" loading="lazy"></iframe>
<a class="link" href="https://maps.google.com/?q=${lat},${lng}" target="_blank" rel="noopener">${esc(t.maps)} →</a></div>`;
    } else {
      location = `<div class="card"><b>${esc(t.loc)}</b><span class="muted">${esc(ck.share_location ? t.waitLoc : t.noLoc)}</span></div>`;
    }
  }

  const body = `<h1>${esc(t.title)}</h1>
<p style="margin:0">${esc(t.meeting(self, other))}</p>
<div class="status ${kind}"><h2>${esc(head)}</h2><div>${esc(sub)}</div></div>
${ended ? '' : `<div class="card"><div class="row"><span class="label">${esc(t.when)}</span><span>${esc(when)}</span></div><div class="row"><span class="label">${esc(t.where)}</span><span>${esc(bk.place)}</span></div></div>`}
${location}
${kind === 'sos' || kind === 'missed' ? `<a class="btn red" href="tel:112">${esc(t.call)}</a>` : ''}
${ended ? '' : `<p class="muted" style="margin:0;text-align:center">${esc(t.refresh)}</p>`}`;
  return shell(lang, t.title, body, !ended);
}
