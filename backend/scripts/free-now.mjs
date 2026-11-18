// Free now: a companion switches it on (1, 2 or 3 hours) and can then be booked for a video date that starts as soon
// as they accept. They have 2 minutes to answer, and their phone rings (a high-priority push). One request at a time
// per customer and per companion; the longest video date fits before the switch ends and before their next booking.
// It only counts while their app checked in within 10 minutes; 3 requests in a row left unanswered switch it off.
// Runs against a LOCAL API with the demo companions seeded and pushes sent to this script:
//   npx wrangler dev --local --test-scheduled --var EXPO_PUSH_URL:http://localhost:8798/push
// Uses Yuki (video dates) and, briefly, Noah with video dates added. Usage: node scripts/free-now.mjs [api]
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';

const [BASE = 'http://localhost:8787'] = process.argv.slice(2);
const YID = 'demo_yuki', NID = 'demo_noah';
const TZ = 'Europe/Berlin';
const TOKEN = 'ExponentPushToken[free-now-test]';
let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? '✓' : '✗'} ${label}`); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(200); } return false; };
const call = async (method, path, token, body) => {
  const res = await fetch(BASE + path, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json', 'X-ZeitMit-Api': '3', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const login = async (email) => {
  const r = await call('POST', '/auth/request-code', null, { email });
  return (await call('POST', '/auth/verify', null, { email, code: r.data.devCode })).data;
};
const sql = (q) => execSync(`npx wrangler d1 execute DB --local --command "${q}"`, { stdio: 'pipe' });
const one = (q) => JSON.parse(execSync(`npx wrangler d1 execute DB --local --json --command "${q}"`, { stdio: 'pipe' }).toString())[0].results[0];
const row = (id) => one(`SELECT * FROM bookings WHERE id = '${id}'`);
const comp = (id) => one(`SELECT free_now_until, free_now_seen, free_now_misses, free_now_paused FROM companions WHERE user_id = '${id}'`);
const berlin = (days) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + days * 86400000));
const nowS = () => Math.floor(Date.now() / 1000);
const step = (u) => Math.ceil(u / 900) * 900;
const near = (a, b, s = 5) => typeof a === 'number' && Math.abs(a - b) <= s;

// The push service (EXPO_PUSH_URL points here): keeps every push the API sends.
const pushes = [];
const pushMock = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try { pushes.push(...[].concat(JSON.parse(body))); } catch { /* not JSON */ }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"data":{"status":"ok"}}');
  });
}).listen(8798);
const rings = () => pushes.filter((p) => p.to === TOKEN && p.data?.kind === 'instant');

const Y = await login('yuki@demo.zeitmit.app');
const N = await login('noah@demo.zeitmit.app');
const customer = async (name) => {
  const u = await login(`freenow+${name.toLowerCase()}+${Date.now()}@example.com`);
  await call('PATCH', '/me', u.token, { name, ageConfirmed: true });
  sql(`UPDATE users SET id_status = 'approved' WHERE id = '${u.user.id}'`);
  return u.token;
};
const A = await customer('Asha'), B = await customer('Bo');
const listed = async (cid = YID) => (await call('GET', '/companions')).data.find((c) => c.id === cid);
const notes = async (token) => (await call('GET', '/me/notifications', token)).data;
const now_ = (token, cid, minutes, extra = {}) => call('POST', '/bookings', token, { companionId: cid, act: 'call', instant: true, minutes, boundariesAgreed: true, ...extra });

// A clean slate: no open bookings for Yuki, video dates done earlier today out of the way, the switch off, pushes on
// this test phone with booking pushes off (only urgent ones come through).
const open = (await call('GET', '/companion/bookings', Y.token)).data;
for (const x of [...open.requests, ...open.upcoming]) await call('POST', `/companion/bookings/${x.id}/cancel`, Y.token, { reason: 'Something else' });
sql(`UPDATE bookings SET starts_at = starts_at - 30 * 86400 WHERE companion_id = '${YID}' AND status IN ('completed', 'confirmed') AND starts_at > unixepoch() - 9 * 3600`);
sql(`UPDATE companions SET free_now_until = NULL, free_now_seen = NULL, free_now_misses = 0, free_now_paused = NULL WHERE user_id IN ('${YID}', '${NID}')`);
await call('PATCH', '/me', Y.token, { pushToken: TOKEN, prefs: { pushBookings: false } });

// 1) Off by default; only with video dates; 1, 2 or 3 hours
let prof = (await call('GET', '/companion', Y.token)).data;
ok(prof.freeNow && prof.freeNow.until === null && JSON.stringify(prof.freeNow.hours) === '[1,2,3]', `off to start with, choices 1, 2 or 3 hours (${JSON.stringify(prof.freeNow)})`);
ok((await listed())?.freeNow === null && (await call('GET', `/companions/${YID}/availability`)).data.freeNow === null, 'customers don’t see Yuki as free now');
let r = await call('PUT', '/companion/free-now', Y.token, { hours: 5 });
ok(r.status === 400 && r.data?.error === 'Choose 1, 2 or 3 hours.', 'only 1, 2 or 3 hours');
r = await call('PUT', '/companion/free-now', N.token, { hours: 2 });
ok(r.status === 409 && r.data?.error === 'Add video dates to your activities first.', `not without video dates (Noah: ${r.data?.error})`);

// 2) On for 2 hours: the list and the profile say so, with the longest video date that fits
r = await call('PUT', '/companion/free-now', Y.token, { hours: 2 });
ok(r.status === 200 && near(r.data.until, nowS() + 7200), `Yuki is free now for 2 hours (until ${r.data?.until})`);
let L = await listed();
const fitMax = (end) => Math.min(480, Math.floor((end - nowS() - 120) / 60 / 15) * 15);
ok(L.freeNow && L.freeNow.until === r.data.until && [fitMax(r.data.until), fitMax(r.data.until) - 15].includes(L.freeNow.max), `the list: free now, up to ${L.freeNow?.max} minutes (before the 2 hours end, after 2 minutes to answer)`);
let a = (await call('GET', `/companions/${YID}`)).data.availability;
ok(a.freeNow?.max === L.freeNow.max, 'and her profile');

// 3) Video date now: only video, in 15-minute steps, at most what fits
ok((await now_(A, YID, 45, { act: 'coffee' })).data?.error === 'Only video dates can start right away.', 'only video dates start right away');
ok((await now_(A, YID, 20)).status === 400, 'under 30 minutes is refused');
r = await now_(A, YID, L.freeNow.max + 15);
ok(r.status === 409 && /^Yuki is free for up to .+ right now\.$/.test(r.data?.error ?? ''), `longer than fits is refused (${r.data?.error})`);

// 4) Asha asks for 45 minutes: Yuki's phone rings, 2 minutes to answer
const ringsBefore = rings().length;
r = await now_(A, YID, 45);
const v1 = r.data?.id;
let b1 = row(v1);
ok(r.status === 201 && r.data.status === 'pending' && r.data.instant === true, `Asha asks for a video date now (${r.data?.status ?? r.data?.error})`);
ok(b1.instant === 1 && b1.expires_at === b1.created_at + 120 && r.data.expiresAt === b1.expires_at, '2 minutes to answer');
ok(await until(() => rings().length === ringsBefore + 1), 'Yuki’s phone rings, though booking pushes are off');
const ring = rings().at(-1);
ok(ring?.title === 'Video date request from Asha' && ring.priority === 'high' && ring.sound === 'default' && ring.ttl > 100 && ring.ttl <= 120 && ring.data.bookingId === v1,
  `“${ring?.title}”: high priority, with sound, gone when the time is up (ttl ${ring?.ttl} s)`);
ok(/^45 minutes · You earn €[\d.]+ · Answer within 2 minutes\.$/.test(ring?.body ?? ''), `“${ring?.body}”`);
let yb = (await call('GET', '/companion/bookings', Y.token)).data;
ok(yb.requests.some((x) => x.id === v1 && x.instant === true && x.expiresAt === b1.expires_at), 'it’s in Yuki’s requests, as a video date now');
ok(!(await notes(A)).some((n) => n.title === 'Request sent to Yuki' && n.created_at >= b1.created_at), 'Asha isn’t sent a “Request sent” (the app shows her the wait)');
ok((await listed())?.freeNow === null, 'while she answers, Yuki isn’t free now for anyone else');
r = await now_(B, YID, 30);
ok(r.status === 409 && r.data?.error === 'Yuki isn’t free right now. Pick a time instead.', `so Bo can’t send one too (${r.data?.error})`);
ok((await call('POST', `/bookings/${v1}/reschedule`, A, { startsAt: step(nowS() + 5 * 3600) })).status === 409, 'a video date now can’t be moved');

// One at a time for the customer too (Noah with video dates and Free now, for a moment)
const nAct = (await call('GET', '/companion', N.token)).data.acts;
await call('PATCH', '/companion', N.token, { acts: [...nAct, 'call'] });
await call('PUT', '/companion/free-now', N.token, { hours: 1 });
r = await now_(A, NID, 30);
ok(r.status === 409 && r.data?.error === 'You already have a video date request waiting. Wait for the answer first.', `Asha can’t send a second one meanwhile (${r.data?.error})`);
await call('DELETE', '/companion/free-now', N.token);
await call('PATCH', '/companion', N.token, { acts: nAct });

// 5) Yuki accepts: the video date starts now and can be joined at once
r = await call('POST', `/companion/bookings/${v1}/accept`, Y.token);
b1 = row(v1);
ok(r.status === 200 && b1.status === 'confirmed' && near(b1.starts_at, nowS()) && b1.ends_at === b1.starts_at + 45 * 60, `accepted: it starts now (${r.data?.status ?? r.data?.error})`);
ok((await notes(A)).some((n) => n.title === 'Yuki accepted' && n.go === `call:${v1}` && /^Your video date starts now \(45 minutes\)\. Join it in the app\.$/.test(n.body)), 'Asha is told, and the notification opens the call');
ok((await call('POST', `/calls/${v1}`, A)).status === 200 && (await call('POST', `/calls/${v1}`, Y.token)).status === 200, 'both can join the call right away');
ok((await listed())?.freeNow === null, 'in the video date, Yuki isn’t free now for anyone else');
await call('POST', `/companion/bookings/${v1}/cancel`, Y.token, { reason: 'Something else' });
ok(!!(await listed())?.freeNow, 'once it’s over (here: cancelled), she’s free now again');

// 6) Declined: refunded in full at once
r = await now_(B, YID, 30);
const v2 = r.data?.id;
r = await call('POST', `/companion/bookings/${v2}/decline`, Y.token);
const b2 = row(v2);
ok(r.status === 200 && b2.status === 'rejected' && b2.pay_status === 'refunded' && b2.refunded === b2.total, 'Yuki declines: refunded in full');
ok((await notes(B)).some((n) => n.title === 'Yuki can’t take it right now' && /refunded in full\. Try someone else who’s free now\.$/.test(n.body)), 'Bo is told to try someone else');
ok(!!(await listed())?.freeNow, 'Yuki is free now again');

// 7) Not answered in time: refunded; 3 in a row switch Free now off
const expire = async (token) => {
  const id = (await now_(token, YID, 30)).data?.id;
  sql(`UPDATE bookings SET created_at = created_at - 121 WHERE id = '${id}'`);
  await call('GET', '/bookings', token); // her app asks again once the 2 minutes are up
  return id;
};
const e1 = await expire(A);
ok(row(e1).status === 'expired' && row(e1).pay_status === 'refunded', 'after 2 minutes without an answer: expired, refunded');
ok((await notes(A)).some((n) => n.title === 'Yuki couldn’t answer in time'), 'Asha is told');
ok((await notes(Y.token)).some((n) => n.title === 'Missed video date request' && /^Asha’s request wasn’t answered within 2 minutes/.test(n.body)), 'and Yuki');
ok(comp(YID).free_now_misses === 1 && !!(await listed())?.freeNow, 'one missed: still free now');
// Answering one starts the count again
const v3 = (await now_(B, YID, 30)).data?.id;
await call('POST', `/companion/bookings/${v3}/decline`, Y.token);
ok(comp(YID).free_now_misses === 0, 'answering one (declining too) starts the count again');
await expire(A); await expire(B);
ok(comp(YID).free_now_misses === 2 && !!comp(YID).free_now_until, 'two in a row: still on');
await expire(A);
const c3 = comp(YID);
ok(c3.free_now_until === null && c3.free_now_misses === 0 && near(c3.free_now_paused, nowS(), 10), 'the third in a row switches Free now off');
ok((await notes(Y.token)).some((n) => n.title === 'Free now is off' && n.go === 'comp:overview'), 'and Yuki is told why');
prof = (await call('GET', '/companion', Y.token)).data;
ok(prof.freeNow.until === null && prof.freeNow.paused === c3.free_now_paused, 'her app can show the notice');
ok((await listed())?.freeNow === null, 'customers don’t see her as free now');
ok((await now_(B, YID, 30)).status === 409, 'nor can they send one');

// 8) It only counts while her app is open (checked in within 10 minutes)
await call('PUT', '/companion/free-now', Y.token, { hours: 1 });
prof = (await call('GET', '/companion', Y.token)).data;
ok(near(prof.freeNow.until, nowS() + 3600) && prof.freeNow.paused === null, 'on again for 1 hour: the notice goes');
sql(`UPDATE companions SET free_now_seen = unixepoch() - 601 WHERE user_id = '${YID}'`);
ok((await listed())?.freeNow === null, 'her app hasn’t checked in for 10 minutes: not free now');
r = await call('POST', '/companion/free-now/seen', Y.token);
ok(r.status === 200 && !!(await listed())?.freeNow, 'it checks in again: free now');

// 9) Only what fits before her next booking, and before the switch ends
sql(`DELETE FROM hours_days WHERE companion_id = '${YID}'`);
await call('PUT', `/companion/hours/days/${berlin(0)}`, Y.token, { ranges: [{ from: '00:00', to: '24:00' }] });
await call('PUT', `/companion/hours/days/${berlin(1)}`, Y.token, { ranges: [{ from: '00:00', to: '24:00' }] });
const at = step(nowS() + 1200 + 60) + 900;
const sched = (await call('POST', '/bookings', B, { companionId: YID, act: 'call', startsAt: at, minutes: 30, place: '', boundariesAgreed: true })).data?.id;
await call('POST', `/companion/bookings/${sched}/accept`, Y.token);
L = await listed();
ok(L.freeNow ? L.freeNow.max === fitMax(at) || L.freeNow.max === fitMax(at) - 15 : fitMax(at) < 30, `a booking at ${new Date(at * 1000).toISOString().slice(11, 16)} UTC: up to ${L.freeNow?.max ?? 0} minutes now`);
await call('POST', `/companion/bookings/${sched}/cancel`, Y.token, { reason: 'Something else' });
sql(`UPDATE companions SET free_now_until = unixepoch() + 1500 WHERE user_id = '${YID}'`);
ok((await listed())?.freeNow === null, 'less than 30 minutes left: not free now');
sql(`UPDATE companions SET free_now_until = unixepoch() - 1 WHERE user_id = '${YID}'`);
prof = (await call('GET', '/companion', Y.token)).data;
ok(prof.freeNow.until === null, 'the time is up: off by itself');

// 10) Off
await call('PUT', '/companion/free-now', Y.token, { hours: 3 });
r = await call('DELETE', '/companion/free-now', Y.token);
ok(r.status === 200 && r.data.until === null && (await listed())?.freeNow === null && comp(YID).free_now_until === null, 'Yuki switches it off');

// Back to how it was
sql(`DELETE FROM hours_days WHERE companion_id = '${YID}'`);
await call('PATCH', '/me', Y.token, { pushToken: null, prefs: { pushBookings: true } });
pushMock.close();
console.log(failures ? `\n${failures} checks failed` : '\nAll free-now checks passed');
process.exit(failures ? 1 : 0);
