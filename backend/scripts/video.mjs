// Video dates: who can join and when, ringing and pinging the other person, the call room passing the setup between
// the two phones, the call ending at the booked end and the payment settled right after by who was there (the
// companion paid in full unless they weren't there while the customer was; ZeitMit's fee kept once accepted), and
// the no-show rules.
// Runs against a LOCAL API started with a short wait, whole-second pay steps and a short ping gap, with pushes sent to
// this script, e.g.
//   npx wrangler dev --local --test-scheduled --var CALL_WAIT_SECONDS:3 --var CALL_PAY_STEP_SECONDS:1 --var CALL_PING_GAP_SECONDS:2 --var EXPO_PUSH_URL:http://localhost:8798/push
// with the demo companions seeded (it moves booking times in the local database). Usage: node scripts/video.mjs [api]
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';

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
const rowsOf = (ids) => JSON.parse(execSync(`npx wrangler d1 execute DB --local --json --command "SELECT * FROM bookings WHERE id IN (${ids.map((i) => `'${i}'`).join(', ')})"`, { stdio: 'pipe' }).toString())[0].results;
const row = (id) => rowsOf([id])[0];
/** Amounts as the API writes them (whole euros without cents). */
const eur = (c) => '€' + (Number.isInteger(c / 100) ? c / 100 : (c / 100).toFixed(2));
const cron = () => fetch(`${BASE}/__scheduled?cron=*/10+*+*+*+*`);
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(150); } return false; };

// The push service (EXPO_PUSH_URL points here): keeps every push the API sends.
const pushes = [];
const pushMock = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try { pushes.push(JSON.parse(body)); } catch { /* not JSON */ }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"data":{"status":"ok"}}');
  });
}).listen(8798);

/** A socket (a call room, or someone's live updates) that keeps what it receives. */
const socket = (path, token) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}${path}?token=${encodeURIComponent(token)}`);
  const got = [];
  ws.onmessage = (e) => got.push(JSON.parse(e.data));
  ws.onopen = () => resolve({ ws, got, send: (m) => ws.send(JSON.stringify(m)), has: (type) => got.some((m) => m.type === type), closed: () => ws.readyState >= 2 });
  ws.onerror = () => reject(new Error('socket failed'));
});
const join = (id, token) => socket(`/calls/${id}/ws`, token);

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
ok(r.data.wait === 3 && r.data.endsAt - r.data.startsAt === 3600 && r.data.releaseAfter === undefined, `ends at the booked end; whoever waits ${r.data.wait}s for the other is covered (test setting)`);
r = await call('POST', `/calls/${id}`, Y.token);
ok(r.status === 200 && r.data.side === 'companion' && r.data.peer === 'Cora', 'the companion can join');
ok((await call('POST', `/calls/${id}`, S.token)).status === 404, 'nobody else can (404)');
const soonId = await book();
ok(row(soonId).status === 'confirmed', 'once accepted it’s confirmed');
startedAgo(soonId, -300);
r = await call('POST', `/calls/${soonId}`, C.token);
ok(r.status === 200, 'and opens 10 minutes before the start');
const early = await join(soonId, C.token);
await until(() => early.has('hello'));
r = await call('POST', `/calls/${soonId}/ping`, C.token);
ok(r.status === 409 && r.data?.error === 'You can ping Yuki once the video date starts.', 'joining early rings once, but pings start at the booked time');
early.ws.close();
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

// 2b) Ringing the other person: each time someone is in the call alone (not again for a quick reconnect), and when
// they ping; live in the open app, by push whatever the push settings say, one notification per call
await call('PATCH', '/me', Y.token, { pushToken: 'ExponentPushToken[video-test]', prefs: { pushBookings: false } });
const rid = await book();
startedAgo(rid, 60);
const yl = await socket('/live', Y.token);
const rings = (why) => yl.got.filter((m) => m.type === 'ring' && m.bookingId === rid && (!why || m.why === why));
const ringPushes = () => pushes.filter((p) => p.data?.kind === 'ring' && p.data.bookingId === rid);
const c1 = await join(rid, C.token);
ok(await until(() => c1.has('hello')), 'Cora joins the video date before Yuki');
r = await call('POST', `/calls/${rid}/ping`, C.token);
ok(r.status === 429 && /^You can ping Yuki again in [12] seconds?\.$/.test(r.data?.error), `pinging straight away: too soon (“${r.data?.error}”)`);
const hi = c1.got.find((m) => m.type === 'hello');
ok(hi.peer === false && hi.pingsLeft === 10 && hi.pingIn >= 1 && hi.pingIn <= 2, `alone: Yuki’s phone rings, and Cora can ping again in ${hi.pingIn}s (10 pings left)`);
ok(await until(() => rings('join').length === 1), 'Yuki’s open app rings at once (live)');
const ring1 = rings('join')[0];
ok(ring1.who === 'Cora' && ring1.endsAt === row(rid).starts_at + 3600 && typeof ring1.at === 'number', `saying who's waiting and until when (${ring1.who})`);
ok(await until(() => ringPushes().length === 1), 'a push goes out too, though Yuki turned off booking pushes');
const p1 = ringPushes()[0];
ok(p1.to === 'ExponentPushToken[video-test]' && p1.title === 'Cora is waiting in your video date' && p1.body === 'Tap to join the call.' && p1.data.go === `call:${rid}`
  && p1.priority === 'high' && p1.channelId === undefined && p1.sound === 'default' && p1.ttl > 0 && p1.ttl <= 300 && p1.data.at === ring1.at,
  `high priority with sound, on the channel every app version has, opening the call (ttl ${p1.ttl}s)`);
