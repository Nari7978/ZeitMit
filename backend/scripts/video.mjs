// Video dates: who can join and when, the call room passing the setup between the two phones, the payment released
// after enough time on the call together, the call ending at the booked end, and the no-show rules.
// Runs against a LOCAL API started with a short release time, e.g.
//   npx wrangler dev --local --test-scheduled --var CALL_RELEASE_SECONDS:3
// with the demo companions seeded (it moves booking times in the local database). Usage: node scripts/video.mjs [api]
import { execSync } from 'node:child_process';

const [BASE = 'http://localhost:8787'] = process.argv.slice(2);
const CID = 'demo_yuki'; // offers video dates
let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? '✓' : '✗'} ${label}`); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(150); } return false; };

/** A call room socket that keeps what it receives. */
const join = (id, token) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/calls/${id}/ws?token=${encodeURIComponent(token)}`);
  const got = [];
  ws.onmessage = (e) => got.push(JSON.parse(e.data));
  ws.onopen = () => resolve({ ws, got, send: (m) => ws.send(JSON.stringify(m)), has: (type) => got.some((m) => m.type === type), closed: () => ws.readyState >= 2 });
  ws.onerror = () => reject(new Error('socket failed'));
});

const Y = await login('yuki@demo.zeitmit.app');
const C = await login(`video+${Date.now()}@example.com`);
await call('PATCH', '/me', C.token, { name: 'Cora Cam', ageConfirmed: true });
sql(`UPDATE users SET id_status = 'approved' WHERE id = '${C.user.id}'`);
const S = await login(`stranger+${Date.now()}@example.com`);
const left = (await call('GET', '/companion/bookings', Y.token)).data;
for (const x of [...left.requests, ...left.upcoming]) await call('POST', `/companion/bookings/${x.id}/cancel`, Y.token, { reason: 'Something else' });

/** Requests a video date at Yuki's next free video time; Yuki accepts it unless `accept` is false. */
const book = async (accept = true) => {
  const day = (await call('GET', `/companions/${CID}/times`)).data.video.find((d) => d.times.length);
  const r = await call('POST', '/bookings', C.token, { companionId: CID, act: 'call', date: day.date, time: day.times[0], dur: 1, place: 'Café Einstein', boundariesAgreed: true });
  if (accept && r.data?.id) await call('POST', `/companion/bookings/${r.data.id}/accept`, Y.token);
  return r.data.id;
};
/** Moves a booking so it started `ago` seconds ago (negative: starts later). */
const startedAgo = (id, ago) => sql(`UPDATE bookings SET starts_at = unixepoch() - ${ago} WHERE id = '${id}'`);

// 1) Booking a video date: a request, like any booking, until Yuki accepts
const id = await book(false);
let mine = (await call('GET', '/bookings', C.token)).data.find((b) => b.id === id);
ok(mine.status === 'pending' && mine.expiresAt <= mine.startsAt - 3 * 3600, 'a video date is a request too: Yuki has to accept at least 3 hours before');
let r = await call('POST', `/calls/${id}`, C.token);
ok(r.status === 409 && r.data?.error === 'Your video date opens once Yuki accepts.', 'it has no call until then');
r = await call('POST', `/companion/bookings/${id}/accept`, Y.token);
ok(r.status === 200, 'Yuki accepts');
mine = (await call('GET', '/bookings', C.token)).data.find((b) => b.id === id);
ok(mine.status === 'confirmed' && mine.place === '' && mine.otp === undefined, `a video date has no meeting place and no meet code (place “${mine.place}”, code ${mine.otp})`);
r = await call('POST', `/companion/bookings/${id}/verify-code`, Y.token, { code: '0000' });
ok(r.status === 409 && /confirmed by the call itself/.test(r.data?.error), `a meet code can’t confirm it (${r.status})`);
r = await call('POST', '/safety/checkins', C.token, { bookingId: id, contactName: 'Mum', contactPhone: '+49 30 1234567' });
ok(r.status === 409 && /Video dates happen in the app/.test(r.data?.error), 'no safety check-in for a video date');

