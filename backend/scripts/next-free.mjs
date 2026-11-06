// Real-time availability: start times every half hour, and when someone books, everyone else's next free time moves to
// right where that booking ends. Runs against a LOCAL API with the demo companions seeded (it sets Noah's own hours
// for the next 7 days and removes them again). Usage: node scripts/next-free.mjs [api]
import { execSync } from 'node:child_process';

const [BASE = 'http://localhost:8787'] = process.argv.slice(2);
const CID = 'demo_noah';
let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? '✓' : '✗'} ${label}`); if (!cond) failures++; };
const call = async (method, path, token, body) => {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
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

// 1) Weekly hours: a start every half hour (no fixed grid)
const week = await slots();
const full = week.slice(1).find((d) => d.times.length >= 6);
const gaps = full.times.slice(1).map((t, i) => (+t.slice(0, 2) * 60 + +t.slice(3)) - (+full.times[i].slice(0, 2) * 60 + +full.times[i].slice(3)));
ok(gaps.every((g) => g >= 30 && g % 30 === 0) && gaps.filter((g) => g === 30).length >= 4, `weekly hours give a start every half hour (${full.date}: ${full.times.slice(0, 6).join(', ')} …)`);

// 2) Only one open stretch in the next 7 days: 18:00–21:00 in three days
const day = berlin(3);
for (let i = 0; i < 7; i++) await call('PUT', `/companion/dates/${berlin(i)}`, N.token, { ranges: berlin(i) === day ? [['18:00', '21:00']] : [] });
let L = await listed();
ok(L.next && dateOf(L.next) === day && clock(L.next) === '18:00', `next free: ${day} 18:00 (${L.next && `${dateOf(L.next)} ${clock(L.next)}`})`);

// 3) Anna books the next free time for an hour: everyone else's next free time is 19:00, where hers ends
let r = await book(A, day, '18:00', 1);
ok(r.status === 201, 'Anna books 18:00 for an hour');
L = await listed();
ok(clock(L.next) === '19:00' && dateOf(L.next) === day, `the list says Noah is next free at 19:00 (${clock(L.next)})`);
let d = (await slots()).find((x) => x.date === day);
ok(d.times[0] === '19:00' && !d.times.includes('18:00') && !d.times.includes('18:30'), `on his profile too: ${d.times.join(', ')}`);
r = await book(B, day, '18:30', 1);
ok(r.status === 409, 'nobody else can take a time inside Anna’s booking');

// 4) Ben takes the next one for 1½ hours (19:00–20:30): the half hour left before 21:00 is too short for a booking
r = await book(B, day, '19:00', 1.5);
ok(r.status === 201, 'Ben books the next free time, 19:00, for 1½ hours');
L = await listed();
d = (await slots()).find((x) => x.date === day);
ok(L.next === null && !d.times.length, `20:30–21:00 is too short for a booking, so Noah isn’t free again this week (${d.times.join(', ') || 'no times'})`);

// 5) Ben cancels: the time comes back at once, and it's the next free time again
const bens = (await call('GET', '/bookings', B)).data.find((x) => x.time === '19:00');
await call('POST', `/bookings/${bens.id}/cancel`, B);
L = await listed();
ok(clock(L.next) === '19:00', `Ben cancels: next free is 19:00 again (${L.next && clock(L.next)})`);
r = await book(C, day, '19:00', 2);
ok(r.status === 201, 'Cleo books it for the rest of the evening');
ok((await listed()).next === null, 'and the evening is full');

// 6) Filters follow it: “today” is false (day off), the open weekday is the only one listed
L = await listed();
ok(L.today === false && L.days.length === 0, `no open time left: not “available today”, no open days (${JSON.stringify(L.days)})`);

// Clean up: back to the weekly hours
for (const x of (await call('GET', '/companion/bookings', N.token)).data.requests) await call('POST', `/companion/bookings/${x.id}/decline`, N.token);
for (let i = 0; i < 7; i++) await call('DELETE', `/companion/dates/${berlin(i)}`, N.token);
L = await listed();
ok(L.next !== null, 'own hours removed: Noah is free again on his weekly hours');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
