// In-person and video dates on one calendar: each range of hours is open for both kinds (the default), in person only
// or video only, and a confirmed booking of either kind takes the time for both. Both kinds are requests with the same
// rules: bookable from 3½ hours ahead in 15-minute steps (video from 30 minutes, in person from 1 hour), accepted
// within 24 hours and at least 3 hours before the start. Plus the per-kind controls of older app versions. Runs
// against a LOCAL API with the demo companions seeded (it sets and removes Yuki's own hours for the next 8 days, and
// briefly lets Noah offer video dates). Usage: node scripts/kinds.mjs [api]
import { execSync } from 'node:child_process';

const [BASE = 'http://localhost:8787'] = process.argv.slice(2);
const YID = 'demo_yuki'; // offers video dates and in-person activities
const NID = 'demo_noah'; // in person only
const TZ = 'Europe/Berlin';
let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? '✓' : '✗'} ${label}`); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(200); } return false; };
/** `old`: call like an app from before flexible times (no API version header). */
const call = async (method, path, token, body, old = false) => {
  const res = await fetch(BASE + path, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json', ...(old ? {} : { 'X-ZeitMit-Api': '3' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
const next = (date) => new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
const clock = (unix) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(unix * 1000));
const wallOf = (u) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(u * 1000)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) / 1000;
};
/** The moment a Berlin date and clock time happens ("24:00": the next midnight). */
const at = (date, hm) => {
  const [y, m, d] = date.split('-').map(Number), [h, mi] = hm.split(':').map(Number);
  const want = Date.UTC(y, m - 1, d, h, mi) / 1000;
  let u = want;
  for (let i = 0; i < 3; i++) u += want - wallOf(u);
  return u;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const Y = await login('yuki@demo.zeitmit.app');
const N = await login('noah@demo.zeitmit.app');
const customer = async (name) => {
  const u = await login(`kinds+${name.toLowerCase()}+${Date.now()}@example.com`);
  await call('PATCH', '/me', u.token, { name, ageConfirmed: true });
  sql(`UPDATE users SET id_status = 'approved' WHERE id = '${u.user.id}'`);
  return u.token;
};
const A = await customer('Anna'), B = await customer('Ben');
// A clean week for Yuki: no open bookings, no own hours or blocks, and video dates other suites finished today moved out of the way.
const open = (await call('GET', '/companion/bookings', Y.token)).data;
for (const x of [...open.requests, ...open.upcoming]) await call('POST', `/companion/bookings/${x.id}/cancel`, Y.token, { reason: 'Something else' });
sql(`UPDATE bookings SET starts_at = starts_at - 30 * 86400 WHERE companion_id = '${YID}' AND status = 'completed' AND starts_at > unixepoch() - 9 * 3600`);
sql(`DELETE FROM hours_days WHERE companion_id = '${YID}'; DELETE FROM hours_blocks WHERE companion_id = '${YID}'`);

const avail = async (cid = YID) => (await call('GET', `/companions/${cid}/availability`)).data;
/** Free time of one kind touching a date, as "18:00–22:00". */
const openOn = (a, kind, date) => (a.kinds[kind]?.open ?? []).filter(([s, e]) => e > at(date, '00:00') && s < at(next(date), '00:00')).map(([s, e]) => `${clock(s)}–${clock(e)}`);
const times = async (cid = YID) => (await call('GET', `/companions/${cid}/times`, null, null, true)).data;
const listed = async (cid = YID) => (await call('GET', '/companions')).data.find((c) => c.id === cid);
const on = (list, date) => list.find((d) => d.date === date);
const book = (token, act, date, time, minutes = 60) => call('POST', '/bookings', token, { companionId: YID, act, startsAt: at(date, time), minutes, place: '', boundariesAgreed: true });
const accept = (id) => call('POST', `/companion/bookings/${id}/accept`, Y.token);
const notes = async (token) => (await call('GET', '/me/notifications', token)).data;
const R = (from, to, kind) => (kind ? { from, to, kind } : { from, to });

// 1) One calendar, kinds per range: in person 18:00–22:00, video 20:00–24:00, in three days; nothing else this week
const day = berlin(3);
for (let i = 0; i <= 7; i++) {
  await call('PUT', `/companion/hours/days/${berlin(i)}`, Y.token, { ranges: berlin(i) === day ? [R('18:00', '20:00', 'meet'), R('20:00', '22:00'), R('22:00', '24:00', 'video')] : [] });
}
let a = await avail();
ok(same(openOn(a, 'meet', day), ['18:00–22:00']) && same(openOn(a, 'video', day), ['20:00–00:00']), `in person 18:00–22:00, video 20:00–24:00 (${openOn(a, 'meet', day)} / ${openOn(a, 'video', day)})`);
ok(a.kinds.meet.min === 60 && a.kinds.video.min === 30 && a.kinds.meet.max === 480 && a.kinds.video.max === 480, 'in person from 1 hour, video from 30 minutes, both up to 8 hours');
ok([0, 1, 2, 4, 5, 6, 7].every((i) => !openOn(a, 'meet', berlin(i)).length && !openOn(a, 'video', berlin(i)).length), 'nothing else open this week, for either');
let prof = (await call('GET', '/companion', Y.token)).data;
ok(same(on(prof.days, day)?.ranges.map((r) => r.kind), ['meet', 'both', 'video']), 'Yuki’s calendar keeps the kind of each range');
ok(same(on(prof.dates, day)?.ranges, [['18:00', '22:00']]) && same(on(prof.datesVideo, day)?.ranges, [['20:00', '24:00']]), 'older apps see the in-person and video hours apart');
let T = await times();
ok(on(T.meet, day).times[0] === '18:00' && on(T.meet, day).times.at(-1) === '21:00' && on(T.video, day).times[0] === '20:00' && on(T.video, day).times.at(-1) === '23:00', 'and their start times per kind');
let L = await listed();
ok(clock(L.free.meet.next) === '18:00' && clock(L.free.video.next) === '20:00' && clock(L.next) === '18:00', `the list: next free in person 18:00, video 20:00 (${clock(L.free.meet.next)}, ${clock(L.free.video.next)})`);
const noah = await listed(NID);
ok(noah.free.video === null && noah.free.meet !== null && (await avail(NID)).kinds.video === null && (await times(NID)).video === null, 'Noah offers no video dates: no video times at all');
ok(on((await call('GET', `/companions/${YID}/slots`, null, null, true)).data, day).times[0] === '18:00', 'older apps’ single list is the in-person times');

// 2) One clock: a confirmed in-person date takes the time for video too, and the other way round
let r = await book(A, 'coffee', day, '20:00', 120);
const coffee = r.data?.id;
ok(r.status === 201 && r.data.status === 'pending' && r.data.kind === 'meet', 'Anna requests coffee 20:00–22:00');
ok(same(openOn(await avail(), 'video', day), ['20:00–00:00']), 'a request holds no time: video still from 20:00');
ok((await accept(coffee)).status === 200, 'Yuki accepts');
ok(same(openOn(await avail(), 'video', day), ['22:00–00:00']), 'one clock: video now only from 22:00');
r = await book(B, 'call', day, '21:00', 30);
ok(r.status === 409, `Ben can’t request a video date inside Anna’s coffee (${r.data?.error})`);
await call('POST', `/bookings/${coffee}/cancel`, A, { reason: 'Plans changed' });
ok(same(openOn(await avail(), 'video', day), ['20:00–00:00']), 'Anna cancels: the time is free for both again');

// 3) Video dates are requests too, from 30 minutes in 15-minute steps
r = await book(B, 'call', day, '20:15', 30);
const vid = r.data?.id;
ok(r.status === 201 && r.data.status === 'pending' && r.data.kind === 'video' && r.data.time === '20:15' && r.data.end === '20:45', `Ben requests a 30-minute video date, 20:15–20:45 (${r.data?.status ?? r.data?.error})`);
let yb = (await call('GET', '/companion/bookings', Y.token)).data;
ok(yb.requests.some((x) => x.id === vid && x.kind === 'video' && x.minutes === 30), 'Yuki finds it among her requests, marked as a video date');
ok((await notes(B)).some((n) => n.title === 'Request sent to Yuki' && /has until .+ to accept\.$/.test(n.body)), 'Ben is told until when Yuki can accept');
ok((await notes(Y.token)).some((n) => n.title === 'New booking request' && /Video date/.test(n.body) && /Accept by /.test(n.body)), 'Yuki is told to accept by then');
ok((await book(B, 'call', day, '22:00', 20)).status === 400 && (await book(B, 'coffee', day, '18:00', 30)).status === 400, 'under 30 minutes for video, or under an hour in person, is refused');
ok((await call('POST', `/calls/${vid}`, B)).status === 409, 'no call before Yuki accepts');
ok((await accept(vid)).status === 200, 'Yuki accepts');
a = await avail();
ok(same(openOn(a, 'meet', day), ['18:00–20:15', '20:45–22:00']), `and the video date takes her in-person time too (${openOn(a, 'meet', day)})`);
r = await call('GET', `/bookings/${vid}/reschedule`, B);
ok(r.data.availability.kinds.meet === null && same(openOn(r.data.availability, 'video', day), ['20:00–00:00']), 'moving it offers her video time (its own time included)');

// 4) Cancelling: free until 24 hours before, for both kinds (no special case for video)
let mine = (await call('GET', '/bookings', B)).data.find((x) => x.id === vid);
ok(mine.freeUntil === mine.startsAt - 24 * 3600, 'free to cancel until 24 hours before');
sql(`UPDATE bookings SET starts_at = unixepoch() + 5 * 3600 WHERE id = '${vid}'`);
r = await call('POST', `/bookings/${vid}/cancel`, B, { reason: 'Plans changed' });
ok(r.status === 200 && r.data.late === true && r.data.refunded === 0, 'less than 24 hours before: no refund');

// 5) The same deadline for both kinds: within 24 hours, and at least 3 hours before the start
r = await book(A, 'call', day, '22:00', 60);
const req = r.data.id;
ok(r.data.status === 'pending' && r.data.expiresAt === row(req).created_at + 86400, 'days ahead: Yuki has 24 hours to accept');
sql(`UPDATE bookings SET created_at = unixepoch() - 86500 WHERE id = '${req}'`);
await cron();
ok(await until(() => row(req).status === 'expired'), 'no answer in 24 hours: the cron ends it as expired');
ok(row(req).pay_status === 'refunded' && (await notes(A)).some((n) => n.title === 'Request expired' && /Yuki didn’t reply in time/.test(n.body)), 'Anna is refunded and told');
ok((await notes(Y.token)).some((n) => n.title === 'Request expired'), 'Yuki is told it expired');
ok((await call('GET', '/bookings', A, null, true)).data.find((x) => x.id === req)?.status === 'cancelled', 'older apps show it as cancelled');
r = await book(A, 'coffee', day, '18:00');
const late = r.data.id;
sql(`UPDATE bookings SET created_at = unixepoch() - 86401 WHERE id = '${late}'`);
r = await accept(late);
ok(r.status === 409 && /expired/.test(r.data?.error) && row(late).status === 'expired', `accepting after that (before the cron runs) is refused: “${r.data?.error}”`);

// 6) A date starting soon: until 3 hours before the start
r = await book(A, 'coffee', day, '18:00');
const soon = r.data.id;
sql(`UPDATE bookings SET starts_at = unixepoch() + 4 * 3600 WHERE id = '${soon}'`);
mine = (await call('GET', '/bookings', A)).data.find((x) => x.id === soon);
ok(mine.expiresAt === mine.startsAt - 3 * 3600, `starting in 4 hours: Yuki has until 3 hours before (${clock(mine.expiresAt)})`);
ok((await accept(soon)).status === 200 && row(soon).status === 'confirmed', 'accepting in time works');
await call('POST', `/companion/bookings/${soon}/cancel`, Y.token, { reason: 'Something else' });
r = await book(A, 'call', day, '22:00', 45);
const tooSoon = r.data.id;
sql(`UPDATE bookings SET starts_at = unixepoch() + 3 * 3600 - 60 WHERE id = '${tooSoon}'`);
r = await accept(tooSoon);
ok(r.status === 409 && row(tooSoon).status === 'expired', 'less than 3 hours before the start: too late, refunded');

// 7) Yuki answers a request with another time: it waits for Anna's answer, past the 24 hours
r = await book(A, 'coffee', day, '18:00');
const counter = r.data.id;
r = await call('POST', `/bookings/${counter}/reschedule`, Y.token, { startsAt: at(day, '19:00') });
ok(r.status === 200 && r.data.moved === false, 'Yuki suggests 19:00 instead');
sql(`UPDATE bookings SET created_at = unixepoch() - 86500 WHERE id = '${counter}'`);
await cron();
await sleep(1500);
ok(row(counter).status === 'pending', 'past 24 hours, the request still waits for Anna’s answer to the new time');
r = await call('POST', `/bookings/${counter}/reschedule/accept`, A);
ok(r.status === 200 && r.data.confirmed === true && row(counter).status === 'confirmed' && clock(row(counter).starts_at) === '19:00', 'Anna accepts: confirmed for 19:00');
await call('POST', `/companion/bookings/${counter}/cancel`, Y.token, { reason: 'Something else' });

// 8) Notice: both kinds from 3½ hours ahead (today open 06:00–24:00 for both)
const today = berlin(0);
await call('PUT', `/companion/hours/days/${today}`, Y.token, { ranges: [R('06:00', '24:00')] });
const e0 = Math.ceil((Date.now() / 1000 + 3.5 * 3600) / 900) * 900;
a = await avail();
const e1 = Math.ceil((Date.now() / 1000 + 3.5 * 3600) / 900) * 900;
const expect = (e) => (e < at(next(today), '00:00') ? [`${clock(Math.max(e, at(today, '06:00')))}–00:00`] : []);
for (const kind of ['meet', 'video']) {
  const got = openOn(a, kind, today);
  ok(same(got, expect(e0)) || same(got, expect(e1)), `${kind === 'meet' ? 'in person' : 'video'} today: ${got.join(', ') || 'nothing'} (from 3½ hours ahead, in 15-minute steps)`);
}
ok(a.earliest === e0 || a.earliest === e1, `the earliest start is ${clock(a.earliest)}`);
await call('DELETE', `/companion/hours/days/${today}`, Y.token);

// 9) Older app versions' per-kind controls, on the same calendar
r = await call('PUT', `/companion/dates/${day}`, Y.token, { ranges: [['10:00', '12:00']], kind: 'video' }, true);
prof = (await call('GET', '/companion', Y.token)).data;
ok(r.status === 200 && same(on(prof.datesVideo, day)?.ranges, [['10:00', '12:00']]) && same(on(prof.dates, day)?.ranges, [['18:00', '22:00']]), 'an older app sets a date’s video hours: its in-person hours stay');
a = await avail();
ok(same(openOn(a, 'video', day), ['10:00–12:00']) && same(openOn(a, 'meet', day), ['18:00–22:00']), 'customers see both');
await call('DELETE', `/companion/dates/${day}?kind=video`, Y.token, null, true);
prof = (await call('GET', '/companion', Y.token)).data;
ok(!on(prof.datesVideo, day) && same(on(prof.dates, day)?.ranges, [['18:00', '22:00']]), 'back to the weekly video hours on that date: its in-person hours stay');
const had = prof.availVideo.includes('Sun-am');
await call('PUT', '/companion/availability', Y.token, { day: 'Sun', win: 'am', on: !had, kind: 'video' }, true);
const p2 = (await call('GET', '/companion', Y.token)).data;
ok(p2.availVideo.includes('Sun-am') === !had && p2.avail.includes('Sun-am') === prof.avail.includes('Sun-am'), 'a video-hours toggle leaves the in-person hours alone');
await call('PUT', '/companion/availability', Y.token, { day: 'Sun', win: 'am', on: had, kind: 'video' }, true);
ok(same((await call('GET', '/companion', Y.token)).data.week, prof.week), 'and switching it back restores the week exactly');

// 10) Starting video dates: hours open for both kinds are video hours at once
const n0 = (await call('GET', '/companion', N.token)).data;
await call('PATCH', '/companion', N.token, { acts: [...n0.acts, 'call'] });
const n1 = (await call('GET', '/companion', N.token)).data;
const na = await avail(NID);
ok(n1.availVideo.length > 0 && same([...n1.availVideo].sort(), [...n1.avail].sort()) && same(na.kinds.video.open, na.kinds.meet.open), `Noah adds video dates: his hours are open for them too (${n1.availVideo.length} windows)`);
await call('PATCH', '/companion', N.token, { acts: n0.acts });
ok((await avail(NID)).kinds.video === null && (await times(NID)).video === null, 'without video dates again: no video times');

// Clean up: Yuki back to her weekly hours
for (const x of (await call('GET', '/companion/bookings', Y.token)).data.upcoming) await call('POST', `/companion/bookings/${x.id}/cancel`, Y.token, { reason: 'Something else' });
for (let i = 0; i <= 7; i++) await call('DELETE', `/companion/hours/days/${berlin(i)}`, Y.token);
L = await listed();
ok(L.free.meet.next !== null && L.free.video.next !== null, 'own hours removed: Yuki is free again on her weekly hours, both kinds');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
