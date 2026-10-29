// Open times stay right, live: a booking takes its time (for its whole length), every kind of cancellation gives it
// back at once, and open profiles get each change over a WebSocket. Runs against a LOCAL API (`npm run dev`) with the
// demo companions seeded; edits the local database for the cases the API can't reach on its own.
// Usage: node scripts/slots.mjs
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:8787';
const CID = 'demo_noah';
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) failures++;
};
const call = async (method, path, token, body) => {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const login = async (email) => {
  const r = await call('POST', '/auth/request-code', null, { email });
  return (await call('POST', '/auth/verify', null, { email, code: r.data.devCode })).data;
};
const sql = (q) => execSync(`npx wrangler d1 execute DB --local --command "${q}"`, { stdio: 'pipe' });
const count = (q) => JSON.parse(execSync(`npx wrangler d1 execute DB --local --json --command "${q}"`, { stdio: 'pipe' }).toString())[0].results.length;

/** A live socket that keeps every event, so tests can wait for the one they expect. */
async function listen(path, token) {
  const events = [];
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}${path}?token=${token}`);
  ws.onmessage = (e) => { if (e.data !== 'pong') events.push(JSON.parse(e.data)); };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return {
    ws,
    next: (pred, ms = 4000) => new Promise((res) => {
      const t0 = Date.now();
      const tick = () => {
        const i = events.findIndex(pred);
        if (i >= 0) return res(events.splice(0, i + 1).at(-1));
        if (Date.now() - t0 > ms) return res(null);
        setTimeout(tick, 50);
      };
      tick();
    }),
    clear: () => events.splice(0),
  };
}

const slots = async () => (await call('GET', `/companions/${CID}/slots`)).data;
const has = (list, date, time) => !!list.find((d) => d.date === date)?.times.includes(time);
const fitOf = (list, date, time) => { const d = list.find((x) => x.date === date); return d?.fit[d.times.indexOf(time)]; };
const showsAgain = (e, date, time) => e?.type === 'slots' && has(e.slots, date, time);
const gone = (e, date, time) => e?.type === 'slots' && !has(e.slots, date, time);

const stamp = Date.now();
const a = await login(`slots-a+${stamp}@example.com`);
const b = await login(`slots-b+${stamp}@example.com`);
for (const u of [a, b]) {
  await call('PATCH', '/me', u.token, { name: 'Slot Tester', ageConfirmed: true });
  sql(`UPDATE users SET id_status = 'approved' WHERE id = '${u.user.id}'`);
}
const A = a.token;
const B = b.token;
const N = (await login('noah@demo.zeitmit.app')).token;
const book = (token, date, time, dur = 1) => call('POST', '/bookings', token, { companionId: CID, act: 'movies', date, time, dur, place: 'Café Einstein', boundariesAgreed: true });

// Two times 90 minutes apart on the same day, the later one free for at least 2 hours.
let list = await slots();
ok(list.length === 7 && list.every((d) => Array.isArray(d.fit) && d.fit.length === d.times.length && d.fit.every((h) => h >= 1 && h <= 4)), 'every open time says how long it can be booked for (1–4 h)');
const pick = list.flatMap((d) => d.times.slice(1).map((t, i) => ({ date: d.date, early: d.times[i], time: t, fit: d.fit[i + 1], earlyFit: d.fit[i] })))
  .reverse().find((x) => x.fit >= 2 && x.earlyFit >= 2 && Number(x.time.slice(0, 2)) * 60 + Number(x.time.slice(3)) - (Number(x.early.slice(0, 2)) * 60 + Number(x.early.slice(3))) === 90);
if (!pick) throw new Error(`No suitable times for ${CID}: seed the demo companions again.`);
const { date, early, time } = pick;
console.log(`  using ${date} ${early} + ${time}`);

const viewer = await listen(`/live/slots/${CID}`, B);
const noahRoom = await listen('/live', N);
let r = await call('GET', `/live/slots/${CID}`, B);
ok(r.status === 400, 'live slots need a WebSocket upgrade');
const refused = await new Promise((res) => {
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/live/slots/${CID}`);
  ws.onopen = () => { ws.close(); res(false); };
  ws.onerror = () => res(true);
});
ok(refused, 'live slots need a signed-in user');

// 1) A booking takes its whole length, live for others
r = await book(A, date, time, 2);
ok(r.status === 201, `customer A books ${time} for 2 hours`);
let id = r.data.id;
let e = await viewer.next((x) => gone(x, date, time));
ok(!!e, 'someone else on the profile sees the time go at once');
ok(fitOf(e.slots, date, early) === 1, `${early} now fits 1 hour at most (it would run into the booking)`);
r = await book(B, date, early, 2);
ok(r.status === 409 && /only free for 1 hour/.test(r.data.error), 'a booking that would overlap the next one is refused');
r = await book(B, date, time, 1);
ok(r.status === 409 && /just taken/.test(r.data.error), 'the same time cannot be booked twice');
e = await noahRoom.next((x) => x.type === 'changed' && x.go === 'comp:requests');
ok(!!e, 'the companion’s open app is told about the new request at once');

// 2) Each kind of cancellation gives the time back straight away
r = await call('POST', `/bookings/${id}/cancel`, A, { reason: 'Plans changed' });
ok(r.status === 200, 'customer cancels the request');
e = await viewer.next((x) => showsAgain(x, date, time));
ok(!!e && fitOf(e.slots, date, early) >= 2, 'the time shows again for everyone, live (and the earlier one is long again)');
ok(has(await slots(), date, time), 'and it is in the open times again');

