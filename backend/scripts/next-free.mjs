// Real-time availability: any 15-minute start, and once a booking is confirmed, everyone else's next free time moves
// to right where it ends (a request alone holds no time). Runs against a LOCAL API with the demo companions seeded
// (it sets Noah's own hours for the next 8 days and removes them again). Usage: node scripts/next-free.mjs [api]
import { execSync } from 'node:child_process';

const [BASE = 'http://localhost:8787'] = process.argv.slice(2);
const CID = 'demo_noah';
let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? '✓' : '✗'} ${label}`); if (!cond) failures++; };
const call = async (method, path, token, body) => {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', 'X-ZeitMit-Api': '3', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const login = async (email) => {
  const r = await call('POST', '/auth/request-code', null, { email });
  return (await call('POST', '/auth/verify', null, { email, code: r.data.devCode })).data;
};
const sql = (q) => execSync(`npx wrangler d1 execute DB --local --command "${q}"`, { stdio: 'pipe' });
const berlin = (days) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + days * 86400000));
const clock = (unix) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(unix * 1000));
const dateOf = (unix) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(unix * 1000));

const N = await login('noah@demo.zeitmit.app');
const mk = async (name) => {
  const u = await login(`next+${name}+${Date.now()}@example.com`);
  await call('PATCH', '/me', u.token, { name, ageConfirmed: true });
  sql(`UPDATE users SET id_status = 'approved' WHERE id = '${u.user.id}'`);
  return u.token;
};
const A = await mk('Anna'), B = await mk('Ben'), C = await mk('Cleo');
const left = (await call('GET', '/companion/bookings', N.token)).data;
for (const x of [...left.requests, ...left.upcoming]) await call('POST', `/companion/bookings/${x.id}/cancel`, N.token, { reason: 'Something else' });
const slots = async () => (await call('GET', `/companions/${CID}/slots`)).data;
const listed = async () => (await call('GET', '/companions')).data.find((c) => c.id === CID);
const book = (token, date, time, dur) => call('POST', '/bookings', token, { companionId: CID, act: 'movies', date, time, dur, place: '' });
const accept = (id) => call('POST', `/companion/bookings/${id}/accept`, N.token);
const minutesOf = (t) => +t.slice(0, 2) * 60 + +t.slice(3);

// 1) Weekly hours: any 15-minute start (older apps get one every half hour)
const a = (await call('GET', `/companions/${CID}/availability`)).data;
const span = a.kinds.meet.open.find(([s, e]) => e - s >= 3 * 3600);
ok(a.step === 15 && a.kinds.meet.min === 60 && a.kinds.meet.max === 480 && a.kinds.video === null, 'availability: 15-minute steps, 1 to 8 hours in person, no video dates for Noah');
ok(span && span[0] % 900 === 0, `free time comes as intervals, starting on the 15-minute grid (${span && `${dateOf(span[0])} ${clock(span[0])}–${clock(span[1])}`})`);
const week = await slots();
const full = week.slice(1).find((d) => d.times.length >= 6);
const gaps = full.times.slice(1).map((t, i) => minutesOf(t) - minutesOf(full.times[i]));
ok(gaps.every((g) => g >= 30 && g % 30 === 0) && gaps.filter((g) => g === 30).length >= 4, `older apps: a start every half hour (${full.date}: ${full.times.slice(0, 6).join(', ')} …)`);

// 2) Only one open stretch in the next 8 days: 18:00–21:00 in three days
const day = berlin(3);
for (let i = 0; i <= 7; i++) await call('PUT', `/companion/hours/days/${berlin(i)}`, N.token, { ranges: berlin(i) === day ? [{ from: '18:00', to: '21:00' }] : [] });
let L = await listed();
ok(L.next && dateOf(L.next) === day && clock(L.next) === '18:00', `next free: ${day} 18:00 (${L.next && `${dateOf(L.next)} ${clock(L.next)}`})`);
ok(L.free.meet.next === L.next && L.free.video === null, 'the same for in-person dates, and no video dates');

// 3) Anna requests the next free time for an hour: it stays free until Noah accepts
let r = await book(A, day, '18:00', 1);
ok(r.status === 201 && r.data.status === 'pending', 'Anna requests 18:00 for an hour');
const anna = r.data.id;
L = await listed();
ok(clock(L.next) === '18:00', `a request holds no time: Noah is still next free at 18:00 (${clock(L.next)})`);
r = await book(B, day, '18:30', 1);
ok(r.status === 201, 'so Ben can request 18:30 too');
const benEarly = r.data.id;
ok((await accept(anna)).status === 200, 'Noah accepts Anna’s request');
L = await listed();
ok(clock(L.next) === '19:00' && dateOf(L.next) === day, `the list says Noah is next free at 19:00, where Anna’s booking ends (${clock(L.next)})`);
let d = (await slots()).find((x) => x.date === day);
ok(d.times[0] === '19:00' && !d.times.includes('18:00') && !d.times.includes('18:30'), `on his profile too: ${d.times.join(', ')}`);
const benGone = (await call('GET', '/bookings', B)).data.find((x) => x.id === benEarly);
ok(benGone?.status === 'conflicted' && benGone.pay === 'refunded', 'Ben’s overlapping request ends as conflicted, refunded in full');
r = await book(B, day, '18:30', 1);
ok(r.status === 409, 'and nobody can request a time inside Anna’s booking any more');

// 4) Ben requests 19:15 for 1½ hours and Noah accepts: 15 minutes left either side, too short for a booking
r = await call('POST', '/bookings', B, { companionId: CID, act: 'movies', startsAt: L.next + 900, minutes: 90, place: '' });
ok(r.status === 201 && r.data.time === '19:15' && r.data.end === '20:45', `Ben requests 19:15–20:45 (${r.data?.time}–${r.data?.end ?? r.data?.error})`);
const ben = r.data.id;
await accept(ben);
L = await listed();
d = (await slots()).find((x) => x.date === day);
ok(L.next === null && !d.times.length, `19:00–19:15 and 20:45–21:00 are too short, so Noah isn’t free again this week (${d.times.join(', ') || 'no times'})`);

// 5) Ben cancels: the time comes back at once, and it's the next free time again
await call('POST', `/bookings/${ben}/cancel`, B);
L = await listed();
ok(clock(L.next) === '19:00', `Ben cancels: next free is 19:00 again (${L.next && clock(L.next)})`);
r = await book(C, day, '19:00', 2);
ok(r.status === 201 && (await accept(r.data.id)).status === 200, 'Cleo books the rest of the evening, and Noah accepts');
ok((await listed()).next === null, 'so the evening is full');

// 6) Filters follow it: not "available today" (day off), no free weekday left
L = await listed();
ok(L.today === false && L.days.length === 0, `no free time left: not “available today”, no free days (${JSON.stringify(L.days)})`);

// Clean up: back to the weekly hours
const mineNow = (await call('GET', '/companion/bookings', N.token)).data;
for (const x of mineNow.requests) await call('POST', `/companion/bookings/${x.id}/decline`, N.token);
for (const x of mineNow.upcoming) await call('POST', `/companion/bookings/${x.id}/cancel`, N.token, { reason: 'Something else' });
for (let i = 0; i <= 7; i++) await call('DELETE', `/companion/hours/days/${berlin(i)}`, N.token);
L = await listed();
ok(L.next !== null, 'own hours removed: Noah is free again on his weekly hours');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
