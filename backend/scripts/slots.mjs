// Open times stay right, live: a confirmed booking takes its time (for its whole length; requests don't), every
// cancellation of one gives it back at once, and open profiles get each change over a WebSocket. Uses the half-hour
// times and date/time/hours requests of older app versions. Runs against a LOCAL API (`npm run dev`) with the
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
const book = (token, date, time, dur = 1, place = 'Café Einstein') => call('POST', '/bookings', token, { companionId: CID, act: 'movies', date, time, dur, place, boundariesAgreed: true });
const toMidnight = (t) => 24 - (Number(t.slice(0, 2)) + Number(t.slice(3)) / 60);

// Two times 90 minutes apart on the same day, both free for at least 2 hours.
let list = await slots();
const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
ok(list.length === 7 && list.every((d) => Array.isArray(d.fit) && d.fit.length === d.times.length && d.fit.every((h) => h >= 1 && h <= 8 && Number.isInteger(h * 2))), 'every open time says how long it can be booked for (1–8 h, in half hours)');
ok(list.every((d) => d.times.every((t, i) => d.fit[i] <= toMidnight(t))), 'no booking runs past midnight');
const pick = list.flatMap((d) => d.times.flatMap((t, j) => d.times.map((e, i) => ({ date: d.date, early: e, time: t, fit: d.fit[j], earlyFit: d.fit[i] }))))
  .reverse().find((x) => x.fit >= 2 && x.earlyFit >= 2 && mins(x.time) - mins(x.early) === 90);
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

// 1) A request doesn't take the time; accepting it does, for its whole length, live for others
r = await book(A, date, time, 2);
ok(r.status === 201 && r.data.status === 'pending', `customer A asks for ${time} for 2 hours`);
let id = r.data.id;
ok(has(await slots(), date, time), 'a request doesn’t take the time: others can still ask for it');
let e = await noahRoom.next((x) => x.type === 'changed' && x.go === 'comp:requests');
ok(!!e, 'the companion’s open app is told about the new request at once');
r = await call('POST', `/companion/bookings/${id}/accept`, N);
ok(r.status === 200, 'Noah accepts it');
e = await viewer.next((x) => gone(x, date, time));
ok(!!e, 'someone else on the profile sees the time go at once');
ok(fitOf(e.slots, date, early) === 1.5, `${early} now fits 1½ hours at most (it would run into the booking)`);
r = await book(B, date, early, 2);
ok(r.status === 409 && /only free for 1 hour 30 minutes/.test(r.data.error), `a booking that would overlap the confirmed one is refused (“${r.data.error}”)`);
r = await book(B, date, time, 1);
ok(r.status === 409, 'the confirmed time can’t be booked again');

// 2) A confirmed booking that's cancelled gives its time back at once; requests never held it
r = await call('POST', `/bookings/${id}/cancel`, A, { reason: 'Plans changed' });
ok(r.status === 200, 'customer cancels the confirmed booking (days ahead: free)');
e = await viewer.next((x) => showsAgain(x, date, time));
ok(!!e && fitOf(e.slots, date, early) >= 2, 'the time shows again for everyone, live (and the earlier one is long again)');
ok(has(await slots(), date, time), 'and it is in the open times again');

id = (await book(A, date, time)).data.id;
r = await call('POST', `/companion/bookings/${id}/decline`, N);
ok(r.status === 200 && has(await slots(), date, time), 'a declined request never held the time: still open');

id = (await book(A, date, time)).data.id;
await call('POST', `/companion/bookings/${id}/accept`, N);
await viewer.next((x) => gone(x, date, time));
r = await call('POST', `/companion/bookings/${id}/cancel`, N, { reason: 'Emergency' });
ok(r.status === 200 && !!(await viewer.next((x) => showsAgain(x, date, time))), 'companion cancels a confirmed booking: the time shows again');

id = (await book(A, date, time)).data.id;
sql(`UPDATE bookings SET created_at = unixepoch() - 90000 WHERE id = '${id}'`);
await fetch(`${BASE}/__scheduled?cron=*/10+*+*+*+*`);
await new Promise((res) => setTimeout(res, 1500));
ok(count(`SELECT id FROM bookings WHERE id = '${id}' AND status = 'expired'`) === 1 && has(await slots(), date, time), 'a request left unanswered for 24 hours expires (and never held the time)');

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

// 4) Checkouts left unpaid hold nothing; the person who left one can simply try again
id = (await book(A, date, time)).data.id;
sql(`UPDATE bookings SET paid = 0 WHERE id = '${id}'`);
r = await book(B, date, time);
ok(r.status === 201, 'an open checkout doesn’t hold the time: someone else can ask for it too');
await call('POST', `/bookings/${r.data.id}/cancel`, B);
r = await book(A, date, time, 2);
ok(r.status === 201 && r.data.id !== id, 'the same customer can try again (e.g. a different length)');
const retry = r.data.id;
ok(count(`SELECT id FROM bookings WHERE id = '${id}'`) === 0, 'their earlier unpaid checkout is gone');
r = await call('POST', `/bookings/${retry}/release`, A);
ok(r.status === 200 && r.data.paid === true && r.data.released === false, 'release never touches a paid booking');
await call('POST', `/bookings/${retry}/cancel`, A);
id = (await book(A, date, time)).data.id;
sql(`UPDATE bookings SET paid = 0 WHERE id = '${id}'`);
r = await call('POST', `/bookings/${id}/release`, B);
ok(r.status === 404, 'only the customer can release their checkout');
r = await call('POST', `/bookings/${id}/release`, A);
ok(r.status === 200 && r.data.released === true, 'leaving checkout drops the unfinished request');
r = await call('POST', `/bookings/${id}/release`, A);
ok(r.status === 200 && r.data.released === false, 'releasing twice is harmless');

