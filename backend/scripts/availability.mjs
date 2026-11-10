// Flexible 24-hour availability and booking, against a LOCAL API with the demo companions seeded (it sets and removes
// Yuki's own hours and blocks for the coming days, and moves booking times in the local database). Yuki offers both
// kinds of date: coffee is in person, "call" is a video date. Covers:
//   1 a 10:00–12:00 in-person booking           9 a booking past midnight
//   2 in-person requests overlapping it         10 11 PM for 2 hours
//   3 a video request overlapping it            11 blocking extra hours
//   4 in person overlapping an accepted video   12 opening them again
//   5 two overlapping requests accepted at once 13 two bookings back to back on one day
//   6 accepting just before the 3-hour deadline 14 (clock changes: scripts/engine-check.ts)
//   7 accepting after it                        15 cancelling frees the time
//   8 expiry 24 hours after the request
// plus the rules for start times and lengths, requests not holding time, statuses, older apps and the admin checks.
// Usage: node scripts/availability.mjs [api]
import { execSync } from 'node:child_process';

const [BASE = 'http://localhost:8787'] = process.argv.slice(2);
const YID = 'demo_yuki';
const TZ = 'Europe/Berlin';
let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? '✓' : '✗'} ${label}`); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(200); } return false; };
const call = async (method, path, token, body, headers = {}) => {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', 'X-ZeitMit-Api': '3', ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
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
const offset = (unix) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(unix * 1000)).map((x) => [x.type, +x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) / 1000 - Math.floor(unix / 60) * 60;
};
/** Unix time of a Berlin date and clock time (the test dates have no clock change). */
const at = (date, time) => { const guess = Date.parse(`${date}T${time}:00Z`) / 1000; return guess - offset(guess - offset(guess)); };
const clockOf = (unix) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(unix * 1000));

const Y = await login('yuki@demo.zeitmit.app');
const customer = async (name) => {
  const u = await login(`flex+${name.toLowerCase()}+${Date.now()}@example.com`);
  await call('PATCH', '/me', u.token, { name, ageConfirmed: true });
  sql(`UPDATE users SET id_status = 'approved' WHERE id = '${u.user.id}'`);
  return u.token;
};
const [A, B, C, D, E] = [await customer('Anna'), await customer('Ben'), await customer('Cleo'), await customer('Dora'), await customer('Erik')];
const open = (await call('GET', '/companion/bookings', Y.token)).data;
for (const x of [...open.requests, ...open.upcoming]) await call('POST', `/companion/bookings/${x.id}/cancel`, Y.token, { reason: 'Something else' });
sql(`UPDATE bookings SET starts_at = starts_at - 40 * 86400 WHERE companion_id = '${YID}' AND status IN ('confirmed', 'completed') AND starts_at > unixepoch() - 9 * 3600`);
sql(`DELETE FROM hours_blocks WHERE companion_id = '${YID}'`);

const book = (token, act, start, minutes) => call('POST', '/bookings', token, { companionId: YID, act, startsAt: start, minutes, place: '', boundariesAgreed: true });
const accept = (id) => call('POST', `/companion/bookings/${id}/accept`, Y.token);
const setDay = (date, ranges) => call('PUT', `/companion/hours/days/${date}`, Y.token, { ranges });
const free = async (kind) => (await call('GET', `/companions/${YID}/availability`)).data.kinds[kind].open;
const isFree = (list, s, e) => list.some(([a, b]) => a <= s && e <= b);
const notes = async (token) => (await call('GET', '/me/notifications', token)).data;

const D1 = berlin(2), D2 = berlin(3), D3 = berlin(4), D4 = berlin(5);
await setDay(D1, [{ from: '08:00', to: '20:00', kind: 'both' }]);

// ---- 1) An in-person booking from 10:00 to 12:00
let r = await book(A, 'coffee', at(D1, '10:00'), 120);
const b1 = r.data?.id;
ok(r.status === 201 && r.data.status === 'pending' && r.data.end === '12:00' && r.data.minutes === 120, `1  Anna asks for coffee ${D1} 10:00–12:00: a request (${r.data?.time}–${r.data?.end})`);
ok(isFree(await free('meet'), at(D1, '10:00'), at(D1, '12:00')), '   a request doesn’t take the time yet');
r = await accept(b1);
ok(r.status === 200 && row(b1).status === 'confirmed' && row(b1).decided_at, '   Yuki accepts: confirmed');
const meet1 = await free('meet'), video1 = await free('video');
ok(!isFree(meet1, at(D1, '10:00'), at(D1, '10:15')) && !isFree(video1, at(D1, '11:45'), at(D1, '12:00')), '   10:00–12:00 is gone, for in-person and video dates');
ok((await notes(A)).some((n) => n.title === 'Booking accepted' && /\d\d:\d\d–12:00\.$/.test(n.body)), '   Anna is told, with start and end');

// ---- 2) In-person requests against it (the table from the brief)
const table = [['10:00', 60, 409], ['11:00', 60, 409], ['11:30', 90, 409], ['09:30', 60, 409], ['12:00', 60, 201], ['13:00', 60, 201]];
const made = {};
for (const [t, m, want] of table) {
  r = await book(B, 'coffee', at(D1, t), m);
  made[t] = r.data?.id;
  ok(r.status === want, `2  ${t} for ${m} min: ${want === 409 ? 'BLOCKED' : 'available'} (${r.status}${r.status === 409 ? `: ${r.data?.error}` : ''})`);
}

// ---- 3) A video request overlapping the confirmed in-person date
r = await book(C, 'call', at(D1, '11:00'), 60);
ok(r.status === 409, `3  a video date at 11:00 overlapping it is blocked (${r.status})`);
r = await book(C, 'call', at(D1, '11:45'), 30);
ok(r.status === 409, '   so is 11:45–12:15 (partly overlapping)');

// ---- 13) Two bookings back to back on the same day
r = await accept(made['12:00']);
ok(r.status === 200 && row(made['12:00']).status === 'confirmed', '13 12:00–13:00 right after it is confirmed too: back to back is fine');
r = await accept(made['13:00']);
ok(r.status === 200, '   and 13:00–14:00 after that');

// ---- 4) An in-person request overlapping an accepted video date
r = await book(C, 'call', at(D1, '15:00'), 60);
const v4 = r.data?.id;
ok(r.status === 201 && r.data.kind === 'video' && r.data.status === 'pending', '4  Cleo asks for a video date 15:00–16:00: a request too (video dates need the companion’s OK)');
ok((await accept(v4)).status === 200, '   Yuki accepts it');
r = await book(D, 'coffee', at(D1, '15:30'), 60);
ok(r.status === 409, `   coffee 15:30–16:30 overlapping it is blocked (${r.status})`);
r = await book(D, 'coffee', at(D1, '14:30'), 60);
ok(r.status === 409, '   so is 14:30–15:30');
r = await book(D, 'coffee', at(D1, '16:00'), 60);
ok(r.status === 201, '   16:00–17:00, right after it, is fine');
const after4 = r.data?.id;

// ---- 5) Two overlapping requests accepted at the same moment: exactly one wins
const p1 = (await book(D, 'coffee', at(D1, '17:00'), 60)).data.id;
const p2 = (await book(E, 'call', at(D1, '17:30'), 60)).data.id;
ok(p1 && p2 && row(p1).status === 'pending' && row(p2).status === 'pending', '5  Dora (coffee 17:00–18:00) and Erik (video 17:30–18:30) both ask: overlapping requests are allowed');
const [x1, x2] = await Promise.all([accept(p1), accept(p2)]);
const won = [x1, x2].filter((x) => x.status === 200).length;
const lostId = x1.status === 200 ? p2 : p1, wonId = x1.status === 200 ? p1 : p2;
ok(won === 1 && [x1, x2].some((x) => x.status === 409), `   accepted at the same moment: exactly one succeeds (${x1.status}, ${x2.status})`);
const lost = row(lostId);
ok(lost.status === 'conflicted' && lost.pay_status === 'refunded' && lost.conflict_with === wonId, `   the other is CONFLICTED, refunded, and points at the winner (${lost.status})`);
ok(row(wonId).status === 'confirmed', '   the winner is confirmed');
const loser = lostId === p1 ? D : E;
ok((await notes(loser)).some((n) => n.title === 'Yuki isn’t free then any more'), '   the other customer is told');
// Accepting one also ends every other request for an overlapping time.
const q1 = (await book(A, 'coffee', at(D1, '18:30'), 60)).data.id;
const q2 = (await book(B, 'call', at(D1, '19:00'), 60)).data.id;
ok((await accept(q1)).status === 200 && row(q2).status === 'conflicted', '   accepting 18:30–19:30 turns the overlapping 19:00 video request into CONFLICTED');
r = await accept(q2);
ok(r.status === 409, '   which can’t be accepted any more');

// ---- 6 & 7) The 3-hour deadline
await setDay(D2, [{ from: '08:00', to: '22:00', kind: 'both' }]);
const d6 = (await book(A, 'coffee', at(D2, '10:00'), 60)).data.id;
sql(`UPDATE bookings SET starts_at = unixepoch() + 3 * 3600 + 20 WHERE id = '${d6}'`);
r = await accept(d6);
ok(r.status === 200 && row(d6).status === 'confirmed', `6  accepted seconds before the 3-hour deadline: confirmed (${r.status}; exactly at it: engine-check)`);
await call('POST', `/companion/bookings/${d6}/cancel`, Y.token, { reason: 'Something else' });
const d7 = (await book(B, 'coffee', at(D2, '11:00'), 60)).data.id;
sql(`UPDATE bookings SET starts_at = unixepoch() + 3 * 3600 - 5 WHERE id = '${d7}'`);
r = await accept(d7);
ok(r.status === 409 && /at least 3 hours before/.test(r.data?.error), `7  5 seconds past the deadline: refused (“${r.data?.error}”)`);
ok(row(d7).status === 'expired' && row(d7).pay_status === 'refunded', '   and the request is EXPIRED, refunded');
ok((await notes(B)).some((n) => n.title === 'Request expired'), '   Ben is told');

// ---- 8) Expiry 24 hours after the request
const d8 = (await book(C, 'coffee', at(D2, '14:00'), 60)).data.id;
const due = row(d8);
ok(due.expires_at === due.created_at + 86400, '8  a request days ahead expires 24 hours after it was sent');
sql(`UPDATE bookings SET created_at = unixepoch() - 86400 - 60 WHERE id = '${d8}'`);
await cron();
ok(await until(() => row(d8).status === 'expired'), '   after 24 hours without an answer the cron expires it');
ok((await accept(d8)).status === 409, '   it can’t be accepted any more');
r = await book(D, 'coffee', at(D2, '14:00'), 60);
ok(r.status === 201 && (await accept(r.data.id)).status === 200, '   and it never held the time: someone else books and gets 14:00 confirmed');
const near = (await book(E, 'coffee', at(D2, '16:00'), 60)).data;
ok(near.expiresAt === Math.min(row(near.id).created_at + 86400, at(D2, '16:00') - 3 * 3600), '   expiry is the sooner of 24 hours after the request and 3 hours before the start');

// ---- 9 & 10) Past midnight
await setDay(D3, [{ from: '22:00', to: '02:00', kind: 'both' }]);
r = await book(A, 'coffee', at(D3, '23:30'), 90);
const m9 = r.data;
ok(r.status === 201 && m9.end === '01:00' && m9.endsAt - m9.startsAt === 5400, `9  23:30 for 90 minutes runs past midnight: ${m9?.time}–${m9?.end}`);
ok((await accept(m9.id)).status === 200, '   and can be accepted');
await setDay(D4, [{ from: '20:00', to: '03:00', kind: 'both' }]);
r = await book(B, 'call', at(D4, '23:00'), 120);
ok(r.status === 201 && r.data.end === '01:00' && clockOf(r.data.endsAt) === '01:00', `10 a video date at 23:00 for 2 hours ends at 01:00 the next day (${r.data?.time}–${r.data?.end})`);
const m10 = r.data.id;
r = await book(C, 'coffee', at(D4, '22:15'), 90);
ok(r.status === 201 && r.data.end === '23:45', `   any start: 22:15 for 90 minutes ends 23:45 (${r.data?.time}–${r.data?.end})`);
ok((await accept(m10)).status === 200 && row(r.data.id).status === 'conflicted', '   accepting 23:00–01:00 ends the overlapping 22:15–23:45 request');
r = await book(D, 'coffee', at(berlin(6), '00:30'), 60);
ok(r.status === 409, '   00:30 that night (inside 23:00–01:00) is blocked');

// ---- 11 & 12) Blocking extra hours, and opening them again
await setDay(D2, [{ from: '08:00', to: '22:00', kind: 'both' }]);
r = await call('POST', '/companion/hours/blocks', Y.token, { startsAt: at(D2, '18:00'), endsAt: at(D2, '19:30'), note: 'Gym' });
const block = r.data?.block;
ok(r.status === 201 && block?.id, '11 Yuki blocks 18:00–19:30 (a break)');
ok(!isFree(await free('meet'), at(D2, '18:30'), at(D2, '18:45')) && !isFree(await free('video'), at(D2, '19:00'), at(D2, '19:15')), '   it’s closed for both kinds');
r = await book(E, 'coffee', at(D2, '18:30'), 60);
ok(r.status === 409, `   a request inside it is refused (${r.status})`);
r = await book(E, 'coffee', at(D2, '17:00'), 120);
ok(r.status === 409, '   so is one running into it (17:00–19:00)');
r = await book(E, 'coffee', at(D2, '19:30'), 60);
ok(r.status === 201, '   19:30, when it ends, is fine');
r = await call('PATCH', `/companion/hours/blocks/${block.id}`, Y.token, { endsAt: at(D2, '21:00') });
ok(r.status === 200 && !isFree(await free('meet'), at(D2, '20:00'), at(D2, '20:15')), '   the companion extends it to 21:00: 20:00 is closed now too');
r = await call('DELETE', `/companion/hours/blocks/${block.id}`, Y.token);
ok(r.status === 200 && isFree(await free('meet'), at(D2, '18:30'), at(D2, '19:30')), '12 the companion removes the block: 18:30 is free again');
r = await book(A, 'coffee', at(D2, '18:30'), 60);
ok(r.status === 201, '   and can be requested');
await setDay(D2, []);
ok(!isFree(await free('meet'), at(D2, '09:00'), at(D2, '10:00')), '   a day off closes the whole day');
await call('DELETE', `/companion/hours/days/${D2}`, Y.token);
const week = (await call('GET', '/companion', Y.token)).data.week.filter((x) => x.day === (new Date(D2 + 'T12:00:00Z').getUTCDay() + 6) % 7);
ok(week.length > 0 && isFree(await free('meet'), at(D2, week[0].from), at(D2, week[0].from) + 3600), `   back to the weekly hours that day: free from ${week[0]?.from} again`);

// ---- 15) Cancelling frees the time
await setDay(D3, [{ from: '10:00', to: '14:00', kind: 'both' }, { from: '22:00', to: '02:00', kind: 'both' }]);
r = await book(B, 'coffee', at(D3, '11:00'), 60);
const c15 = r.data.id;
await accept(c15);
ok(!isFree(await free('meet'), at(D3, '11:00'), at(D3, '12:00')), '15 a confirmed 11:00–12:00 takes the time');
r = await call('POST', `/bookings/${c15}/cancel`, B, { reason: 'Plans changed' });
ok(r.status === 200 && r.data.late === false && row(c15).status === 'cancelled' && row(c15).pay_status === 'refunded', '   Ben cancels (days ahead): CANCELLED, refunded in full');
ok(isFree(await free('meet'), at(D3, '11:00'), at(D3, '12:00')), '   11:00–12:00 is free again');
r = await book(C, 'coffee', at(D3, '11:00'), 60);
ok(r.status === 201 && (await accept(r.data.id)).status === 200, '   and someone else books it');
await call('POST', `/companion/bookings/${r.data.id}/cancel`, Y.token, { reason: 'Something else' });
// Time the companion closed stays closed when a booking in it is cancelled: nothing reopens by itself.
r = await book(A, 'coffee', at(D3, '12:00'), 60);
const c15b = r.data.id;
await accept(c15b);
const bl = (await call('POST', '/companion/hours/blocks', Y.token, { startsAt: at(D3, '12:00'), endsAt: at(D3, '13:00') })).data;
ok(bl.kept === 1, '   the companion blocks 12:00–13:00 while a booking is in it: the booking stays');
await call('POST', `/bookings/${c15b}/cancel`, A, { reason: 'Plans changed' });
ok(!isFree(await free('meet'), at(D3, '12:00'), at(D3, '13:00')), '   when it’s cancelled, 12:00–13:00 stays closed: the block wins, nothing reopens by itself');
await call('DELETE', `/companion/hours/blocks/${bl.block.id}`, Y.token);

// ---- Rules for start times and lengths
await setDay(D3, [{ from: '08:00', to: '23:00', kind: 'both' }]);
const rule = async (label, start, minutes, act = 'coffee') => { const x = await book(D, act, start, minutes); ok(x.status === 400, `R  ${label} (${x.status}: ${x.data?.error})`); };
await rule('a start off the 15-minute grid is refused', at(D3, '10:10'), 60);
await rule('a length off the 15-minute steps is refused', at(D3, '10:00'), 70);
await rule('in person needs at least an hour', at(D3, '10:00'), 45);
await rule('at most 8 hours', at(D3, '08:00'), 8 * 60 + 15);
await rule('at least 3½ hours ahead', Math.ceil((Date.now() / 1000 + 3 * 3600) / 900) * 900, 60);
await rule('at most 7 days ahead', at(berlin(8), '10:00'), 60);
r = await book(D, 'call', at(D3, '10:00'), 30);
ok(r.status === 201 && r.data.minutes === 30, 'R  a video date can be 30 minutes');
r = await book(D, 'coffee', at(D3, '12:00'), 75);
ok(r.status === 201 && r.data.total === Math.round(34 * 100 * 75 / 60 * 1.1), `R  75 minutes are priced by the minute (${r.data?.total} cents)`);
r = await book(D, 'coffee', at(D3, '12:30'), 60);
ok(r.status === 409 && /already asked/.test(r.data?.error), 'R  the same customer can’t ask twice for overlapping times');
r = await call('POST', '/bookings', E, { companionId: YID, act: 'coffee', date: D3, time: '15:00', dur: 1.5, place: '' });
ok(r.status === 201 && r.data.time === '15:00' && r.data.minutes === 90, 'R  older apps (date, time, hours in the companion’s zone) still book');

// ---- Statuses: declined, older apps
r = await book(A, 'coffee', at(D3, '17:00'), 60);
await call('POST', `/companion/bookings/${r.data.id}/decline`, Y.token);
ok(row(r.data.id).status === 'rejected' && row(r.data.id).pay_status === 'refunded', 'S  a declined request is REJECTED, refunded');
const mineNew = (await call('GET', '/bookings', A)).data.find((x) => x.id === r.data.id);
const mineOld = (await call('GET', '/bookings', A, undefined, { 'X-ZeitMit-Api': '' })).data.find((x) => x.id === r.data.id);
ok(mineNew.status === 'rejected' && mineOld.status === 'cancelled', 'S  this app sees “rejected”; older app versions see “cancelled”');
r = await accept(r.data.id);
ok(r.status === 409, 'S  a declined request can’t be accepted');
const requests = (await call('GET', '/companion/bookings', Y.token)).data.requests;
ok(requests.every((x) => typeof x.expiresAt === 'number' && typeof x.overlaps === 'number' && x.kind), 'S  Yuki’s requests come with their expiry, kind and how many others overlap');

// ---- Admin checks
const admin = (await call('GET', '/admin/bookings/conflicts', null)).status;
ok(admin === 401, 'A  the admin conflict check needs an admin');
const overlaps = JSON.parse(execSync(`npx wrangler d1 execute DB --local --json --command "SELECT COUNT(*) AS n FROM bookings a JOIN bookings b ON a.companion_id = b.companion_id AND a.id < b.id AND a.status IN ('confirmed','completed') AND b.status IN ('confirmed','completed') AND a.starts_at < b.ends_at AND a.ends_at > b.starts_at AND b.ends_at > unixepoch() AND a.starts_at % 900 = 0 AND b.starts_at % 900 = 0"`, { stdio: 'pipe' }).toString())[0].results[0].n;
// Every time the API gives a booking is on the 15-minute grid; the test scripts also move some bookings by hand in the
// database (to now ± a few seconds, off the grid) to reach meet codes and deadlines, and those are left out.
ok(overlaps === 0, `A  no two upcoming confirmed bookings of one companion overlap anywhere in the database (${overlaps})`);

// Clean up: Yuki's bookings, own hours and blocks
for (const x of [...(await call('GET', '/companion/bookings', Y.token)).data.requests, ...(await call('GET', '/companion/bookings', Y.token)).data.upcoming]) {
  await call('POST', `/companion/bookings/${x.id}/cancel`, Y.token, { reason: 'Something else' });
}
for (let i = 0; i < 9; i++) await call('DELETE', `/companion/hours/days/${berlin(i)}`, Y.token);
sql(`DELETE FROM hours_blocks WHERE companion_id = '${YID}'`);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