id = (await book(A, date, time)).data.id;
await viewer.next((x) => gone(x, date, time));
r = await call('POST', `/companion/bookings/${id}/decline`, N);
ok(r.status === 200 && !!(await viewer.next((x) => showsAgain(x, date, time))), 'declined request: the time shows again');

id = (await book(A, date, time)).data.id;
await viewer.next((x) => gone(x, date, time));
await call('POST', `/companion/bookings/${id}/accept`, N);
r = await call('POST', `/companion/bookings/${id}/cancel`, N, { reason: 'Emergency' });
ok(r.status === 200 && !!(await viewer.next((x) => showsAgain(x, date, time))), 'companion cancels a confirmed booking: the time shows again');

id = (await book(A, date, time)).data.id;
await viewer.next((x) => gone(x, date, time));
sql(`UPDATE bookings SET status = 'pending', created_at = unixepoch() - 90000 WHERE id = '${id}'`);
await fetch(`${BASE}/__scheduled?cron=*/10+*+*+*+*`);
ok(!!(await viewer.next((x) => showsAgain(x, date, time), 6000)), 'a request left unanswered expires: the time shows again');

id = (await book(A, date, time)).data.id;
await call('POST', `/companion/bookings/${id}/accept`, N);
const real = (await call('GET', '/bookings', A)).data.find((x) => x.id === id).startsAt;
sql(`UPDATE bookings SET starts_at = unixepoch() + 6 * 3600 WHERE id = '${id}'`); // within 24 h, so it's a late cancellation
r = await call('POST', `/bookings/${id}/cancel`, A, { reason: 'Plans changed' });
ok(r.status === 200 && r.data.late === true, 'late cancellation (companion keeps the pay)');
sql(`UPDATE bookings SET starts_at = ${real} WHERE id = '${id}'`);
ok(has(await slots(), date, time), 'a late-cancelled time is bookable again too');

// 3) A meet-up already under way keeps its time, even though the meet code completed it
id = (await book(A, date, time)).data.id;
sql(`UPDATE bookings SET status = 'completed', pay_status = 'released', released_at = unixepoch() WHERE id = '${id}'`);
ok(!has(await slots(), date, time), 'a completed meet-up still blocks its time');
sql(`UPDATE bookings SET status = 'cancelled', pay_status = 'refunded' WHERE id = '${id}'`);

// 4) Checkouts left unpaid: they hold the time for others, never for the person who left them
id = (await book(A, date, time)).data.id;
sql(`UPDATE bookings SET paid = 0 WHERE id = '${id}'`);
r = await book(B, date, time);
ok(r.status === 409, 'an open checkout holds the time for others');
r = await book(A, date, time, 2);
ok(r.status === 201 && r.data.id !== id, 'the same customer can try again (e.g. a different length) without being blocked by their own checkout');
const retry = r.data.id;
ok(count(`SELECT id FROM bookings WHERE id = '${id}'`) === 0, 'their earlier unpaid checkout is gone');
r = await call('POST', `/bookings/${retry}/release`, A);
ok(r.status === 200 && r.data.paid === true && r.data.released === false, 'release never touches a paid booking');
await call('POST', `/bookings/${retry}/cancel`, A);
id = (await book(A, date, time)).data.id;
sql(`UPDATE bookings SET paid = 0 WHERE id = '${id}'`);
viewer.clear();
r = await call('POST', `/bookings/${id}/release`, B);
ok(r.status === 404, 'only the customer can release their checkout');
r = await call('POST', `/bookings/${id}/release`, A);
ok(r.status === 200 && r.data.released === true, 'leaving checkout releases the time');
ok(!!(await viewer.next((x) => showsAgain(x, date, time))), 'and others see it free again at once');
r = await call('POST', `/bookings/${id}/release`, A);
ok(r.status === 200 && r.data.released === false, 'releasing twice is harmless');

// 5) Two people tapping Pay for the same time at the same moment: exactly one gets it
const both = await Promise.all([book(A, date, time), book(B, date, time)]);
ok(both.filter((x) => x.status === 201).length === 1 && both.filter((x) => x.status === 409).length === 1, `same time at the same moment: one booking, one “just taken” (${both.map((x) => x.status)})`);
for (const [x, t] of [[both[0], A], [both[1], B]]) if (x.status === 201) await call('POST', `/bookings/${x.data.id}/cancel`, t);

// 6) Availability changes reach open profiles too
viewer.clear();
const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7];
const win = Number(time.slice(0, 2)) < 12 ? 'am' : Number(time.slice(0, 2)) < 17 ? 'pm' : 'eve';
r = await call('PUT', '/companion/availability', N, { day: wd, win, on: false });
ok(r.status === 200 && !!(await viewer.next((x) => gone(x, date, time))), 'companion closes a window: open profiles lose those times live');
await call('PUT', '/companion/availability', N, { day: wd, win, on: true });
ok(!!(await viewer.next((x) => showsAgain(x, date, time))), 'and get them back when it opens again');

// 7) Keep-alive pings are answered
const pong = await new Promise((res) => { viewer.ws.onmessage = (m) => m.data === 'pong' && res(true); viewer.ws.send('ping'); setTimeout(() => res(false), 3000); });
ok(pong, 'keep-alive ping gets a pong');

viewer.ws.close();
noahRoom.ws.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll slot checks passed');
process.exit(failures ? 1 : 0);
