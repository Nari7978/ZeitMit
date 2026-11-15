// Short notice: video dates from 20 minutes ahead and in person from 1½ hours (each companion can ask for more:
// 1 or 4 hours for video, 4 hours or a day in person). A request less than 3 hours away has to be answered within 10
// minutes (video) or 30 minutes (in person), and at least 10 minutes / 1 hour before the start; the companion's phone
// rings for it (a high-priority push, whatever their push settings say). Not answered in time, it's refunded in full.
// Requests further ahead keep the old rule (24 hours, at least 3 hours before the start). Once accepted, the customer
// has 10 minutes to change their mind (everything back but the service fee). Moving a booking still needs 3½ hours.
// Runs against a LOCAL API with the demo companions seeded and pushes sent to this script:
//   npx wrangler dev --local --test-scheduled --var EXPO_PUSH_URL:http://localhost:8798/push
// It opens Yuki's whole day today and the next two days, and removes those hours again at the end.
// Usage: node scripts/short-notice.mjs [api]
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';

const [BASE = 'http://localhost:8787'] = process.argv.slice(2);
const YID = 'demo_yuki';
const TZ = 'Europe/Berlin';
const TOKEN = 'ExponentPushToken[short-notice-test]';
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
const row = (id) => JSON.parse(execSync(`npx wrangler d1 execute DB --local --json --command "SELECT * FROM bookings WHERE id = '${id}'"`, { stdio: 'pipe' }).toString())[0].results[0];
const cron = () => fetch(`${BASE}/__scheduled?cron=*/10+*+*+*+*`);
const berlin = (days) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + days * 86400000));
const clock = (unix) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(unix * 1000));
const nowS = () => Math.floor(Date.now() / 1000);
/** The first 15-minute start at least `s` seconds from now (plus a minute, so a slow request doesn't make it too soon). */
const from = (s) => Math.ceil((nowS() + s + 60) / 900) * 900;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
const pushesTitled = (re) => pushes.filter((p) => p.to === TOKEN && re.test(p.title));

const Y = await login('yuki@demo.zeitmit.app');
const customer = async (name) => {
  const u = await login(`short+${name.toLowerCase()}+${Date.now()}@example.com`);
  await call('PATCH', '/me', u.token, { name, ageConfirmed: true });
  sql(`UPDATE users SET id_status = 'approved' WHERE id = '${u.user.id}'`);
  return u.token;
};
const A = await customer('Asha'), B = await customer('Bo');
const book = (token, act, startsAt, minutes = 60) => call('POST', '/bookings', token, { companionId: YID, act, startsAt, minutes, place: '', boundariesAgreed: true });
const accept = (id) => call('POST', `/companion/bookings/${id}/accept`, Y.token);
const notes = async (token) => (await call('GET', '/me/notifications', token)).data;
const avail = async () => (await call('GET', `/companions/${YID}/availability`)).data;
const mine = async (token, id) => {
  const d = (await call('GET', '/bookings', token)).data;
  return (Array.isArray(d) ? d : [...(d?.upcoming ?? []), ...(d?.pending ?? []), ...(d?.past ?? []), ...(d?.cancelled ?? [])]).find((x) => x.id === id);
};

// A clean slate: no open bookings for Yuki, whole days open (both kinds), the default notice, pushes on this test phone
// with booking pushes turned off (so only the urgent ones come through).
const open = (await call('GET', '/companion/bookings', Y.token)).data;
for (const x of [...open.requests, ...open.upcoming]) await call('POST', `/companion/bookings/${x.id}/cancel`, Y.token, { reason: 'Something else' });
sql(`UPDATE bookings SET starts_at = starts_at - 30 * 86400 WHERE companion_id = '${YID}' AND status IN ('completed', 'confirmed') AND starts_at > unixepoch() - 9 * 3600`);
sql(`DELETE FROM hours_days WHERE companion_id = '${YID}'; DELETE FROM hours_blocks WHERE companion_id = '${YID}'`);
for (let i = 0; i <= 2; i++) await call('PUT', `/companion/hours/days/${berlin(i)}`, Y.token, { ranges: [{ from: '00:00', to: '24:00' }] });
await call('PATCH', '/companion', Y.token, { notice: { video: 20, meet: 90 } });
await call('PATCH', '/me', Y.token, { pushToken: TOKEN, prefs: { pushBookings: false } });

