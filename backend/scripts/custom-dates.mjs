// Companions' hours for specific dates (they replace the weekly windows that day) and days off.
// Runs against a LOCAL API with the demo companions seeded. Usage: node scripts/custom-dates.mjs [api]
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
const slots = async () => (await call('GET', `/companions/${CID}/slots`)).data;
const dayOf = (list, date) => list.find((d) => d.date === date);
const berlin = (offsetDays) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offsetDays * 86400000));

const N = await login('noah@demo.zeitmit.app');
const C = await login(`dates+${Date.now()}@example.com`);
await call('PATCH', '/me', C.token, { name: 'Dana Dates', ageConfirmed: true });
sql(`UPDATE users SET id_status = 'approved' WHERE id = '${C.user.id}'`);
const left = (await call('GET', '/companion/bookings', N.token)).data;
for (const x of [...left.requests, ...left.upcoming]) await call('POST', `/companion/bookings/${x.id}/cancel`, N.token, { reason: 'Something else' });
sql(`DELETE FROM availability_dates WHERE companion_id = '${CID}'`);
const before = await slots();
const [dOff, dCustom, dLate] = [berlin(3), berlin(4), berlin(5)];

// 1) What companions can enter
const put = (date, ranges, token = N.token) => call('PUT', `/companion/dates/${date}`, token, { ranges });
const bad = [
  [['2020-01-01', []], 'a date in the past'],
  [[berlin(61), []], 'more than 60 days ahead'],
  [['not-a-date', []], 'not a date'],
  [[dCustom, [['09:15', '11:00']]], 'times not on the half hour'],
  [[dCustom, [['05:00', '07:00']]], 'before 06:00'],
  [[dCustom, [['18:00', '18:30']]], 'a range shorter than an hour'],
  [[dCustom, [['18:00', '21:00'], ['20:00', '22:00']]], 'overlapping ranges'],
  [[dCustom, [['06:00', '07:00'], ['08:00', '09:00'], ['10:00', '11:00'], ['12:00', '13:00']]], 'more than 3 ranges'],
  [[dCustom, 'all day'], 'not a list'],
];
// Dates that look right but don't exist
const ym = berlin(0).slice(0, 7), year = +berlin(0).slice(0, 4);
const short = [berlin(0), berlin(31), berlin(59)].map((d) => d.slice(0, 7)).find((m) => new Date(`${m}-31T12:00:00Z`).getUTCMonth() + 1 !== +m.slice(5, 7));
bad.push([[`${ym}-32`, []], 'day 32'], [[`${year}-13-01`, []], 'month 13']);
if (short && `${short}-31` > berlin(0)) bad.push([[`${short}-31`, []], `${short}-31, a day that doesn’t exist`]);
for (const [[date, ranges], what] of bad) {
  const r = await put(date, ranges);
  ok(r.status === 400, `refused: ${what} (${r.data?.error})`);
}
ok((await put(dCustom, [['18:00', '21:00']], C.token)).status === 404, 'customers can’t set hours (404)');

// 2) A day off
let r = await put(dOff, []);
ok(r.status === 200 && JSON.stringify(r.data.ranges) === '[]', 'a day off is saved');
let s = await slots();
ok(dayOf(before, dOff).times.length > 0 && dayOf(s, dOff).times.length === 0 && dayOf(s, dOff).custom === true, `that day has no open times any more (had ${dayOf(before, dOff).times.length})`);
ok(JSON.stringify(dayOf(s, berlin(2))) === JSON.stringify(dayOf(before, berlin(2))), 'other days are unchanged');

// 3) Own hours: start times every half hour, bookings end by the range's end
r = await put(dCustom, [['18:00', '21:00']]);
s = await slots();
const dc = dayOf(s, dCustom);
ok(dc.custom === true && JSON.stringify(dc.times) === '["18:00","18:30","19:00","19:30","20:00"]', `own hours 18:00–21:00 → starts ${dc.times.join(', ')}`);
ok(JSON.stringify(dc.fit) === '[3,2.5,2,1.5,1]', `each booking ends by 21:00 (longest: ${dc.fit.join(', ')} h)`);
r = await put(dLate, [['21:00', '24:00'], ['10:00', '12:00']]);
ok(JSON.stringify(r.data.ranges) === '[["10:00","12:00"],["21:00","24:00"]]', 'ranges are stored in order');
s = await slots();
const dl = dayOf(s, dLate);
ok(dl.times[0] === '10:00' && dl.times.includes('11:00') && !dl.times.includes('11:30') && dl.times.at(-1) === '23:00' && dl.fit.at(-1) === 1 && dl.fit[dl.times.indexOf('21:00')] === 3, `up to midnight works (${dl.times.join(', ')})`);
const me = (await call('GET', '/companion', N.token)).data;
ok(me.dates.length === 3 && me.dates.map((d) => d.date).join() === [dOff, dCustom, dLate].join(), 'the companion’s profile lists the dates in order');