// 2) Who can join, and when
r = await call('POST', `/calls/${id}`, C.token);
ok(r.status === 409 && r.data?.error === 'You can join from 10 minutes before the start.', 'too early to join');
startedAgo(id, 60);
r = await call('POST', `/calls/${id}`, C.token);
ok(r.status === 200 && r.data.side === 'customer' && r.data.peer === 'Yuki' && Array.isArray(r.data.iceServers) && r.data.iceServers[0].urls.some((u) => u.startsWith('stun:')),
  `the customer can join: with Yuki, free STUN servers (${JSON.stringify(r.data?.iceServers?.[0]?.urls)})`);
ok(r.data.releaseAfter === 3 && r.data.endsAt - r.data.startsAt === 3600, `ends at the booked end, payment after ${r.data.releaseAfter}s together (test setting)`);
r = await call('POST', `/calls/${id}`, Y.token);
ok(r.status === 200 && r.data.side === 'companion' && r.data.peer === 'Cora', 'the companion can join');
ok((await call('POST', `/calls/${id}`, S.token)).status === 404, 'nobody else can (404)');
const soonId = await book();
ok(row(soonId).status === 'confirmed', 'once accepted it’s confirmed');
startedAgo(soonId, -300);
r = await call('POST', `/calls/${soonId}`, C.token);
ok(r.status === 200, 'and opens 10 minutes before the start');
await call('POST', `/bookings/${soonId}/cancel`, C.token);
r = await call('POST', `/calls/${soonId}`, C.token);
ok(r.status === 409 && r.data?.error === 'This booking was cancelled.', 'a cancelled one doesn’t');
const declined = await book(false);
await call('POST', `/companion/bookings/${declined}/decline`, Y.token);
startedAgo(declined, -300);
r = await call('POST', `/calls/${declined}`, C.token);
ok(r.status === 409 && r.data?.error === 'This request was declined.' && row(declined).status === 'rejected', 'nor does a declined request at its time');
const coffee = (await call('GET', '/companions/demo_noah/slots')).data.find((d) => d.times.length);
const cof = (await call('POST', '/bookings', C.token, { companionId: 'demo_noah', act: 'movies', date: coffee.date, time: coffee.times[0], dur: 1, place: '' })).data.id;
ok((await call('POST', `/calls/${cof}`, C.token)).data?.error === 'This booking isn’t a video date.', 'only video dates have a call');
await call('POST', `/bookings/${cof}/cancel`, C.token);