// 1) How soon: video from 20 minutes ahead, in person from 1½ hours (Yuki's notice is the default)
let prof = (await call('GET', '/companion', Y.token)).data;
ok(same(prof.notice, { video: 20, meet: 90 }) && same(prof.noticeOptions?.video, [20, 60, 240]) && same(prof.noticeOptions?.meet, [90, 240, 1440]),
  `Yuki’s notice is the default: 20 minutes for video, 1½ hours in person (${JSON.stringify(prof.notice)})`);
let a = await avail();
const step = (u) => Math.ceil(u / 900) * 900;
ok(a.kinds.video.lead === 1200 && a.kinds.meet.lead === 5400, `the free time says so: ${a.kinds.video.lead / 60} and ${a.kinds.meet.lead / 60} minutes`);
ok(a.kinds.video.earliest === step(a.now + 1200) && a.kinds.meet.earliest === step(a.now + 5400), 'the first start of each kind: the next 15-minute step after that');
ok(a.kinds.video.open[0]?.[0] === a.kinds.video.earliest && a.kinds.meet.open[0]?.[0] === a.kinds.meet.earliest, 'free from then on (the whole day is open)');
ok(a.earliest === a.kinds.video.earliest, 'the soonest of the two for app versions before this (they still ask 3½ hours themselves)');
ok(await until(async () => {
  const L = (await call('GET', '/companions')).data.find((c) => c.id === YID);
  return L?.free?.video?.next === a.kinds.video.earliest && L?.free?.meet?.next === a.kinds.meet.earliest;
}), 'the list’s “next free” is that soon too');
let r = await book(A, 'call', step(nowS() + 1200) - 900, 30);
ok(r.status === 400 && r.data?.error === 'Pick a time at least 20 minutes from now.', `a video date sooner than 20 minutes is refused (${r.data?.error})`);
r = await book(A, 'coffee', step(nowS() + 5400) - 900, 60);
ok(r.status === 400 && r.data?.error === 'Pick a time at least 1½ hours from now.', `in person sooner than 1½ hours is refused (${r.data?.error})`);

// 2) A video date in about half an hour: 10 minutes to answer, and Yuki's phone rings although booking pushes are off
const vStart = from(1200);
r = await book(A, 'call', vStart, 30);
const vid = r.data?.id;
ok(r.status === 201 && r.data.status === 'pending', `Asha requests a video date at ${clock(vStart)} (${r.data?.status ?? r.data?.error})`);
let v = row(vid);
ok(v.expires_at === v.created_at + 600, `Yuki has 10 minutes to answer (until ${clock(v.expires_at)})`);
ok((await mine(A, vid))?.expiresAt === v.expires_at, 'Asha’s booking says until when');
ok((await notes(A)).some((n) => n.title === 'Request sent to Yuki' && n.body.endsWith(`has until ${clock(v.expires_at)} to accept.`)), 'and so does her notification');
ok(await until(() => pushesTitled(/^Answer within 10 min: new request$/).length === 1), 'Yuki’s phone rings: “Answer within 10 min: new request”');
let ring = pushesTitled(/^Answer within 10 min/)[0];
ok(ring?.priority === 'high' && ring.sound === 'default' && ring.ttl > 540 && ring.ttl <= 600, `a high-priority push with sound, dropped when the time is up (ttl ${ring?.ttl} s)`);
ok(/Accept by \d\d:\d\d\./.test(ring?.body ?? '') && ring?.data?.go === 'comp:requests', 'it says until when and opens the requests');
ok((await notes(Y.token)).some((n) => n.title === 'Answer within 10 min: new request'), 'it’s in Yuki’s notifications too');
let yb = (await call('GET', '/companion/bookings', Y.token)).data;
ok(yb.requests.find((x) => x.id === vid)?.expiresAt === v.expires_at, 'Yuki’s request shows until when');

// 3) Not answered in time: too late to accept, refunded in full
sql(`UPDATE bookings SET created_at = created_at - 601 WHERE id = '${vid}'`);
r = await accept(vid);
ok(r.status === 409 && r.data?.error === 'Too late to accept: the time to answer this request has run out. It has expired and the customer was refunded.', `after the 10 minutes Yuki can’t accept (${r.data?.error})`);
v = row(vid);
ok(v.status === 'expired' && v.pay_status === 'refunded' && v.refunded === v.total, 'it has expired, refunded in full');
ok((await notes(A)).some((n) => n.title === 'Request expired' && /didn’t reply in time, so .+ is refunded in full\.$/.test(n.body)), 'Asha is told');