// 5) Two people asking for the same time at the same moment: both are requests; accepting decides
const both = await Promise.all([book(A, date, time), book(B, date, time)]);
ok(both.every((x) => x.status === 201), `same time at the same moment: two requests (${both.map((x) => x.status)})`);
const answers = await Promise.all(both.map((x) => call('POST', `/companion/bookings/${x.data.id}/accept`, N)));
ok(answers.filter((x) => x.status === 200).length === 1, `accepting both at once: exactly one is confirmed (${answers.map((x) => x.status)})`);
for (const [x, t] of [[both[0], A], [both[1], B]]) await call('POST', `/bookings/${x.data.id}/cancel`, t);
await viewer.next((x) => showsAgain(x, date, time));

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

// 8) Any length from 1 to 8 hours in half-hour steps, priced by the hour; the meeting place is optional
const rate = (await call('GET', `/companions/${CID}`)).data.rate;
const priced = (dur) => Math.round(rate * dur * 100 * 1.1);
list = await slots();
const long = list.slice().reverse().flatMap((d) => d.times.map((t, i) => ({ date: d.date, time: t, fit: d.fit[i] }))).find((x) => x.fit >= 6);
if (!long) throw new Error('No time with room for 6 hours.');
for (const bad of [0.5, 0.7, 8.5, 9, -1]) ok((await book(A, long.date, long.time, bad)).status === 400, `a length of ${JSON.stringify(bad)} hours is refused`);
r = await book(A, long.date, long.time, 1.25);
ok(r.status === 201 && r.data.minutes === 75 && r.data.total === priced(1.25), `1¼ hours (any 15-minute step) is fine: €${r.data.total / 100}`);
await call('POST', `/bookings/${r.data.id}/cancel`, A);
r = await book(A, long.date, long.time, 6);
ok(r.status === 201 && r.data.dur === 6 && r.data.total === priced(6), `6 hours at ${long.time} (${long.date}): €${r.data.total / 100} = 6 × €${rate} + 10%`);
const six = r.data.id;
await call('POST', `/companion/bookings/${six}/accept`, N);
const after = (await slots()).find((d) => d.date === long.date);
ok(!after.times.some((t) => { const m = Number(t.slice(0, 2)) * 60 + Number(t.slice(3)); const s0 = Number(long.time.slice(0, 2)) * 60 + Number(long.time.slice(3)); return m >= s0 && m < s0 + 360; }), 'it blocks all 6 hours');
await call('POST', `/bookings/${six}/cancel`, A);
r = await book(A, long.date, long.time, 2.5, '');
ok(r.status === 201 && r.data.dur === 2.5 && r.data.total === priced(2.5), `2½ hours: €${r.data.total / 100} (2.5 × €${rate} + 10%)`);
const mine = (await call('GET', '/bookings', A)).data.find((x) => x.id === r.data.id);
ok(mine?.place === '' && mine.dur === 2.5, 'no meeting place is fine: they can agree on it in the chat');
const req = (await call('GET', '/companion/bookings', N)).data.requests.find((x) => x.id === r.data.id);
ok(req?.dur === 2.5 && req.payout === rate * 250, `the companion sees 2½ hours and earns €${req?.payout / 100}`);
await call('POST', `/companion/bookings/${r.data.id}/accept`, N);
ok(fitOf(await slots(), long.date, long.time) === undefined, 'once accepted, the 2½-hour booking holds its time');
await call('POST', `/bookings/${r.data.id}/cancel`, A);
r = await book(A, long.date, long.time, 1, '   ');
ok(r.status === 201 && (await call('GET', '/bookings', A)).data.find((x) => x.id === r.data.id)?.place === '', 'a blank place is saved as none');
await call('POST', `/bookings/${r.data.id}/cancel`, A);
r = await book(A, long.date, long.time, 1, 'Call me on 0151 2345678');
ok(r.status === 400, 'contact details in the place are still refused');
const late = list.flatMap((d) => d.times.map((t, i) => ({ date: d.date, time: t, fit: d.fit[i] }))).find((x) => x.time === '20:00');
if (late) {
  ok(late.fit <= 4, `from 20:00 at most 4 hours (until midnight): ${late.fit}`);
  ok((await book(A, late.date, '20:00', 4.5)).status === 409, 'a booking past the end of his hours (midnight here) is refused');
}

viewer.ws.close();
noahRoom.ws.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll slot checks passed');
process.exit(failures ? 1 : 0);
