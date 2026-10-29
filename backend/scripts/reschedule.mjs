// Moving bookings and the customer profile companions see. Runs against a LOCAL API (`npm run dev`) with the demo
// companions seeded; edits the local database for the time-dependent cases.
// Usage: node scripts/reschedule.mjs
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
const notified = async (token, title) => (await call('GET', '/me/notifications', token)).data.some((n) => n.title === title);

const stamp = Date.now();
const mk = async (tag, name) => {
  const u = await login(`${tag}+${stamp}@example.com`);
  await call('PATCH', '/me', u.token, { name, ageConfirmed: true });
  sql(`UPDATE users SET id_status = 'approved' WHERE id = '${u.user.id}'`);
  return u;
};
const a = await mk('move-a', 'Mira Hoffmann');
const b = await mk('move-b', 'Ben Other');
const A = a.token;
const B = b.token;
const N = (await login('noah@demo.zeitmit.app')).token;
const L = (await login('lena@demo.zeitmit.app')).token;
const book = (token, [date, time], dur = 1) => call('POST', '/bookings', token, { companionId: CID, act: 'movies', date, time, dur, place: 'Kino Babylon' });
const mine = async (id) => (await call('GET', '/bookings', A)).data.find((x) => x.id === id);
const theirs = async (id) => { const r = (await call('GET', '/companion/bookings', N)).data; return [...r.requests, ...r.upcoming].find((x) => x.id === id); };
const openAt = async (date, time) => !!(await call('GET', `/companions/${CID}/slots`)).data.find((d) => d.date === date)?.times.includes(time);

// Free 1-hour times far enough ahead (> 24 h), each with room to spare.
const pool = (await call('GET', `/companions/${CID}/slots`)).data.slice(2).flatMap((d) => d.times.filter((t, i) => d.fit[i] >= 1).map((t) => [d.date, t]));
if (pool.length < 8) throw new Error('Not enough open times: seed the demo companions again.');
const [t1, t2, t3, t4, t5, t6, t7] = pool.reverse();

// 1) Customer profile
let r = await call('PATCH', '/me', A, { gender: 'w', age: 29, languages: ['German', 'English'], interests: ['Art', 'Coffee'], bio: 'Museum nerd, new in Berlin.' });
ok(r.status === 200, 'customer adds age, gender, languages and interests');
r = await call('GET', '/me', A);
ok(r.data.age === 29 && r.data.gender === 'w' && r.data.languages.join() === 'German,English' && r.data.interests.join() === 'Art,Coffee', 'they come back with the profile');
for (const [body, what] of [[{ age: 17 }, 'under 18'], [{ gender: 'x' }, 'unknown gender'], [{ languages: ['Klingon'] }, 'unknown language'], [{ interests: ['call me 0151 2345678'] }, 'contact details in an interest']]) {
  ok((await call('PATCH', '/me', A, body)).status === 400, `profile refuses ${what}`);
}
r = await call('GET', `/companion/customers/${a.user.id}`, N);
ok(r.status === 404, 'a companion can’t open a customer’s profile before being booked');
r = await book(A, t1);
const id = r.data.id;
ok(r.status === 201, `customer books ${t1.join(' ')}`);
r = await call('GET', `/companion/customers/${a.user.id}`, N);
ok(r.status === 200 && r.data.name === 'Mira Hoffmann' && r.data.age === 29 && r.data.gender === 'w' && r.data.verified === true && r.data.meetups === 0, 'the booked companion sees the profile');
ok(r.data.together?.length === 1 && r.data.together[0].id === id && r.data.languages.length === 2, 'with languages, interests and their bookings together');
ok(!JSON.stringify(r.data).includes('@'), 'never the email');
ok((await call('GET', `/companion/customers/${a.user.id}`, L)).status === 404, 'other companions can’t see it');

// 2) A request Noah hasn't answered: the customer just moves it
r = await call('GET', `/bookings/${id}/reschedule`, A);
ok(r.status === 200 && r.data.side === 'customer' && r.data.left === 3 && r.data.other === 'Noah', 'reschedule view for the customer');
ok(r.data.slots.find((d) => d.date === t1[0])?.times.includes(t1[1]), 'its own current time is left out of the busy times there');
ok((await call('GET', `/bookings/${id}/reschedule`, B)).status === 404, 'nobody else can open it');
ok((await call('POST', `/bookings/${id}/reschedule`, A, { date: t1[0], time: t1[1] })).status === 400, 'moving to the same time is refused');
const other = (await book(B, t7)).data;
ok((await call('POST', `/bookings/${id}/reschedule`, A, { date: t7[0], time: t7[1] })).status === 409, 'moving onto someone else’s booking is refused');
await call('POST', `/bookings/${other.id}/cancel`, B);
r = await call('POST', `/bookings/${id}/reschedule`, A, { date: t2[0], time: t2[1] });
ok(r.status === 200 && r.data.moved === true, `request moved straight away to ${t2.join(' ')}`);
let x = await mine(id);
ok(x.status === 'pending' && x.time === t2[1] && !x.resched && x.reschedLeft === 2, 'booking shows the new time');
ok(await openAt(...t1) && !(await openAt(...t2)), 'old time is free again, the new one is taken');
ok(await notified(N, 'Mira moved their request'), 'Noah is told');

