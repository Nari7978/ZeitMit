// Companions' hours for specific dates (they replace the weekly hours that day, in the companion’s time zone), days off, hours
// past midnight and blocked time, plus the routes older app versions use. Runs against a LOCAL API with the demo
// companions seeded. Usage: node scripts/custom-dates.mjs [api]
import { execSync } from 'node:child_process';

const [BASE = 'http://localhost:8787'] = process.argv.slice(2);
const CID = 'demo_noah';
const TZ = 'Europe/Berlin';
let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? '✓' : '✗'} ${label}`); if (!cond) failures++; };
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

// Dates and clock times in Berlin
const berlin = (offsetDays) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offsetDays * 86400000));
const next = (date) => new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
const wallOf = (u) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(u * 1000)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) / 1000;
};
/** The moment a Berlin date and clock time ("24:00" is the next midnight) happens. */
const at = (date, hm) => {
  const [y, m, d] = date.split('-').map(Number), [h, mi] = hm.split(':').map(Number);
  const want = Date.UTC(y, m - 1, d, h, mi) / 1000;
  let u = want;
  for (let i = 0; i < 3; i++) u += want - wallOf(u);
  return u;
};
const clockOf = (u) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(u * 1000));
/** Noah's open in-person time touching a date, as "18:15–21:00" (an interval past midnight shows its end next day). */
const openOn = async (date) => {
  const a = (await call('GET', `/companions/${CID}/availability`)).data;
  const s0 = at(date, '00:00'), s1 = at(next(date), '00:00');
  return a.kinds.meet.open.filter(([s, e]) => e > s0 && s < s1).map(([s, e]) => `${clockOf(s)}–${clockOf(e)}`);
};
const same = (list, want) => JSON.stringify(list) === JSON.stringify(want);
const slots = async () => (await call('GET', `/companions/${CID}/slots`, null, null, true)).data;
const dayOf = (list, date) => list.find((d) => d.date === date);

const N = await login('noah@demo.zeitmit.app');
const C = await login(`dates+${Date.now()}@example.com`);
await call('PATCH', '/me', C.token, { name: 'Dana Dates', ageConfirmed: true });
sql(`UPDATE users SET id_status = 'approved' WHERE id = '${C.user.id}'`);
const left = (await call('GET', '/companion/bookings', N.token)).data;
for (const x of [...left.requests, ...left.upcoming]) await call('POST', `/companion/bookings/${x.id}/cancel`, N.token, { reason: 'Something else' });
sql(`DELETE FROM hours_days WHERE companion_id = '${CID}'; DELETE FROM hours_blocks WHERE companion_id = '${CID}'`);
const [dOff, dCustom, dLate] = [berlin(3), berlin(4), berlin(5)];
const before = await slots();
const openBefore = await openOn(dOff);

// 1) What companions can enter
const R = (from, to, kind) => (kind ? { from, to, kind } : { from, to });
const put = (date, ranges, token = N.token) => call('PUT', `/companion/hours/days/${date}`, token, { ranges });
const bad = [
  [['2020-01-01', []], 'a date in the past'],
  [[berlin(61), []], 'more than 60 days ahead'],
  [['not-a-date', []], 'not a date'],
  [[dCustom, [R('09:10', '11:00')]], 'times off the 15-minute steps'],
  [[dCustom, [R('18:00', '18:15')]], 'a range shorter than 30 minutes'],
  [[dCustom, [R('18:00', '21:00'), R('20:00', '22:00', 'video')]], 'overlapping ranges, even of different kinds'],
  [[dCustom, Array.from({ length: 7 }, (_, i) => R(`${String(i * 3).padStart(2, '0')}:00`, `${String(i * 3 + 1).padStart(2, '0')}:00`))], 'more than 6 ranges'],
  [[dCustom, [R('18:00', '21:00', 'hotel')]], 'an unknown kind'],
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
ok((await put(dCustom, [R('18:00', '21:00')], C.token)).status === 404, 'customers can’t set hours (404)');

// 2) A day off
let r = await put(dOff, []);
ok(r.status === 200 && same(r.data.ranges, []), 'a day off is saved');
ok(openBefore.length > 0 && !(await openOn(dOff)).length, `nothing is open that day any more (was ${openBefore.join(', ')})`);
let s = await slots();
ok(dayOf(s, dOff).times.length === 0, 'older apps see the day off too');
ok(same(dayOf(s, berlin(2)), dayOf(before, berlin(2))), 'other days are unchanged');

// 3) Own hours, any 15-minute start
r = await put(dCustom, [R('18:15', '21:00')]);
ok(r.status === 200 && same(r.data.ranges, [R('18:15', '21:00', 'both')]), 'own hours 18:15–21:00 are saved, for both kinds of date unless the companion picks one');
ok(same(await openOn(dCustom), ['18:15–21:00']), `open that day: ${(await openOn(dCustom)).join(', ')}`);
s = await slots();
const dc = dayOf(s, dCustom);
ok(same(dc.times, ['18:30', '19:00', '19:30', '20:00']) && same(dc.fit, [2.5, 2, 1.5, 1]), `older apps get half-hour starts that end by 21:00 (${dc.times.join(', ')})`);
r = await put(dCustom, [R('18:15', '21:00', 'video')]);
ok(r.status === 200 && !(await openOn(dCustom)).length, 'a range for video dates only opens nothing in person');
await put(dCustom, [R('18:15', '21:00')]);

// 4) Hours past midnight
r = await put(dLate, [R('22:00', '02:00'), R('10:00', '12:00')]);
ok(r.status === 200 && same(r.data.ranges.map((x) => `${x.from}–${x.to}`), ['10:00–12:00', '22:00–02:00']), 'ranges are stored in order, one running past midnight');
ok(same(await openOn(dLate), ['10:00–12:00', '22:00–02:00']), `open: ${(await openOn(dLate)).join(', ')} (into the next morning)`);
s = await slots();
const dl = dayOf(s, dLate), dn = dayOf(s, next(dLate));
ok(same(dl.times, ['10:00', '10:30', '11:00', '22:00', '22:30', '23:00', '23:30']) && dl.fit.at(-1) === 2.5, `older apps: starts up to 23:30 that day (${dl.times.join(', ')})`);
ok(!dn || (dn.times.slice(0, 3).join() === '00:00,00:30,01:00' && dn.times[3] !== '01:30'), 'and 00:00 to 01:00 the next morning');
let me = (await call('GET', '/companion', N.token)).data;
ok(me.days.map((d) => d.date).join() === [dOff, dCustom, dLate].join(), 'the companion’s profile lists the dates in order');
ok(me.dates.length === 3 && same(me.dates.find((d) => d.date === dLate).ranges, [['10:00', '12:00'], ['22:00', '24:00']]), 'older apps see the dates, cut at midnight');

// 5) Customers can book a time that only exists on that date
const bookAt = (date, hm, minutes) => call('POST', '/bookings', C.token, { companionId: CID, act: 'movies', startsAt: at(date, hm), minutes, place: 'Kino Babylon' });
r = await bookAt(dCustom, '19:00', 60);
ok(r.status === 201, `a customer requests 19:00–20:00 on that date (${r.status} ${r.data?.error ?? ''})`);
const bid = r.data?.id;
ok(same(await openOn(dCustom), ['18:15–21:00']), 'a request holds no time');
ok((await call('POST', `/companion/bookings/${bid}/accept`, N.token)).status === 200, 'Noah accepts');
ok(same(await openOn(dCustom), ['18:15–19:00', '20:00–21:00']), `now that hour is taken (open: ${(await openOn(dCustom)).join(', ')})`);
s = await slots();
ok(same(dayOf(s, dCustom).times, ['20:00']), `older apps: only 20:00 is left (${dayOf(s, dCustom).times.join(', ')})`);
r = await bookAt(dCustom, '20:00', 120);
ok(r.status === 409, `a booking past the range’s end is refused (${r.data?.error})`);
r = await bookAt(dOff, '20:00', 60);
ok(r.status === 409, 'nothing can be booked on a day off');
r = await bookAt(dLate, '23:30', 120);
ok(r.status === 201 && r.data.end === '01:30', `23:30 for 2 hours runs to 01:30 (${r.data?.end ?? r.data?.error})`);
const late = r.data?.id;
r = await bookAt(next(dLate), '01:30', 60);
ok(r.status === 409, 'past 02:00 is refused');

// 6) Changing hours keeps bookings already made
r = await put(dCustom, []);
ok(r.status === 200 && r.data.kept === 1, `a day off where a booking exists: it stays (kept ${r.data?.kept})`);
ok((await call('GET', '/bookings', C.token)).data.some((b) => b.id === bid && b.status === 'confirmed'), 'the booking is still confirmed');

// 7) Blocked time: breaks, extending them, a night off
const block = (startsAt, endsAt, note) => call('POST', '/companion/hours/blocks', N.token, { startsAt, endsAt, note });
for (const [[a, b], what] of [
  [[at(dLate, '10:10'), at(dLate, '11:00')], 'off the 15-minute steps'],
  [[at(dLate, '11:00'), at(dLate, '10:30')], 'ending before it starts'],
  [[at(berlin(-1), '10:00'), at(berlin(-1), '11:00')], 'already over'],
  [[at(berlin(62), '10:00'), at(berlin(62), '11:00')], 'more than 60 days ahead'],
]) ok((await block(a, b)).status === 400, `a block is refused: ${what}`);
ok((await call('POST', '/companion/hours/blocks', C.token, { startsAt: at(dLate, '10:30'), endsAt: at(dLate, '11:00') })).status === 404, 'customers can’t block time');
r = await block(at(dLate, '10:30'), at(dLate, '11:00'), 'Lunch');
ok(r.status === 201 && r.data.block.note === 'Lunch' && r.data.kept === 0, 'Noah blocks 10:30–11:00 for a break');
const lunch = r.data.block.id;
ok(same(await openOn(dLate), ['10:00–10:30', '11:00–12:00', '22:00–02:00']), `open around it: ${(await openOn(dLate)).join(', ')}`);
r = await call('PATCH', `/companion/hours/blocks/${lunch}`, N.token, { endsAt: at(dLate, '11:30') });
ok(r.status === 200 && same(await openOn(dLate), ['10:00–10:30', '11:30–12:00', '22:00–02:00']), 'the break is extended to 11:30');
r = await block(at(dLate, '23:00'), at(next(dLate), '01:00'), 'Night off');
ok(r.status === 201 && r.data.kept === 1, `blocking 23:00–01:00 leaves the request already there (kept ${r.data?.kept})`);
ok(same(await openOn(dLate), ['10:00–10:30', '11:30–12:00', '22:00–23:00']) && (await openOn(next(dLate)))[0] === '01:00–02:00', 'only 22:00–23:00 and 01:00–02:00 stay open that night');
me = (await call('GET', '/companion', N.token)).data;
ok(me.blocks.length === 2 && me.blocks[0].note === 'Lunch' && me.blocks[1].endsAt === at(next(dLate), '01:00'), 'the profile lists the blocked times');
for (const x of me.blocks) await call('DELETE', `/companion/hours/blocks/${x.id}`, N.token);
ok(same(await openOn(dLate), ['10:00–12:00', '22:00–02:00']), 'removing the blocks opens that time again');
await call('POST', `/bookings/${late}/cancel`, C.token);
await call('POST', `/bookings/${bid}/cancel`, C.token);

// 8) Back to the weekly hours
for (const d of [dOff, dCustom, dLate]) ok((await call('DELETE', `/companion/hours/days/${d}`, N.token)).status === 200, `removed the hours for ${d}`);
s = await slots();
ok([dOff, dCustom, dLate].every((d) => same(dayOf(s, d), dayOf(before, d))), 'those days are back to the weekly hours');
ok(!(await call('GET', '/companion', N.token)).data.days.length, 'and the list is empty');

// 9) Older app versions set a date's hours on the same calendar
r = await call('PUT', `/companion/dates/${dCustom}`, N.token, { ranges: [['18:00', '21:00']] }, true);
ok(r.status === 200 && same(r.data.ranges, [['18:00', '21:00']]) && same(await openOn(dCustom), ['18:00–21:00']), 'older apps still set a date’s hours');
r = await call('DELETE', `/companion/dates/${dCustom}`, N.token, null, true);
ok(r.status === 200 && !(await call('GET', '/companion', N.token)).data.days.length, 'and remove them');

// 10) The companion list (search filters: today, tomorrow, weekend, soonest) follows the dates too
const WK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const listed = async () => (await call('GET', '/companions')).data.find((x) => x.id === CID);
const wdOf = (date) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
ok((await listed()).days.includes(wdOf(dOff)), `listed as free on ${WK[wdOf(dOff)]} with the weekly hours`);
await put(dOff, []);
ok(!(await listed()).days.includes(wdOf(dOff)), 'a day off takes that day out of the list’s free days');
await call('DELETE', `/companion/hours/days/${dOff}`, N.token);
const week = (await call('GET', '/companion', N.token)).data.week;
const wd = wdOf(dLate);
await call('PUT', '/companion/hours/week', N.token, { ranges: week.filter((x) => x.day !== wd) });
ok(!(await listed()).days.includes(wd), `with no weekly hours on ${WK[wd]}, that day isn’t free`);
await put(dLate, [R('18:00', '22:00')]);
ok((await listed()).days.includes(wd), 'own hours on that date make it free');
await call('DELETE', `/companion/hours/days/${dLate}`, N.token);
r = await call('PUT', '/companion/hours/week', N.token, { ranges: week });
ok(r.status === 200 && (await listed()).days.includes(wd), 'weekly hours restored');
// "Free today": a start today (the companion’s date) at least 3½ hours from now, in 15-minute steps, with an hour to spare
const today = berlin(0);
const earliest = () => Math.ceil((Date.now() / 1000 + 3.5 * 3600) / 900) * 900;
await put(today, [R('06:00', '07:00')]);
ok((await listed()).today === (earliest() <= at(today, '06:00')), `own hours early today (06:00–07:00): free today = ${earliest() <= at(today, '06:00')}`);
await put(today, [R('22:00', '24:00')]);
ok((await listed()).today === (earliest() <= at(today, '23:00')), `own hours tonight (22:00–24:00): free today = ${earliest() <= at(today, '23:00')}`);
await put(today, [R('22:00', '03:00')]);
ok((await listed()).today === (earliest() < at(next(today), '00:00')), `tonight past midnight (22:00–03:00): free today = ${earliest() < at(next(today), '00:00')}`);
await call('DELETE', `/companion/hours/days/${today}`, N.token);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