await sleep(2100);
r = await call('POST', `/calls/${rid}/ping`, C.token);
ok(r.status === 200 && r.data.pingsLeft === 9 && r.data.pingIn === 2, `after the gap Cora pings Yuki (${JSON.stringify(r.data)})`);
ok(await until(() => rings('ping').length === 1 && ringPushes().length === 2), 'Yuki’s phone rings again, live and by push');
ok(ringPushes()[1].title === 'Cora is pinging you' && ringPushes()[1].body === 'They’re waiting in your video date. Tap to join.', 'as a ping');
const ringNotes = (await call('GET', '/me/notifications', Y.token)).data.filter((n) => n.go === `call:${rid}`);
ok(ringNotes.length === 1 && ringNotes[0].title === 'Cora is pinging you' && !ringNotes[0].read, 'one notification for the call: the newest ring replaces the last, unread');
r = await call('POST', `/calls/${rid}/ping`, Y.token);
ok(r.status === 409 && r.data?.error === 'Join the call first, then ping.', 'only someone in the call can ping');
ok((await call('POST', `/calls/${rid}/ping`, S.token)).status === 404, 'nobody else can (404)');
const c2 = await join(rid, C.token); // a reconnect: replaces the first connection
ok(await until(() => c2.has('hello')) && c2.got.find((m) => m.type === 'hello').pingsLeft === 9, 'Cora reconnects');
await sleep(1000);
ok(rings().length === 2, 'a reconnect a moment later doesn’t ring again');
for (let i = 0; i < 9; i++) { await sleep(2050); r = await call('POST', `/calls/${rid}/ping`, C.token); }
ok(r.status === 200 && r.data.pingsLeft === 0, `ten pings in all (${r.status}, ${r.data?.pingsLeft} left)`);
await sleep(2050);
r = await call('POST', `/calls/${rid}/ping`, C.token);
ok(r.status === 429 && r.data?.error === 'You’ve pinged Yuki 10 times. They know you’re waiting.', 'then no more for this video date');
c2.send({ type: 'bye' });
ok(await until(() => yl.got.some((m) => m.type === 'ring-off' && m.bookingId === rid && typeof m.at === 'number')), 'Cora hangs up before Yuki came: Yuki’s phone stops ringing');
await sleep(8100); // 4 times the ping gap since the last ring
const c3 = await join(rid, C.token);
ok(await until(() => rings('join').length === 2), `joining alone again later rings again (${rings().map((m) => m.why).join(', ')})`);
const y3 = await join(rid, Y.token);
ok(await until(() => y3.has('hello') && c3.has('peer-joined')), 'Yuki answers: both in the call');
r = await call('POST', `/calls/${rid}/ping`, C.token);
ok(r.status === 409 && r.data?.error === 'Yuki is already in the call.', 'nothing to ping while both are there');
const ringsBefore = rings().length;
const y4 = await join(rid, Y.token); // Yuki rejoins with Cora there: nobody is alone, nothing rings
await until(() => y4.has('hello'));
await sleep(800);
ok(rings().length === ringsBefore && !c3.got.some((m) => m.type === 'ring'), 'joining while the other is there rings nobody');
for (const w of [c3, y3, y4, yl]) w.ws.close();
await call('PATCH', '/me', Y.token, { pushToken: null, prefs: { pushBookings: true } });
await call('POST', `/companion/bookings/${rid}/cancel`, Y.token, { reason: 'Something else' });

