// Invoice and booking confirmation emails. Runs against a LOCAL API that sends email to a mock Brevo, e.g.
//   npx wrangler dev --port 8789 --var BREVO_API_KEY:test --var EMAIL_FROM_ADDRESS:hello@zeitmit.app --var BREVO_API_BASE:http://localhost:9998
// with the demo companions seeded. Usage: node scripts/emails.mjs [api] [mockBrevo]
import { execSync } from 'node:child_process';

const [BASE = 'http://localhost:8789', MOCK = 'http://localhost:9998'] = process.argv.slice(2);
const CID = 'demo_noah';
let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? '✓' : '✗'} ${label}`); if (!cond) failures++; };
const call = async (method, path, token, body) => {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const sql = (q) => execSync(`npx wrangler d1 execute DB --local --command "${q}"`, { stdio: 'pipe' });
const inbox = async (to, since) => (await (await fetch(MOCK + '/emails')).json()).filter((m) => m.to === to && m.at >= since);
/** Signs in with the code from the login email (email is on, so codes aren't shown on screen). */
const login = async (email) => {
  const t0 = Date.now();
  let r = await call('POST', '/auth/request-code', null, { email });
  if (r.status === 429) { await new Promise((res) => setTimeout(res, 31000)); r = await call('POST', '/auth/request-code', null, { email }); }
  let code = r.data?.devCode;
  for (let i = 0; !code && i < 40; i++) {
    code = (await inbox(email, t0)).reverse().find((m) => /is your ZeitMit code$/.test(m.subject))?.subject.slice(0, 6);
    if (!code) await new Promise((res) => setTimeout(res, 150));
  }
  return (await call('POST', '/auth/verify', null, { email, code })).data;
};
const mail = async (to, since, re, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const hit = (await inbox(to, since)).find((m) => re.test(m.subject));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
};
const ics = (m) => Buffer.from(m.attachment.find((a) => a.name.endsWith('.ics'))?.content ?? '', 'base64').toString('utf8');
const icsTime = (unix) => new Date(unix * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

const stamp = Date.now();
const customer = async (tag, name, language) => {
  const u = await login(`${tag}+${stamp}@example.com`);
  await call('PATCH', '/me', u.token, { name, ageConfirmed: true, ...(language ? { language } : {}) });
  sql(`UPDATE users SET id_status = 'approved' WHERE id = '${u.user.id}'`);
  return u;
};
const N = await login('noah@demo.zeitmit.app');
await call('PATCH', '/me', N.token, { language: 'en' });
const noahEmail = 'noah@demo.zeitmit.app';
const left = (await call('GET', '/companion/bookings', N.token)).data;
for (const x of [...left.requests, ...left.upcoming]) await call('POST', `/companion/bookings/${x.id}/cancel`, N.token, { reason: 'Something else' });
const rate = (await call('GET', `/companions/${CID}`)).data.rate;
const times = (await call('GET', `/companions/${CID}/slots`)).data.slice(2).flatMap((d) => d.times.filter((t, i) => d.fit[i] >= 3).map((t) => [d.date, t])).reverse();
if (times.length < 6) throw new Error('Not enough open times: seed the demo companions again.');
const book = (token, [date, time], dur, place = '') => call('POST', '/bookings', token, { companionId: CID, act: 'movies', date, time, dur, place });
const eur = (cents) => '€' + (cents / 100).toFixed(2);

// 1) Paying sends the invoice
const A = await customer('mail-a', 'Mira Hoffmann');
let since = Date.now();
let r = await book(A.token, times[0], 2.5);
ok(r.status === 201, `booking paid (${times[0].join(' ')}, 2½ hours)`);
const first = r.data;
const inv = await mail(A.user.email, since, /^Invoice /);
const total = Math.round(rate * 250 * 1.1);
ok(!!inv && new RegExp(`^Invoice ZM-\\d{4}-\\d{5} · ${eur(total).replace('.', '\\.')} · Movies with Noah$`).test(inv.subject), `invoice email: “${inv?.subject}”`);
const number = inv?.subject.match(/ZM-\d{4}-\d{5}/)?.[0];
const html = inv?.html ?? '';
ok([number, 'Billed to', 'Mira Hoffmann', A.user.email, `Movies with Noah · ${eur(rate * 100)}/h × 2.5 h`, eur(rate * 250), 'Service fee (10%)', eur(total - rate * 250), eur(total), '2½ hours', 'Agree on a place in the chat', first.id].every((s) => html.includes(s)),
  'it lists number, customer, booking, length, place, line items and total');
ok(/Paid by card/.test(html) && /Test mode: no card was charged\./.test(html), 'and how it was paid (test mode says no card was charged)');
ok(['ZeitMit Test GmbH', 'Musterstraße 1, 10115 Berlin', 'USt-IdNr. DE000000000'].every((s) => html.includes(s)), 'seller details from INVOICE_DETAILS are printed');
ok(inv?.text?.includes(`Invoice number: ${number}`) && inv.text.includes(`Total: ${eur(total)}`), 'with a plain-text version too');
ok(inv?.sender?.email === 'hello@zeitmit.app' && inv.attachment.length === 0, 'sent from the configured address, no attachment');
const row = execSync(`npx wrangler d1 execute DB --local --json --command "SELECT number, kind, total, sent FROM invoices WHERE ref_id = '${first.id}'"`, { stdio: 'pipe' }).toString();
ok(JSON.parse(row)[0].results[0]?.sent === 1 && JSON.parse(row)[0].results[0].total === total, 'the invoice is on record and marked sent');
ok((await inbox(noahEmail, since)).length === 0, 'the companion gets no email for a request (only the in-app notice)');

// 2) Numbers follow on; gift credit shows as a payment
sql(`UPDATE users SET credit = 1000 WHERE id = '${A.user.id}'`);
since = Date.now();
r = await book(A.token, times[1], 1, 'Kino Babylon');
const second = r.data;
const inv2 = await mail(A.user.email, since, /^Invoice /);
const n1 = Number(number?.slice(-5)), n2 = Number(inv2?.subject.match(/ZM-\d{4}-(\d{5})/)?.[1]);
ok(n2 === n1 + 1, `the next invoice number follows on (${number} → ${inv2?.subject.match(/ZM-\d{4}-\d{5}/)?.[0]})`);
ok(inv2?.html.includes('Paid with gift credit') && inv2.html.includes('€10.00') && inv2.html.includes('Kino Babylon'), 'gift credit is shown as paid, with the meeting place');

// 3) Accepting confirms by email to both sides, with a calendar file
since = Date.now();
await call('POST', `/companion/bookings/${first.id}/accept`, N.token);
const cc = await mail(A.user.email, since, /^Confirmed: Movies with Noah, /);
const nc = await mail(noahEmail, since, /^Confirmed: Movies with Mira, /);
ok(!!cc && !!nc, `confirmation emails: “${cc?.subject}” and “${nc?.subject}”`);
const cal = cc ? ics(cc) : '';
const startsAt = (await call('GET', '/bookings', A.token)).data.find((x) => x.id === first.id).startsAt;
ok(cal.includes(`UID:${first.id}@zeitmit.app`) && cal.includes('SEQUENCE:0') && cal.includes(`DTSTART:${icsTime(startsAt)}`) && cal.includes(`DTEND:${icsTime(startsAt + 2.5 * 3600)}`), 'the calendar file has the right start and end (2½ hours)');
ok(cal.includes('SUMMARY:Movies with Noah (ZeitMit)') && !cal.includes('LOCATION:') && cal.split('\r\n').every((line) => Buffer.byteLength(line) <= 75), 'with a title, no place yet, and properly folded lines');
const otp = (await call('GET', '/bookings', A.token)).data.find((x) => x.id === first.id).otp;
ok(/^\d{4}$/.test(otp) && !cc?.html.includes(`>${otp}<`) && !new RegExp(`\\b${otp}\\b`).test(cc?.text ?? '') && !cal.split('\r\n').filter((l) => /^(SUMMARY|DESCRIPTION|LOCATION)/.test(l)).join(' ').includes(otp), 'the meet code is never in the email or the calendar file');
ok(nc?.html.includes('You earn') && nc.html.includes(eur(rate * 250)) && nc.html.includes('Mira') && !nc.html.includes('Hoffmann') && !nc.html.includes(A.user.email), 'the companion sees what they earn and only the customer’s first name');
ok(ics(nc ?? { attachment: [] }).includes('SUMMARY:Movies with Mira (ZeitMit)'), 'and their own calendar file');

// 4) A confirmed booking that moves: new time by email, the calendar entry updates
r = await call('GET', `/bookings/${first.id}/reschedule`, A.token);
const free = r.data.slots.flatMap((d) => d.times.filter((t, i) => d.fit[i] >= 2.5).map((t) => [d.date, t])).find(([d, t]) => !times.slice(0, 3).some(([d2, t2]) => d2 === d && t2 === t));
await call('POST', `/bookings/${first.id}/reschedule`, A.token, { date: free[0], time: free[1] });
since = Date.now();
r = await call('POST', `/bookings/${first.id}/reschedule/accept`, N.token);
const moved = await mail(A.user.email, since, /^New time: Movies with Noah, /);
const movedStart = (await call('GET', '/bookings', A.token)).data.find((x) => x.id === first.id).startsAt;
ok(r.status === 200 && !!moved && ics(moved).includes('SEQUENCE:1') && ics(moved).includes(`DTSTART:${icsTime(movedStart)}`), `moved booking: “${moved?.subject}”, calendar SEQUENCE 1`);
ok(!!(await mail(noahEmail, since, /^New time: Movies with Mira, /)), 'the companion is told the new time too');

// 5) A companion’s suggested time on a request, once accepted, confirms it by email
since = Date.now();
await call('POST', `/bookings/${second.id}/reschedule`, N.token, { date: times[3][0], time: times[3][1] });
await call('POST', `/bookings/${second.id}/reschedule/accept`, A.token);
const counter = await mail(A.user.email, since, /^Confirmed: Movies with Noah, /);
ok(!!counter && ics(counter).includes('LOCATION:Kino Babylon'), 'accepting the companion’s suggested time confirms it by email (place in the calendar file)');

// 6) Declined requests get no confirmation
const D = await customer('mail-d', 'Dan Decline');
const third = (await book(D.token, times[4], 1)).data;
since = Date.now();
await call('POST', `/companion/bookings/${third.id}/decline`, N.token);
await new Promise((res) => setTimeout(res, 1200));
ok(!(await inbox(D.user.email, since)).some((m) => /^Confirmed/.test(m.subject)), 'a declined request sends no confirmation');

// 7) German, by setting or by the language the app shows
const G = await customer('mail-g', 'Greta Groß', 'de');
since = Date.now();
const gb = (await book(G.token, times[5], 1)).data;
const ginv = await mail(G.user.email, since, /^Rechnung /);
ok(!!ginv && /^Rechnung ZM-\d{4}-\d{5} · \d+,\d{2}[\s\u00a0\u202f]€ · Kino mit Noah$/.test(ginv.subject) && ginv.html.includes('Servicegebühr (10 %)') && ginv.html.includes('Rechnung an') && ginv.html.includes('1 Stunde'), `German invoice: “${ginv?.subject}”`);
await call('POST', `/companion/bookings/${gb.id}/accept`, N.token);
const gc = await mail(G.user.email, since, /^Bestätigt: Kino mit Noah, /);
ok(!!gc && gc.html.includes('Deine Buchung ist bestätigt') && ics(gc).includes('SUMMARY:Kino mit Noah (ZeitMit)'), `German confirmation: “${gc?.subject}”`);
const U = await customer('mail-u', 'Uwe Auto');
await call('PATCH', '/me', U.token, { uiLanguage: 'de' });
ok((await call('GET', '/me', U.token)).data.uiLang === 'de' && (await call('PATCH', '/me', U.token, { uiLanguage: 'fr' })).status === 400, 'the app reports the language it shows (only en or de)');
since = Date.now();
const ub = (await book(U.token, times[2], 1)).data;
ok(!!(await mail(U.user.email, since, /^Rechnung /)), 'a person on “automatic” gets German when their app shows German');

// 8) Gift cards get an invoice too
since = Date.now();
r = await call('POST', '/gifts', A.token, { amount: 50, to: 'Lina' });
const gift = await mail(A.user.email, since, /^Invoice .+ZeitMit gift card$/);
ok(r.status === 201 && !!gift && gift.html.includes('Lina') && gift.html.includes('€50.00') && !gift.html.includes(r.data.code), `gift invoice: “${gift?.subject}” (without the code)`);

// 9) Names are shown as text, never as markup
const X = await customer('mail-x', 'Mo <b>Bold</b>');
since = Date.now();
const xb = (await book(X.token, times[0].slice(), 1).catch(() => null))?.data;
const xinv = await mail(X.user.email, since, /^Invoice /);
ok(!!xinv && !xinv.html.includes('<b>Bold</b>') && xinv.html.includes('&lt;b&gt;Bold&lt;/b&gt;'), 'names are escaped in the HTML');

for (const [b, t] of [[first, A.token], [second, A.token], [gb, G.token], [ub, U.token], [xb, X.token]]) if (b?.id) await call('POST', `/bookings/${b.id}/cancel`, t);
console.log(failures ? `\n${failures} check(s) failed` : '\nAll email checks passed');
process.exit(failures ? 1 : 0);