// 3) Noah suggests another time instead (counter-offer): accepting it also confirms the request
r = await call('POST', `/bookings/${id}/reschedule`, N, { date: t3[0], time: t3[1] });
ok(r.status === 200 && r.data.moved === false, 'companion suggests another time for the request');
x = await mine(id);
ok(x.status === 'pending' && x.time === t2[1] && x.resched?.by === 'companion' && x.resched.time === t3[1], 'customer sees the suggestion, booking keeps its time meanwhile');
ok((await theirs(id))?.resched?.by === 'companion', 'companion sees it too');
ok(await notified(A, 'Noah suggests another time'), 'customer is told');
ok((await book(B, t3)).status === 409, 'the suggested time is held for others');
ok((await call('POST', `/bookings/${id}/reschedule`, A, { date: t4[0], time: t4[1] })).status === 409, 'customer must answer the suggestion before moving it');
ok((await call('POST', `/bookings/${id}/reschedule/accept`, N)).status === 409, 'the one who suggested can’t accept it');
r = await call('POST', `/bookings/${id}/reschedule/accept`, A);
ok(r.status === 200 && r.data.confirmed === true, 'customer accepts');
x = await mine(id);
ok(x.status === 'confirmed' && x.time === t3[1] && !x.resched && /^\d{4}$/.test(x.otp), 'booking is confirmed at the new time (with a meet code)');
ok(await openAt(...t2) && !(await openAt(...t3)), 'the old time is free again');
ok(await notified(N, 'Mira accepted the new time'), 'Noah is told');

// 4) Confirmed: the customer suggests, changes their mind, Noah declines
r = await call('POST', `/bookings/${id}/reschedule`, A, { date: t4[0], time: t4[1] });
ok(r.status === 200 && r.data.moved === false && (await mine(id)).resched?.by === 'customer', 'customer suggests a new time for the confirmed booking');
r = await call('POST', `/bookings/${id}/reschedule`, A, { date: t5[0], time: t5[1] });
ok(r.status === 200 && (await mine(id)).resched?.time === t5[1] && (await openAt(...t4)), 'they can replace their own suggestion (the first one is free again)');
ok((await call('POST', `/bookings/${id}/reschedule/accept`, A)).status === 409, 'and can’t accept it themselves');
r = await call('DELETE', `/bookings/${id}/reschedule`, N);
ok(r.status === 200 && r.data.withdrawn === false, 'Noah declines');
x = await mine(id);
ok(!x.resched && x.time === t3[1] && await openAt(...t5), 'booking keeps its time, the suggested time is free again');
ok(await notified(A, 'Noah can’t make the new time'), 'customer is told');

// 5) Noah suggests, then withdraws
await call('POST', `/bookings/${id}/reschedule`, N, { date: t6[0], time: t6[1] });
r = await call('DELETE', `/bookings/${id}/reschedule`, N);
ok(r.status === 200 && r.data.withdrawn === true && !(await mine(id)).resched, 'companion withdraws their suggestion');
ok(await notified(A, 'Noah kept the original time'), 'customer is told');

// 6) Limits
sql(`UPDATE bookings SET resched_at = unixepoch() + 1800, resched_by = 'companion' WHERE id = '${id}'`);
ok((await call('POST', `/bookings/${id}/reschedule/accept`, A)).status === 409, 'a suggestion less than an hour away can’t be accepted');
await fetch(`${BASE}/__scheduled?cron=*/10+*+*+*+*`);
ok(!(await mine(id)).resched, 'and the cron drops it');
const real = x.startsAt;
sql(`UPDATE bookings SET starts_at = unixepoch() + 5 * 3600 WHERE id = '${id}'`);
r = await call('POST', `/bookings/${id}/reschedule`, A, { date: t4[0], time: t4[1] });
ok(r.status === 409 && /24 hours/.test(r.data.error), 'customer can’t move a confirmed booking within 24 hours');
ok((await call('POST', `/bookings/${id}/reschedule`, N, { date: t4[0], time: t4[1] })).status === 200, 'the companion still can suggest one');
await call('DELETE', `/bookings/${id}/reschedule`, A);
sql(`UPDATE bookings SET starts_at = ${real}, resched_count = 3 WHERE id = '${id}'`);
r = await call('POST', `/bookings/${id}/reschedule`, A, { date: t4[0], time: t4[1] });
ok(r.status === 409 && /3 times/.test(r.data.error) && (await mine(id)).reschedLeft === 0, 'at most 3 moves per booking');
sql(`UPDATE bookings SET resched_count = 1 WHERE id = '${id}'`);

// 7) Cancelling drops an open suggestion and frees both times
await call('POST', `/bookings/${id}/reschedule`, N, { date: t6[0], time: t6[1] });
ok(!(await openAt(...t6)), 'suggested time held');
r = await call('POST', `/bookings/${id}/cancel`, A, { reason: 'Plans changed' });
x = await mine(id);
ok(r.status === 200 && x.status === 'cancelled' && !x.resched, 'cancelling clears the suggestion');
ok(await openAt(...t6) && await openAt(...t3), 'both the booked and the suggested time are free again');
ok((await call('POST', `/bookings/${id}/reschedule`, A, { date: t4[0], time: t4[1] })).status === 409, 'a cancelled booking can’t be moved');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll reschedule checks passed');
process.exit(failures ? 1 : 0);