// 3) The call room
const a = await join(id, C.token);
const aHello = await until(() => a.has('hello')) && a.got.find((m) => m.type === 'hello');
ok(aHello && aHello.peer === false && aHello.wait === 3 && aHello.together === 0, 'the customer is first in: told the companion isn’t there yet, and how long to wait');
ok(await until(async () => (await call('GET', '/me/notifications', Y.token)).data.some((n) => n.go === `call:${id}` && n.title === 'Cora is waiting in your video date')), 'the companion hears Cora is waiting (opens the call)');
const b = await join(id, Y.token);
ok(await until(() => b.has('hello')) && b.got.find((m) => m.type === 'hello').peer === true && await until(() => a.has('peer-joined')), 'the companion joins: both know the other is there');
b.send({ type: 'signal', data: { description: { type: 'offer', sdp: 'v=0 test' } } });
a.send({ type: 'signal', data: { candidate: { candidate: 'candidate:1 1 udp 1 192.0.2.1 5000 typ host', sdpMid: '0' } } });
ok(await until(() => a.got.some((m) => m.type === 'signal' && m.data.description?.sdp === 'v=0 test') && b.got.some((m) => m.type === 'signal' && m.data.candidate)), 'the call setup passes between the two');
ok(!a.got.some((m) => m.type === 'signal' && m.data.candidate) && !b.got.some((m) => m.type === 'signal' && m.data.description), 'and never back to the sender');
a.send({ type: 'media', on: true });
await sleep(3000); // only one side with video: the clock doesn't run
b.send({ type: 'media', on: true });
await sleep(2500);
// A second phone of the same person takes over; hanging up tells the other side straight away
const a2 = await join(id, C.token);
ok(await until(() => a.has('replaced') && a.closed()) && await until(() => a2.has('hello')), 'joining again replaces the old connection');
const together = a2.got.find((m) => m.type === 'hello').together;
ok(together >= 2 && together <= 4, `the together clock ran only while both had video (${together}s)`);
ok(!b.got.some((m) => m.type === 'peer-left'), 'without the other side seeing them leave');
b.send({ type: 'bye' });
ok(await until(() => a2.got.some((m) => m.type === 'peer-left' && m.bye === true)), 'hanging up: the other side is told at once');
a2.ws.close();
await sleep(500);
const mid = row(id);
ok(mid.call_together_s >= together && mid.call_together_s <= together + 1, `the time together is saved (${mid.call_together_s}s)`);
ok(!a.has('confirmed') && !b.has('confirmed') && mid.status === 'confirmed' && mid.pay_status === 'held', 'nothing is paid out during the call: it’s settled after the booked end');

// 3b) Whoever comes in alone is told who has already waited long enough for the other (and so isn't at fault)
const cov = await book();
startedAgo(cov, 60);
const w1 = await join(cov, C.token);
await until(() => w1.has('hello'));
ok(w1.got.find((m) => m.type === 'hello').covered === null, 'Cora comes in first: nobody has waited yet');
await sleep(3500); // longer than the wait (3 s here)
w1.send({ type: 'bye' });
await sleep(300);
const w2 = await join(cov, Y.token);
await until(() => w2.has('hello'));
ok(w2.got.find((m) => m.type === 'hello').covered === 'customer', 'Cora waited and left: Yuki is told the time alone isn’t paid until she’s back');
const w3 = await join(cov, C.token);
await until(() => w3.has('hello'));
ok(w3.got.find((m) => m.type === 'hello').covered === null, 'together again: nothing is held against anyone');
for (const w of [w2, w3]) w.ws.close();
await call('POST', `/companion/bookings/${cov}/cancel`, Y.token, { reason: 'Something else' });