// 4) In person in about 1½ hours: 30 minutes to answer, rings; accepted in time
const mStart = from(5400);
r = await book(B, 'coffee', mStart, 60);
const mid = r.data?.id;
let m = row(mid);
ok(r.status === 201 && m.expires_at === m.created_at + 1800, `Bo requests coffee at ${clock(mStart)}: 30 minutes to answer`);
ok(await until(() => pushesTitled(/^Answer within 30 min: new request$/).length === 1), 'Yuki’s phone rings: “Answer within 30 min”');
ok((r = await accept(mid)).status === 200, `Yuki accepts in time (${r.data?.error ?? 'ok'})`);
m = row(mid);

// 5) Changing your mind: 10 minutes after the companion accepts, everything back but the service fee
let mb = await mine(B, mid);
ok(mb?.freeUntil === m.decided_at + 600, `Bo can cancel for a refund until 10 minutes after Yuki accepted (${clock(mb?.freeUntil)})`);
r = await call('POST', `/bookings/${mid}/cancel`, B, { reason: 'Plans changed' });
m = row(mid);
ok(r.status === 200 && !r.data.late && r.data.refunded === m.total - m.fee && r.data.feeKept === m.fee, `he changes his mind: ${r.data?.refunded} back, the ${r.data?.feeKept} fee kept`);
ok(m.status === 'cancelled' && m.refunded === m.total - m.fee, 'cancelled, the rest refunded');
// After the 10 minutes it's a late cancellation (less than 24 hours before): no refund
const m2Start = from(5400) + 3600;
const m2 = (await book(B, 'coffee', m2Start, 60)).data?.id;
await accept(m2);
sql(`UPDATE bookings SET decided_at = decided_at - 601 WHERE id = '${m2}'`);
mb = await mine(B, m2);
ok(mb?.freeUntil <= nowS(), 'another one, accepted 10 minutes ago: the free time is over');
r = await call('POST', `/bookings/${m2}/cancel`, B, { reason: 'Plans changed' });
ok(r.status === 200 && r.data.late === true && r.data.refunded === 0, `cancelling now is late: no refund (${JSON.stringify(r.data)})`);
// Further ahead than a day: the 24-hour rule as before
const farStart = step(nowS() + 30 * 3600);
const far = (await book(B, 'coffee', farStart, 60)).data?.id;
await accept(far);
ok((await mine(B, far))?.freeUntil === farStart - 24 * 3600, 'a booking more than a day ahead: free to cancel until 24 hours before, as before');
await call('POST', `/bookings/${far}/cancel`, B, { reason: 'Plans changed' });

// 6) Requests further ahead: the old rule, no ringing (Yuki turned booking pushes off)
const before = pushes.length;
const later = (await book(A, 'coffee', step(nowS() + 5 * 3600), 60)).data?.id;
const l = row(later);
ok(l.expires_at === l.starts_at - 3 * 3600, `5 hours ahead: until 3 hours before the start (${clock(l.expires_at)})`);
await sleep(1500);
ok(pushes.length === before && (await notes(Y.token)).some((n) => n.title === 'New booking request'), 'no ringing: just “New booking request” in the app');
// Just over 3 hours ahead: 30 minutes to answer (not the few minutes left before the 3-hour mark), and it rings
const rung = pushesTitled(/^Answer within 30 min: new request$/).length;
const edge = (await book(A, 'coffee', from(3 * 3600), 60)).data?.id;
const e = row(edge);
ok(e.expires_at === e.created_at + 1800 && e.starts_at - 3 * 3600 < e.expires_at, `just over 3 hours ahead: 30 minutes to answer, not ${Math.round((e.starts_at - 3 * 3600 - e.created_at) / 60)}`);
ok(await until(() => pushesTitled(/^Answer within 30 min: new request$/).length === rung + 1), 'and Yuki’s phone rings for it');
await call('POST', `/bookings/${later}/cancel`, A, { reason: 'Plans changed' });
await call('POST', `/bookings/${edge}/cancel`, A, { reason: 'Plans changed' });

