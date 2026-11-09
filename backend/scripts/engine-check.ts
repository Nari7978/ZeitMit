// Checks of the time and hours engine that a live API can't reach: daylight-saving changes (the next one in Berlin is
// months away), exactly-at-the-deadline acceptance, ranges past midnight, other time zones, tidying ranges.
// Run: npm run test:engine (bundles this file with esbuild, which comes with wrangler, and runs it with node).
import {
  canAccept, changeCoverage, cleanRanges, expiryOf, firstStart, fitAt, fits, normalize, openHours, ruleProblem, subtract, union,
  type Hours, type Range,
} from '../src/lib/hours';
import { localMoments, localToUnix, offsetAt, whenIn, zoneName } from '../src/lib/time';

let failures = 0;
const ok = (cond: boolean, label: string) => { console.log(`${cond ? '✓' : '✗'} ${label}`); if (!cond) failures++; };
const B = 'Europe/Berlin';
const utc = (s: string) => Date.parse(s) / 1000;
const hours = (week: Hours['week'], days: [string, Range[]][] = [], blocks: Hours['blocks'] = [], tz = B): Hours => ({ tz, week, days: new Map(days), blocks });
const len = (iv: [number, number][]) => iv.reduce((n, [a, b]) => n + (b - a), 0) / 3600;

// ---- Daylight saving, spring forward: Sunday 29 March 2026, 02:00 → 03:00 in Berlin
const spring = '2026-03-29';
ok(localToUnix(spring, 150, B, 'strict') === null && localMoments(spring, 150, B).length === 0, '14 02:30 doesn’t exist on 29 March (clocks jump to 03:00): refused for a booking');
ok(localToUnix(spring, 120, B) === utc('2026-03-29T01:00:00Z'), '   a range starting 02:00 starts when the clock jumps (03:00 CEST)');
let iv = openHours(hours([], [[spring, [{ from: '01:00', to: '04:00', kind: 'both' }]]]), 'meet', utc('2026-03-28T00:00:00Z'), utc('2026-03-31T00:00:00Z'));
ok(len(iv) === 2, `   01:00–04:00 that night is 2 real hours (${len(iv)} h)`);
const s1 = localToUnix(spring, 90, B)!; // 01:30 CET
ok(whenIn(s1 + 3600, B).time === '03:30', `   a 1-hour booking from 01:30 ends 03:30 (${whenIn(s1 + 3600, B).time})`);

// ---- Daylight saving, fall back: Sunday 25 October 2026, 03:00 → 02:00 in Berlin
const fall = '2026-10-25';
const twice = localMoments(fall, 150, B);
ok(twice.length === 2 && twice[1] - twice[0] === 3600, '   02:30 happens twice on 25 October, an hour apart');
ok(zoneName(twice[0], B) === 'CEST' && zoneName(twice[1], B) === 'CET', `   labelled ${zoneName(twice[0], B)} and ${zoneName(twice[1], B)}, so a booking is never ambiguous`);
ok(localToUnix(fall, 150, B) === twice[0] && localToUnix(fall, 150, B, 'later') === twice[1], '   older apps’ clock times take the first one');
iv = openHours(hours([], [[fall, [{ from: '01:00', to: '04:00', kind: 'both' }]]]), 'video', utc('2026-10-24T00:00:00Z'), utc('2026-10-27T00:00:00Z'));
ok(len(iv) === 4, `   01:00–04:00 that night is 4 real hours (${len(iv)} h)`);
const s2 = localToUnix(fall, 90, B)!; // 01:30 CEST
ok(whenIn(s2 + 7200, B).time === '02:30' && zoneName(s2 + 7200, B) === 'CET', `   a 2-hour booking from 01:30 ends 02:30 CET, the second 02:30 (${whenIn(s2 + 7200, B).time} ${zoneName(s2 + 7200, B)})`);
// Weekly hours across the change: Saturday 24 Oct evening into Sunday
iv = openHours(hours([{ day: 5, from: '22:00', to: '04:00', kind: 'both' }]), 'meet', utc('2026-10-24T12:00:00Z'), utc('2026-10-25T12:00:00Z'));
ok(len(iv) === 7, `   weekly Saturday 22:00–04:00 on that night is 7 real hours (${len(iv)} h)`);

// ---- Ordinary days, other zones, past midnight
ok(localToUnix('2026-11-10', 600, B) === utc('2026-11-10T09:00:00Z'), '   10:00 in Berlin in November is 09:00 UTC');
ok(localToUnix('2026-11-10', 600, 'Asia/Kolkata') === utc('2026-11-10T04:30:00Z'), '   10:00 in Kolkata is 04:30 UTC');
ok(localMoments('2026-11-01', 90, 'America/New_York').length === 2, '   New York’s clocks go back on 1 November: 01:30 happens twice');
ok(offsetAt(utc('2026-07-01T12:00:00Z'), B) === 7200 && offsetAt(utc('2026-12-01T12:00:00Z'), B) === 3600, '   Berlin is UTC+2 in summer, UTC+1 in winter');
iv = openHours(hours([], [['2026-11-10', [{ from: '22:00', to: '02:00', kind: 'both' }]]]), 'meet', utc('2026-11-09T00:00:00Z'), utc('2026-11-13T00:00:00Z'));
ok(iv.length === 1 && iv[0][0] === utc('2026-11-10T21:00:00Z') && iv[0][1] === utc('2026-11-11T01:00:00Z'), '9  22:00–02:00 runs into the next day');
ok(fits(iv, utc('2026-11-10T22:00:00Z'), utc('2026-11-11T00:00:00Z')), '10 so 23:00 for 2 hours (until 01:00) fits');
ok(fitAt(iv, utc('2026-11-10T22:00:00Z')) === 180, '   from 23:00 there’s room for 3 hours');