// 4) The call ends at the booked end and is settled right after, by who was there. Each case is its own video date,
// all ending 10 seconds from now (1 hour booked; time before anyone joined counts for nobody).
const ENDS_IN = 10;
const cases = {};
for (const k of ['full', 'custLeft', 'compLeft', 'compLate', 'noVideo', 'custAway']) cases[k] = await book();
const [SUB, FEE, TOTAL] = (({ subtotal, fee, total }) => [subtotal, fee, total])(row(cases.full));
ok(FEE === Math.round(SUB * 0.1) && TOTAL === SUB + FEE, `each: ${eur(SUB)} for Yuki + ${eur(FEE)} service fee`);
sql(`UPDATE bookings SET starts_at = unixepoch() - ${3600 - ENDS_IN} WHERE id IN (${Object.values(cases).map((q) => `'${q}'`).join(', ')})`);
const t0 = Date.now();
const at = (s) => sleep(Math.max(0, t0 + s * 1000 - Date.now()));
const both = async (k, media = true) => {
  const c = await join(cases[k], C.token), y = await join(cases[k], Y.token);
  await until(() => c.has('hello') && y.has('hello'));
  if (media) { c.send({ type: 'media', on: true }); y.send({ type: 'media', on: true }); }
  return { c, y };
};
const live = {};
await Promise.all([
  // Both there with video until the end
  (async () => { live.full = await both('full'); })(),
  // Cora leaves early; Yuki waits for her longer than the wait time, then leaves too
  (async () => { const x = live.custLeft = await both('custLeft'); await at(2); x.c.send({ type: 'bye' }); await at(6.5); x.y.send({ type: 'bye' }); })(),
  // Yuki leaves early; Cora waits for them longer than the wait time, then leaves too (still counts against Yuki)
  (async () => { const x = live.compLeft = await both('compLeft'); await at(2); x.y.send({ type: 'bye' }); await at(6.5); x.c.send({ type: 'bye' }); })(),
  // Yuki is 4 seconds late
  (async () => { const c = await join(cases.compLate, C.token); await until(() => c.has('hello')); c.send({ type: 'media', on: true }); await at(4); const y = await join(cases.compLate, Y.token); await until(() => y.has('hello')); y.send({ type: 'media', on: true }); live.compLate = { c, y }; })(),
  // Both in the call, but the video never connects
  (async () => { live.noVideo = await both('noVideo', false); })(),
  // Only Yuki comes
  (async () => { const y = await join(cases.custAway, Y.token); await until(() => y.has('hello')); live.custAway = { y }; })(),
]);
const stillIn = [live.full.c, live.full.y, live.compLate.c, live.compLate.y, live.noVideo.c, live.noVideo.y, live.custAway.y];
ok(await until(() => stillIn.every((w) => w.has('ended') && w.closed()), (ENDS_IN + 6) * 1000), 'at the booked end the call ends for everyone still in it');
const settled = await until(() => rowsOf(Object.values(cases)).every((q) => q.pay_status !== 'held'), 10000);
ok(settled, 'and every one of them is settled right away by the call room');
r = await call('POST', `/calls/${cases.full}`, C.token);
ok(r.status === 409 && r.data?.error === 'This video date has ended.', 'it can’t be joined any more');

const all = rowsOf(Object.values(cases));
const x = Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, all.find((q) => q.id === v)]));
/** The price stays; Cora paid the fee plus what Yuki earned, and got the rest back. */
const paidOnly = (b) => b.total === TOTAL && b.fee === FEE && b.refunded === TOTAL - FEE - b.subtotal;
ok(x.full.status === 'completed' && x.full.pay_status === 'released' && x.full.subtotal === SUB && x.full.total === TOTAL && x.full.refunded === 0 && x.full.billed_minutes === null,
  `both there with video: Yuki gets the full ${eur(SUB)}`);
ok(x.custLeft.status === 'completed' && x.custLeft.pay_status === 'released' && x.custLeft.subtotal === SUB && x.custLeft.refunded === 0,
  'Cora left early (and Yuki waited, then left): Yuki still gets it all');
const lost = (b) => Math.round(((SUB - b.subtotal) / SUB) * 3600);
ok(x.compLeft.status === 'completed' && x.compLeft.pay_status === 'released' && x.compLeft.subtotal < SUB && lost(x.compLeft) >= 6 && lost(x.compLeft) <= 10 && paidOnly(x.compLeft),
  `Yuki left early: paid only for the time they were there (${eur(x.compLeft.subtotal)}, ${lost(x.compLeft)}s not paid), Cora gets ${eur(x.compLeft.refunded)} back`);
ok(x.compLeft.billed_minutes === 59 && x.compLeft.fee === FEE, `paid minutes noted (${x.compLeft.billed_minutes}); the fee is kept`);
ok(x.compLate.status === 'completed' && x.compLate.subtotal < SUB && lost(x.compLate) >= 3 && lost(x.compLate) <= 6 && paidOnly(x.compLate),
  `Yuki was late: the late seconds aren’t paid (${lost(x.compLate)}s)`);