// 7) The cron closes unanswered short-notice requests on time
const v2 = (await book(A, 'call', from(1200) + 900, 30)).data?.id;
sql(`UPDATE bookings SET created_at = created_at - 601 WHERE id = '${v2}'`);
await cron();
ok(await until(() => row(v2).status === 'expired'), 'the cron closes a request nobody answered in time');
ok(row(v2).pay_status === 'refunded', 'refunded in full');

// 8) Moving a booking still needs 3½ hours
const mv = (await book(A, 'coffee', step(nowS() + 6 * 3600), 60)).data?.id;
r = await call('GET', `/bookings/${mv}/reschedule`, A);
ok(r.status === 200 && r.data.availability?.kinds?.meet?.lead === 3.5 * 3600 && r.data.availability.kinds.meet.earliest >= nowS() + 3.5 * 3600, 'the times to move to start 3½ hours ahead');
r = await call('POST', `/bookings/${mv}/reschedule`, A, { startsAt: from(5400) });
ok(r.status === 400 && r.data?.error === 'Pick a time at least 3½ hours from now.', `moving it to 1½ hours from now is refused (${r.data?.error})`);
r = await call('POST', `/bookings/${mv}/reschedule`, A, { startsAt: from(3.5 * 3600) });
ok(r.status === 200 && r.data.moved === true, `moving it to 3½ hours from now works (${r.data?.error ?? 'moved'})`);
await call('POST', `/bookings/${mv}/cancel`, A, { reason: 'Plans changed' });

// 9) Yuki asks for more notice
r = await call('PATCH', '/companion', Y.token, { notice: { video: 60 } });
ok(r.status === 200, 'Yuki asks for 1 hour’s notice for video dates');
prof = (await call('GET', '/companion', Y.token)).data;
ok(same(prof.notice, { video: 60, meet: 90 }), 'saved, in person unchanged');
a = await avail();
ok(a.kinds.video.lead === 3600 && a.kinds.video.earliest === step(a.now + 3600), 'video dates now start an hour ahead at the earliest');
r = await book(A, 'call', from(1200), 30);
ok(r.status === 400 && r.data?.error === 'Pick a time at least 1 hour from now.', `half an hour ahead is refused (${r.data?.error})`);
ok(await until(async () => (await call('GET', '/companions')).data.find((c) => c.id === YID)?.free?.video?.next === a.kinds.video.earliest), 'the list’s next free video date moves too');
r = await call('PATCH', '/companion', Y.token, { notice: { meet: 1440 } });
a = await avail();
ok(r.status === 200 && a.kinds.meet.lead === 86400, 'a day’s notice in person');
r = await book(A, 'coffee', step(nowS() + 5 * 3600), 60);
ok(r.status === 400 && r.data?.error === 'Pick a time at least 1 day from now.', `5 hours ahead is refused (${r.data?.error})`);
r = await call('PATCH', '/companion', Y.token, { notice: { video: 7 } });
ok(r.status === 400 && r.data?.error === 'Choose one of the notice options.', 'only the offered options');
r = await call('PATCH', '/companion', Y.token, { notice: { video: 240, meet: 240 } });
a = await avail();
ok(r.status === 200 && a.kinds.video.lead === 4 * 3600 && a.kinds.meet.lead === 4 * 3600, '4 hours for both');
// Moving needs whichever is more: 3½ hours or the companion's notice
const mv2 = (await book(A, 'coffee', step(nowS() + 8 * 3600), 60)).data?.id;
r = await call('POST', `/bookings/${mv2}/reschedule`, A, { startsAt: from(3.5 * 3600) });
ok(r.status === 400 && r.data?.error === 'Pick a time at least 4 hours from now.', `with 4 hours’ notice, moving needs 4 hours (${r.data?.error})`);
await call('POST', `/bookings/${mv2}/cancel`, A, { reason: 'Plans changed' });

// Back to how it was
await call('PATCH', '/companion', Y.token, { notice: { video: 20, meet: 90 } });
await call('PATCH', '/me', Y.token, { pushToken: null, prefs: { pushBookings: true } });
sql(`DELETE FROM hours_days WHERE companion_id = '${YID}'`);
pushMock.close();
console.log(failures ? `\n${failures} checks failed` : '\nAll short-notice checks passed');
process.exit(failures ? 1 : 0);
