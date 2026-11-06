// Video dates and in-person dates each have their own hours and rules, on one clock: separate weekly hours and dates,
// video bookable from 15 minutes ahead and confirmed at once (free to cancel in its first 10 minutes), in-person
// requests from 2 hours ahead with 2 hours to reply (at the latest an hour before the start), and a booking of either
// kind blocking the companion for both. Runs against a LOCAL API with the demo companions seeded (it sets and removes
// Yuki's own hours for the next 7 days, and briefly lets Noah offer video dates). Usage: node scripts/kinds.mjs [api]
import { execSync } from 'node:child_process';

const [BASE = 'http://localhost:8787'] = process.argv.slice(2);
const YID = 'demo_yuki'; // offers video dates and in-person activities
const NID = 'demo_noah'; // in person only
let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? '✓' : '✗'} ${label}`); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(200); } return false; };
const call = async (method, path, token, body) => {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const login = async (email) => {
  const r = await call('POST', '/auth/request-code', null, { email });
  return (await call('POST', '/auth/verify', null, { email, code: r.data.devCode })).data;
};
const sql = (q) => execSync(`npx wrangler d1 execute DB --local --command "${q}"`, { stdio: 'pipe' });
const row = (id) => JSON.parse(execSync(`npx wrangler d1 execute DB --local --json --command "SELECT * FROM bookings WHERE id = '${id}'"`, { stdio: 'pipe' }).toString())[0].results[0];
const cron = () => fetch(`${BASE}/__scheduled?cron=*/10+*+*+*+*`);
const berlin = (days) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + days * 86400000));
const clock = (unix) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(unix * 1000));
/** Seconds since midnight in Berlin right now. */
const secOfDay = () => { const [h, m, s] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date()).split(':').map(Number); return h * 3600 + m * 60 + s; };
const mins = (t) => +t.slice(0, 2) * 60 + +t.slice(3);
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const Y = await login('yuki@demo.zeitmit.app');
const N = await login('noah@demo.zeitmit.app');
const customer = async (name) => {
  const u = await login(`kinds+${name.toLowerCase()}+${Date.now()}@example.com`);
  await call('PATCH', '/me', u.token, { name, ageConfirmed: true });
  sql(`UPDATE users SET id_status = 'approved' WHERE id = '${u.user.id}'`);
  return u.token;
};
const A = await customer('Anna'), B = await customer('Ben');
// A clean week for Yuki: no open bookings, and video dates other suites confirmed today moved out of the way.
const open = (await call('GET', '/companion/bookings', Y.token)).data;
for (const x of [...open.requests, ...open.upcoming]) await call('POST', `/companion/bookings/${x.id}/cancel`, Y.token, { reason: 'Something else' });
sql(`UPDATE bookings SET starts_at = starts_at - 30 * 86400 WHERE companion_id = '${YID}' AND status = 'completed' AND starts_at > unixepoch() - 9 * 3600`);

const times = async (cid = YID) => (await call('GET', `/companions/${cid}/times`)).data;
const listed = async (cid = YID) => (await call('GET', '/companions')).data.find((c) => c.id === cid);
const on = (list, date) => list.find((d) => d.date === date);
const book = (token, act, date, time, dur = 1) => call('POST', '/bookings', token, { companionId: YID, act, date, time, dur, place: '', boundariesAgreed: true });
const notes = async (token) => (await call('GET', '/me/notifications', token)).data;
const setWeek = async (kind, rangesFor) => { for (let i = 0; i < 7; i++) await call('PUT', `/companion/dates/${berlin(i)}`, Y.token, { ranges: rangesFor(berlin(i)), kind }); };

// 1) Separate hours: in person 18:00–22:00, video 20:00–24:00, in three days; nothing else this week
const day = berlin(3);
await setWeek('meet', (d) => (d === day ? [['18:00', '22:00']] : []));
await setWeek('video', (d) => (d === day ? [['20:00', '24:00']] : []));
let T = await times();
ok(on(T.meet, day).times[0] === '18:00' && on(T.meet, day).times.at(-1) === '21:00', `in-person hours: starts 18:00 to 21:00 (${on(T.meet, day).times.join(', ')})`);
ok(on(T.video, day).times[0] === '20:00' && on(T.video, day).times.at(-1) === '23:00', `video hours apart: starts 20:00 to 23:00 (${on(T.video, day).times.join(', ')})`);
ok([...T.meet, ...T.video].filter((d) => d.date !== day).every((d) => !d.times.length), 'nothing else open this week, for either');
const prof = (await call('GET', '/companion', Y.token)).data;
ok(on(prof.dates, day)?.ranges[0][0] === '18:00' && on(prof.datesVideo, day)?.ranges[0][0] === '20:00', 'Yuki’s own view keeps both kinds’ hours apart');
let L = await listed();
ok(clock(L.free.meet.next) === '18:00' && clock(L.free.video.next) === '20:00' && clock(L.next) === '18:00', `the list: next free in person 18:00, video 20:00 (${clock(L.free.meet.next)}, ${clock(L.free.video.next)})`);
const noah = await listed(NID);
const noahTimes = await times(NID);
ok(noah.free.video === null && noah.free.meet !== null && noahTimes.video === null && Array.isArray(noahTimes.meet), 'Noah offers no video dates: no video times at all');
ok(on((await call('GET', `/companions/${YID}/slots`)).data, day).times[0] === '18:00', 'older app versions still get one list (the in-person times)');

// 2) One clock: an in-person booking blocks video times too, and the other way round
let r = await book(A, 'coffee', day, '20:00', 2);
const coffee = r.data?.id;
ok(r.status === 201 && r.data.status === 'pending', 'Anna requests coffee 20:00–22:00 (in person: a request)');
T = await times();
ok(on(T.video, day).times[0] === '22:00', `one clock: video now from 22:00 (${on(T.video, day).times.join(', ')})`);
r = await book(B, 'call', day, '21:00');
ok(r.status === 409, 'Ben can’t book a video date inside Anna’s coffee');
await call('POST', `/bookings/${coffee}/cancel`, A, { reason: 'Plans changed' });

// 3) Video dates are confirmed the moment they're booked
r = await book(B, 'call', day, '20:00');
const vid = r.data?.id;
ok(r.status === 201 && r.data.status === 'confirmed', `Ben’s video date at 20:00 is confirmed at once (${r.data?.status})`);
const yb = (await call('GET', '/companion/bookings', Y.token)).data;
ok(yb.upcoming.some((x) => x.id === vid) && !yb.requests.some((x) => x.id === vid), 'Yuki finds it in her upcoming bookings, not among requests');
ok((await notes(B)).some((n) => n.title === 'Video date with Yuki booked'), 'Ben: “Video date with Yuki booked”');
ok((await notes(Y.token)).some((n) => n.title === 'New video date booked' && n.go === 'comp:calendar'), 'Yuki: “New video date booked”');
T = await times();
const meetNow = on(T.meet, day).times;
ok(!meetNow.includes('19:30') && !meetNow.includes('20:00') && !meetNow.includes('20:30') && meetNow.includes('19:00') && meetNow.includes('21:00'), `and it blocks her in person too, 20:00–21:00 (${meetNow.join(', ')})`);
r = await call('GET', `/bookings/${vid}/reschedule`, B);
ok(on(r.data.slots, day).times[0] === '20:00', `moving it offers her video times (${on(r.data.slots, day).times.join(', ')})`);

// 4) Free to cancel in the first 10 minutes, even close to the start
sql(`UPDATE bookings SET starts_at = unixepoch() + 3 * 3600 WHERE id = '${vid}'`);
let mine = (await call('GET', '/bookings', B)).data.find((x) => x.id === vid);
ok(mine.freeUntil === row(vid).created_at + 600, `starting in 3 hours: free to cancel until 10 minutes after booking (${clock(mine.freeUntil)})`);
r = await call('POST', `/bookings/${vid}/cancel`, B, { reason: 'Booked by mistake' });
ok(r.status === 200 && r.data.late === false && r.data.refunded === row(vid).total, `cancelled at once: refunded in full (${r.data?.refunded})`);
r = await book(B, 'call', day, '22:00');
const vid2 = r.data.id;
sql(`UPDATE bookings SET starts_at = unixepoch() + 3 * 3600, created_at = unixepoch() - 660 WHERE id = '${vid2}'`);
r = await call('POST', `/bookings/${vid2}/cancel`, B, { reason: 'Plans changed' });
ok(r.status === 200 && r.data.late === true && r.data.refunded === 0, 'after 10 minutes, and less than 24 hours before: no refund');

// 5) In-person requests: 2 hours to reply, then refunded
r = await book(A, 'coffee', day, '18:00');
const req = r.data.id;
ok(r.data.status === 'pending' && r.data.replyBy === row(req).created_at + 7200, `a request: Yuki has 2 hours to reply (until ${clock(r.data.replyBy)})`);
ok((await notes(A)).some((n) => n.title === 'Request sent to Yuki' && /has until (.+ · )?\d\d:\d\d to reply\.$/.test(n.body)), 'Anna is told until when Yuki can reply');
ok((await notes(Y.token)).some((n) => n.title === 'New booking request' && /Reply by (.+ · )?\d\d:\d\d\./.test(n.body)), 'Yuki is told to reply by then');
sql(`UPDATE bookings SET created_at = unixepoch() - 7300 WHERE id = '${req}'`);
await cron();
ok(await until(() => row(req).status === 'cancelled'), 'no reply in 2 hours: the cron cancels it');
ok(row(req).pay_status === 'refunded' && (await notes(A)).some((n) => n.title === 'Request expired' && /Yuki didn’t reply in time/.test(n.body)), 'Anna is refunded and told');
ok((await notes(Y.token)).some((n) => n.title === 'Request expired' && /wasn’t answered in time/.test(n.body)), 'Yuki is told it expired');
ok(on((await times()).meet, day).times[0] === '18:00', 'and 18:00 is free again');

// 6) Accepting too late doesn't work (the cron may not have run yet)
r = await book(A, 'coffee', day, '18:00');
const late = r.data.id;
sql(`UPDATE bookings SET created_at = unixepoch() - 7201 WHERE id = '${late}'`);
r = await call('POST', `/companion/bookings/${late}/accept`, Y.token);
ok(r.status === 409 && /expired/.test(r.data?.error) && row(late).status === 'cancelled', `accepting after the reply time: “${r.data?.error}”, and it’s refunded`);

// 7) A date starting soon: until an hour before the start to reply
r = await book(A, 'coffee', day, '18:00');
const soon = r.data.id;
sql(`UPDATE bookings SET starts_at = unixepoch() + 9000 WHERE id = '${soon}'`);
mine = (await call('GET', '/bookings', A)).data.find((x) => x.id === soon);
ok(mine.replyBy === mine.startsAt - 3600, `starting in 2½ hours: Yuki has until an hour before (${clock(mine.replyBy)}) to reply`);
r = await call('POST', `/companion/bookings/${soon}/accept`, Y.token);
ok(r.status === 200 && row(soon).status === 'confirmed', 'accepting in time works');
await call('POST', `/companion/bookings/${soon}/cancel`, Y.token, { reason: 'Something else' });

// 8) Yuki answers a request with another time: it waits for Anna's answer, past the 2 hours
r = await book(A, 'coffee', day, '18:00');
const counter = r.data.id;
r = await call('POST', `/bookings/${counter}/reschedule`, Y.token, { date: day, time: '19:00' });
ok(r.status === 200 && r.data.moved === false, 'Yuki suggests 19:00 instead');
sql(`UPDATE bookings SET created_at = unixepoch() - 7300 WHERE id = '${counter}'`);
await cron();
await sleep(1500);
ok(row(counter).status === 'pending', 'past 2 hours, the request still waits for Anna’s answer to the new time');
r = await call('POST', `/bookings/${counter}/reschedule/accept`, A);
ok(r.status === 200 && r.data.confirmed === true && row(counter).status === 'confirmed', 'Anna accepts: confirmed for 19:00');
await call('POST', `/companion/bookings/${counter}/cancel`, Y.token, { reason: 'Something else' });

// 9) Notice: video from 15 minutes ahead, in person from 2 hours ahead (both open 06:00–24:00 today)
const today = berlin(0);
for (const kind of ['meet', 'video']) await call('PUT', `/companion/dates/${today}`, Y.token, { ranges: [['06:00', '24:00']], kind });
const first = (sec, lead) => { for (let m = 6 * 60; m + 60 <= 24 * 60; m += 30) if (m * 60 >= sec + lead) return hhmm(m); return undefined; };
const s0 = secOfDay();
T = await times();
const s1 = secOfDay();
const fits = (got, lead) => [first(s0, lead), first(s1, lead)].includes(got);
ok(fits(on(T.video, today).times[0], 15 * 60), `video today from ${on(T.video, today).times[0] ?? 'nothing'} (15 minutes ahead at the earliest)`);
ok(fits(on(T.meet, today).times[0], 2 * 3600), `in person today from ${on(T.meet, today).times[0] ?? 'nothing'} (2 hours ahead at the earliest)`);
const vFirst = on(T.video, today).times[0];
ok(!vFirst || s1 + 900 < 6 * 3600 || mins(vFirst) * 60 - s1 < 46 * 60, 'a video date can start within the next 45 minutes');

// 10) Video hours are changed apart from in-person hours
const had = prof.availVideo.includes('Sun-am');
await call('PUT', '/companion/availability', Y.token, { day: 'Sun', win: 'am', on: !had, kind: 'video' });
const p2 = (await call('GET', '/companion', Y.token)).data;
ok(p2.availVideo.includes('Sun-am') === !had && p2.avail.includes('Sun-am') === prof.avail.includes('Sun-am'), 'a video-hours toggle leaves the in-person hours alone');
await call('PUT', '/companion/availability', Y.token, { day: 'Sun', win: 'am', on: had, kind: 'video' });
await call('DELETE', `/companion/dates/${day}?kind=video`, Y.token);
const p3 = (await call('GET', '/companion', Y.token)).data;
ok(!on(p3.datesVideo, day) && on(p3.dates, day), 'back to weekly video hours on a date: its in-person hours stay');

// 11) Starting video dates: video hours begin as a copy of the weekly in-person hours
const n0 = (await call('GET', '/companion', N.token)).data;
sql(`DELETE FROM availability_video WHERE companion_id = '${NID}'`);
await call('PATCH', '/companion', N.token, { acts: [...n0.acts, 'call'] });
const n1 = (await call('GET', '/companion', N.token)).data;
ok(n1.availVideo.length > 0 && [...n1.availVideo].sort().join() === [...n1.avail].sort().join(), `Noah adds video dates: his video hours start as his weekly hours (${n1.availVideo.length} windows)`);
ok(Array.isArray((await times(NID)).video), 'and he has video times');
await call('PATCH', '/companion', N.token, { acts: n0.acts });
sql(`DELETE FROM availability_video WHERE companion_id = '${NID}'`);
ok((await times(NID)).video === null, 'without video dates again: no video times');

// Clean up: Yuki back to her weekly hours
for (const x of (await call('GET', '/companion/bookings', Y.token)).data.upcoming) await call('POST', `/companion/bookings/${x.id}/cancel`, Y.token, { reason: 'Something else' });
for (let i = 0; i < 7; i++) for (const kind of ['meet', 'video']) await call('DELETE', `/companion/dates/${berlin(i)}?kind=${kind}`, Y.token);
L = await listed();
ok(L.free.meet.next !== null && L.free.video.next !== null, 'own hours removed: Yuki is free again on her weekly hours, both kinds');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