// ---- Kinds share one clock; blocks
const both = hours([], [['2026-11-10', [{ from: '10:00', to: '14:00', kind: 'meet' }, { from: '12:00', to: '18:00', kind: 'video' }]]]);
const w0 = utc('2026-11-10T00:00:00Z'), w1 = utc('2026-11-11T00:00:00Z');
ok(len(openHours(both, 'meet', w0, w1)) === 4 && len(openHours(both, 'video', w0, w1)) === 6, '   in-person and video ranges apply to their own kind');
const busy: [number, number][] = [[utc('2026-11-10T11:00:00Z'), utc('2026-11-10T12:00:00Z')]]; // 12:00–13:00 Berlin
ok(!fits(subtract(openHours(both, 'video', w0, w1), busy), utc('2026-11-10T11:00:00Z'), utc('2026-11-10T11:30:00Z')), '   a confirmed booking blocks the other kind too');
ok(JSON.stringify(normalize([{ from: '10:00', to: '14:00', kind: 'meet' }, { from: '12:00', to: '18:00', kind: 'video' }])) === JSON.stringify([
  { from: '10:00', to: '12:00', kind: 'meet' }, { from: '12:00', to: '14:00', kind: 'both' }, { from: '14:00', to: '18:00', kind: 'video' }]), '   overlapping ranges of both kinds tidy into one open for both where they meet');
ok(JSON.stringify(normalize([{ from: '09:00', to: '12:00', kind: 'both' }, { from: '12:00', to: '17:00', kind: 'both' }])) === JSON.stringify([{ from: '09:00', to: '17:00', kind: 'both' }]), '   touching ranges of one kind join');
ok(JSON.stringify(changeCoverage([{ from: '09:00', to: '17:00', kind: 'both' }], 720, 1020, 2, false)) === JSON.stringify([{ from: '09:00', to: '12:00', kind: 'both' }, { from: '12:00', to: '17:00', kind: 'meet' }]), '   older apps: switching video off for an afternoon keeps it in person');

// ---- Checking ranges
const bad = (raw: unknown) => { try { cleanRanges(raw); return false; } catch { return true; } };
ok(bad([['10:10', '12:00']]) && bad([['10:00', '10:15']]) && bad([['10:00', '14:00'], ['13:00', '15:00']]) && bad(Array(7).fill(['10:00', '11:00'])), '   ranges off the 15-minute grid, under 30 minutes, overlapping or more than 6 are refused');
ok(!bad([['00:00', '24:00']]) && !bad([['18:00', '18:00']]) && !bad([['22:15', '01:45', 'video']]), '   a whole day, 24 hours from 18:00, or 22:15–01:45 for video only are fine');

// ---- The acceptance deadline and expiry
const req = { created_at: 1_000_000, starts_at: 1_000_000 + 5 * 3600 };
ok(expiryOf(req) === req.starts_at - 3 * 3600, '6  starting in 5 hours: the deadline is 3 hours before the start');
ok(canAccept(req, req.starts_at - 3 * 3600), '6  accepting exactly at the 3-hour deadline is allowed');
ok(!canAccept(req, req.starts_at - 3 * 3600 + 1), '7  one second later it isn’t');
const far = { created_at: 1_000_000, starts_at: 1_000_000 + 4 * 86400 };
ok(expiryOf(far) === far.created_at + 86400 && !canAccept(far, far.created_at + 86400 + 1), '8  days ahead: it expires 24 hours after the request');

// ---- Start times and lengths
const t = utc('2026-11-09T12:00:00Z');
ok(ruleProblem('meet', t + 4 * 3600, 60, t) === null && ruleProblem('video', t + 4 * 3600, 30, t) === null, '   any 15-minute start 3½ hours or more ahead; video from 30 minutes');
ok(!!ruleProblem('meet', t + 4 * 3600 + 600, 60, t) && !!ruleProblem('meet', t + 4 * 3600, 50, t) && !!ruleProblem('meet', t + 3 * 3600, 60, t) && !!ruleProblem('meet', t + 8 * 86400, 60, t), '   off-grid, odd lengths, too soon or too far are refused');
ok(firstStart(union([[t + 3600, t + 7200], [t + 5 * 3600, t + 9 * 3600]]), 60, t + 3.5 * 3600, t + 7 * 86400) === t + 5 * 3600, '   the next free start skips what’s too soon');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll engine checks passed');
process.exit(failures ? 1 : 0);