// 3) The call room
const a = await join(id, C.token);
ok(await until(() => a.has('hello')) && a.got.find((m) => m.type === 'hello').peer === false, 'the customer is first in: told the companion isn’t there yet');
ok(await until(async () => (await call('GET', '/me/notifications', Y.token)).data.some((n) => n.go === `call:${id}` && n.title === 'Cora is waiting in your video date')), 'the companion hears Cora is waiting (opens the call)');
const b = await join(id, Y.token);
ok(await until(() => b.has('hello')) && b.got.find((m) => m.type === 'hello').peer === true && await until(() => a.has('peer-joined')), 'the companion joins: both know the other is there');
b.send({ type: 'signal', data: { description: { type: 'offer', sdp: 'v=0 test' } } });
a.send({ type: 'signal', data: { candidate: { candidate: 'candidate:1 1 udp 1 192.0.2.1 5000 typ host', sdpMid: '0' } } });
ok(await until(() => a.got.some((m) => m.type === 'signal' && m.data.description?.sdp === 'v=0 test') && b.got.some((m) => m.type === 'signal' && m.data.candidate)), 'the call setup passes between the two');
ok(!a.got.some((m) => m.type === 'signal' && m.data.candidate) && !b.got.some((m) => m.type === 'signal' && m.data.description), 'and never back to the sender');
a.send({ type: 'media', on: true });
await sleep(4000);
ok(row(id).status === 'confirmed', 'only one side with video: the clock doesn’t run');
b.send({ type: 'media', on: true });
ok(await until(() => a.has('confirmed') && b.has('confirmed'), 10000), 'both with video for 3s: both told the video date is confirmed');
const done = row(id);
ok(done.status === 'completed' && done.pay_status === 'released' && done.call_together_s >= 3, `payment released (${done.status}/${done.pay_status}, ${done.call_together_s}s together)`);
const notes = (await call('GET', '/me/notifications', C.token)).data;
ok(notes.some((n) => n.title === 'Video date confirmed' && /sent to Yuki/.test(n.body)), 'the customer gets “Video date confirmed”');
r = await call('POST', `/calls/${id}`, C.token);
ok(r.status === 200 && r.data.confirmed === true, 'the call carries on after that, until the booked end');
// A second phone of the same person takes over; hanging up tells the other side straight away
const a2 = await join(id, C.token);
ok(await until(() => a.has('replaced') && a.closed()) && await until(() => a2.has('hello')), 'joining again replaces the old connection');
ok(!b.got.some((m) => m.type === 'peer-left'), 'without the other side seeing them leave');
b.send({ type: 'bye' });
ok(await until(() => a2.got.some((m) => m.type === 'peer-left' && m.bye === true)), 'hanging up: the other side is told at once');
a2.ws.close();

// 4) The call ends at the booked end
const id2 = await book();
startedAgo(id2, 3600 - 4); // ends in 4s
const e1 = await join(id2, C.token), e2 = await join(id2, Y.token);
ok(await until(() => e1.has('ended') && e2.has('ended') && e1.closed() && e2.closed(), 12000), 'at the booked end the call ends for both');
r = await call('POST', `/calls/${id2}`, C.token);
ok(r.status === 409 && r.data?.error === 'This video date has ended.', 'and can’t be joined any more');

// 5) No-shows, settled once by the cron after the end
const noComp = await book();
startedAgo(noComp, 3700); // ended, nobody joined
const noCust = await book();
startedAgo(noCust, 3700);
sql(`UPDATE bookings SET call_companion_at = unixepoch() - 3000 WHERE id = '${noCust}'`);
const both = await book();
startedAgo(both, 3700);
sql(`UPDATE bookings SET call_companion_at = unixepoch() - 3000, call_customer_at = unixepoch() - 2900, call_together_s = 120 WHERE id = '${both}'`);
await cron();
await until(async () => row(noComp).status === 'cancelled' && row(noCust).status === 'cancelled', 10000);
const x1 = row(noComp), x2 = row(noCust), x3 = row(both);
ok(x1.status === 'cancelled' && x1.pay_status === 'refunded' && x1.cancelled_by === 'companion' && /^Yuki didn’t join the video date · €[\d.]+ refunded in full$/.test(x1.cancel_note),
  `the companion never joined: full refund (${x1.cancel_note})`);
ok(x2.status === 'cancelled' && x2.pay_status === 'released' && x2.cancelled_by === 'customer' && x2.cancel_note === 'You didn’t join the video date · no refund', 'only the companion joined: they keep the pay');
ok(x3.status === 'confirmed' && x3.pay_status === 'held' && x3.call_closed, 'both joined but under the time: left for the safety team to settle');
const cn = (await call('GET', '/me/notifications', C.token)).data;
ok(cn.some((n) => n.title === 'Yuki didn’t join your video date') && cn.some((n) => n.title === 'You missed your video date'), 'the customer is told each time');
const yn = (await call('GET', '/me/notifications', Y.token)).data;
ok(yn.some((n) => n.title === 'You missed a video date') && yn.some((n) => n.title === 'Cora didn’t join the video date'), 'and so is the companion');
await cron(); await sleep(1500);
ok(row(both).status === 'confirmed' && (await call('GET', '/me/notifications', C.token)).data.length === cn.length, 'each one is settled only once');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