// 4) Customers can book a time that only exists on that date
r = await call('POST', '/bookings', C.token, { companionId: CID, act: 'movies', date: dCustom, time: '19:00', dur: 1, place: 'Kino Babylon' });
ok(r.status === 201 || r.status === 200, `a customer books 19:00 on the custom date (${r.status} ${r.data?.error ?? ''})`);
const bid = r.data?.id;
s = await slots();
ok(JSON.stringify(dayOf(s, dCustom).times) === '["18:00","20:00"]' && JSON.stringify(dayOf(s, dCustom).fit) === '[1,1]', `the booking blocks its hour (left: ${dayOf(s, dCustom).times.join(', ')})`);
r = await call('POST', '/bookings', C.token, { companionId: CID, act: 'movies', date: dCustom, time: '20:00', dur: 2, place: '' });
ok(r.status === 409, `a booking past the range’s end is refused (${r.data?.error})`);
r = await call('POST', '/bookings', C.token, { companionId: CID, act: 'movies', date: dOff, time: '20:00', dur: 1, place: '' });
ok(r.status === 409, 'nothing can be booked on a day off');

// 5) Changing hours keeps bookings already made
r = await put(dCustom, []);
ok(r.status === 200 && r.data.kept === 1, `a day off where a booking exists: it stays (kept ${r.data?.kept})`);
ok((await call('GET', '/bookings', C.token)).data.some((b) => b.id === bid && b.status === 'pending'), 'the booking is still there');
await call('POST', `/bookings/${bid}/cancel`, C.token);

// 6) Back to the weekly windows
for (const d of [dOff, dCustom, dLate]) ok((await call('DELETE', `/companion/dates/${d}`, N.token)).status === 200, `removed the hours for ${d}`);
s = await slots();
ok([dOff, dCustom, dLate].every((d) => JSON.stringify(dayOf(s, d)) === JSON.stringify(dayOf(before, d))), 'those days are back to the weekly windows');
ok(!(await call('GET', '/companion', N.token)).data.dates.length, 'and the list is empty');

// 7) The companion list (the search filters today / tomorrow / weekend / soonest) follows the dates too
const WK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const listed = async () => (await call('GET', '/companions')).data.find((x) => x.id === CID);
const wdOf = (date) => (new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7;
ok((await listed()).days.includes(wdOf(dOff)), `listed with weekly hours on ${WK[wdOf(dOff)]}`);
await put(dOff, []);
ok(!(await listed()).days.includes(wdOf(dOff)), 'a day off takes that day out of the list’s open days');
await call('DELETE', `/companion/dates/${dOff}`, N.token);
const wd = WK[wdOf(dLate)];
const had = (await call('GET', '/companion', N.token)).data.avail.filter((w) => w.startsWith(wd + '-'));
for (const w of had) await call('PUT', '/companion/availability', N.token, { day: wd, win: w.split('-')[1], on: false });
ok(!(await listed()).days.includes(wdOf(dLate)), `with no weekly hours on ${wd}, that day isn’t open`);
await put(dLate, [['18:00', '22:00']]);
ok((await listed()).days.includes(wdOf(dLate)), 'own hours on that date make it open');
await call('DELETE', `/companion/dates/${dLate}`, N.token);
for (const w of had) await call('PUT', '/companion/availability', N.token, { day: wd, win: w.split('-')[1], on: true });
ok((await listed()).days.includes(wdOf(dLate)), 'weekly hours restored');
const [hh, mm] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).split(':').map(Number);
const nowMin = hh * 60 + mm;
await put(berlin(0), [['06:00', '07:00']]);
ok((await listed()).today === (7 * 60 - 120 >= nowMin), `own hours earlier today (06:00–07:00): available today = ${7 * 60 - 120 >= nowMin}`);
await put(berlin(0), [['22:00', '24:00']]);
ok((await listed()).today === (24 * 60 - 120 >= nowMin), `own hours tonight (22:00–24:00): available today = ${24 * 60 - 120 >= nowMin}`);
await call('DELETE', `/companion/dates/${berlin(0)}`, N.token);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