ok(x.noVideo.status === 'cancelled' && x.noVideo.pay_status === 'refunded' && x.noVideo.cancelled_by === 'system' && x.noVideo.subtotal === 0 && x.noVideo.total === TOTAL && x.noVideo.refunded === SUB
  && x.noVideo.cancel_note === `The video didn’t connect · ${eur(SUB)} refunded (service fee kept)`, `the video never connected: everything back but the fee (${x.noVideo.cancel_note})`);
ok(x.custAway.status === 'cancelled' && x.custAway.pay_status === 'released' && x.custAway.cancelled_by === 'customer' && x.custAway.subtotal === SUB && x.custAway.refunded === 0
  && x.custAway.cancel_note === 'You didn’t join the video date · no refund', 'Cora never came: Yuki gets it all');

// What each side sees
const cb = (await call('GET', '/bookings', C.token)).data;
const cbOf = (k) => cb.find((q) => q.id === cases[k]);
ok(cbOf('compLeft').refunded === x.compLeft.refunded && cbOf('compLeft').fee === FEE && cbOf('compLeft').minutesPaid === 59 && cbOf('compLeft').total === TOTAL,
  'Cora’s booking shows what she paid, the fee, what came back and the minutes paid');
ok(cbOf('full').refunded === 0 && cbOf('full').minutesPaid === undefined && cbOf('noVideo').refunded === SUB && cbOf('noVideo').status === 'cancelled', 'and the others as they ended');
const yb = (await call('GET', '/companion/bookings', Y.token)).data;
const ybOf = (k) => yb.history.find((q) => q.id === cases[k]);
ok(ybOf('compLeft')?.payout === x.compLeft.subtotal && ybOf('compLeft')?.minutesPaid === 59 && ybOf('full')?.payout === SUB, 'Yuki sees what they earned and the minutes paid');
const has = (list, title, body) => list.some((n) => n.title === title && (!body || body.test(n.body)));
let cn, yn;
await until(async () => {
  cn = (await call('GET', '/me/notifications', C.token)).data;
  yn = (await call('GET', '/me/notifications', Y.token)).data;
  return has(cn, 'You missed your video date') && has(cn, 'Your video date didn’t connect') && has(yn, 'Video date paid in part') && has(yn, 'Video date ended');
}, 6000);
ok(has(cn, 'Video date confirmed', /sent to Yuki/) && has(yn, 'Video date confirmed', /^You earned €/), 'full: both told it’s confirmed');
ok(has(cn, 'Video date ended', /^You left before the end, so the full €[\d.]+ goes to Yuki\.$/) && has(yn, 'Video date ended', /^Cora left before the end\. You still get €/), 'Cora left early: both told');
ok(has(cn, 'Yuki wasn’t there for all of your video date', /^You pay for 59 of 60 min: €[\d.]+ with the service fee\. €[\d.]+ is refunded\.$/)
  && has(yn, 'Video date paid in part', /^Cora was in the call without you for part of it, so you earn €[\d.]+ for 59 of 60 min\.$/), 'Yuki left early: both told what it costs');
ok(has(cn, 'Your video date didn’t connect', /€[\d.]+ is refunded\. The €[\d.]+ service fee isn’t refundable\.$/) && has(yn, 'Video date didn’t connect'), 'no video: both told');
ok(has(cn, 'You missed your video date') && has(yn, 'Cora didn’t join the video date', /You still get €/), 'Cora never came: both told');

// 5) No-shows nobody's call room saw: settled once by the cron after the end
const noComp = await book();
startedAgo(noComp, 3700); // ended, nobody joined
const noCust = await book();
startedAgo(noCust, 3700);
sql(`UPDATE bookings SET call_companion_at = unixepoch() - 3000 WHERE id = '${noCust}'`);
const noLog = await book(); // both joined and had video, but the room kept no record (counts as there throughout)
startedAgo(noLog, 3700);
sql(`UPDATE bookings SET call_companion_at = unixepoch() - 3000, call_customer_at = unixepoch() - 2900, call_together_s = 120 WHERE id = '${noLog}'`);
const credit = await book(); // paid with gift credit; Yuki never joins
startedAgo(credit, 3700);
sql(`UPDATE bookings SET credit_used = total WHERE id = '${credit}'`);
const creditOf = () => JSON.parse(execSync(`npx wrangler d1 execute DB --local --json --command "SELECT credit FROM users WHERE id = '${C.user.id}'"`, { stdio: 'pipe' }).toString())[0].results[0].credit;
const credit0 = creditOf();
await cron();
await until(async () => rowsOf([noComp, noCust, noLog, credit]).every((q) => q.pay_status !== 'held'), 12000);
const [n1, n2, n3, n4] = ((list) => [noComp, noCust, noLog, credit].map((q) => list.find((y) => y.id === q)))(rowsOf([noComp, noCust, noLog, credit]));
ok(n1.status === 'cancelled' && n1.pay_status === 'refunded' && n1.cancelled_by === 'companion' && n1.refunded === SUB && n1.total === TOTAL && n1.subtotal === 0
  && n1.cancel_note === `Yuki wasn’t there for the video date · ${eur(SUB)} refunded (service fee kept)`, `the companion never joined: everything back but the fee (${n1.cancel_note})`);
ok(n2.status === 'cancelled' && n2.pay_status === 'released' && n2.cancelled_by === 'customer' && n2.subtotal === SUB && n2.cancel_note === 'You didn’t join the video date · no refund', 'only the companion joined: they keep the pay');
ok(n3.status === 'completed' && n3.pay_status === 'released' && n3.subtotal === SUB && n3.call_closed, 'both joined with video and nothing says anyone left: paid in full');
ok(n4.status === 'cancelled' && n4.credit_used === FEE && n4.refunded === SUB && creditOf() === credit0 + SUB, `paid with gift credit: the credit comes back but for the fee (+${eur(creditOf() - credit0)})`);
let cn2;
await until(async () => has(cn2 = (await call('GET', '/me/notifications', C.token)).data, 'Yuki didn’t join your video date'), 5000);
// (The cron also asks “How did it go?” about each completed one: those aren't about the money.)
const money = (list) => list.filter((n) => !n.go?.startsWith('feedback:')).length;
ok(has(cn2, 'Yuki didn’t join your video date', /€[\d.]+ is refunded\. The €[\d.]+ service fee isn’t refundable\.$/), 'the customer is told');
ok(has((await call('GET', '/me/notifications', Y.token)).data, 'You missed a video date', /They got their money back\.$/), 'and so is the companion');
await cron(); await sleep(1500);
ok(rowsOf([noComp, noCust, noLog, credit]).every((q) => q.call_closed) && money((await call('GET', '/me/notifications', C.token)).data) === money(cn2) && creditOf() === credit0 + SUB,
  'each one is settled only once');

// 6) Video dates the old rules left held (both joined, under 10 minutes together): never "upcoming" once ended;
// migration 0021 reopens them, and they're settled as soon as either side opens their bookings
const old1 = await book(), old2 = await book();
startedAgo(old1, 3700); startedAgo(old2, 3700);
sql(`UPDATE bookings SET call_companion_at = unixepoch() - 3600, call_customer_at = unixepoch() - 3590, call_together_s = CASE id WHEN '${old1}' THEN 200 ELSE 0 END, call_closed = unixepoch() - 30 WHERE id IN ('${old1}', '${old2}')`);
let yu = (await call('GET', '/companion/bookings', Y.token)).data;
ok(!yu.upcoming.some((q) => q.id === old1 || q.id === old2), 'an ended video date is never in Yuki’s upcoming, even while it waits to be settled');
ok(rowsOf([old1, old2]).every((q) => q.status === 'confirmed' && q.pay_status === 'held'), 'closed by the old rules, they stay held');
execSync('npx wrangler d1 execute DB --local --file migrations/0021_reopen_held_video_dates.sql', { stdio: 'pipe' });
await call('GET', '/bookings', C.token); // opening the bookings settles them
const [o1, o2] = ((list) => [old1, old2].map((q) => list.find((y) => y.id === q)))(rowsOf([old1, old2]));
ok(o1.status === 'completed' && o1.pay_status === 'released' && o1.subtotal === SUB && o1.refunded === 0, 'reopened: the video had connected, so Yuki is paid in full');
ok(o2.status === 'cancelled' && o2.pay_status === 'refunded' && o2.refunded === SUB && o2.cancel_note?.startsWith('The video didn’t connect'), 'the video never connected: everything back but the fee');
yu = (await call('GET', '/companion/bookings', Y.token)).data;
ok(yu.done.some((q) => q.id === old1) && !yu.upcoming.some((q) => q.id === old1 || q.id === old2), 'and they show in Yuki’s history, not as still to come');

pushMock.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
