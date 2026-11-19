// Checks of the time and hours engine that a live API can't reach: daylight-saving changes (the next one in Berlin is
// months away), exactly-at-the-deadline acceptance, ranges past midnight, other time zones, tidying ranges.
// Run: npm run test:engine (bundles this file with esbuild, which comes with wrangler, and runs it with node).
import {
  canAccept, changeCoverage, cleanRanges, expiryOf, firstStart, fitAt, fits, LEAD_S, normalize, noticeS, openHours, ruleProblem, subtract, union,
  type Hours, type Range,
} from '../src/lib/hours';
import { localMoments, localToUnix, offsetAt, whenIn, zoneName } from '../src/lib/time';
import { earned, unpaidTime, type Presence } from '../src/lib/videoDate';
import { callTimeline, explainCall, presenceBars, type CallEvent } from '../src/lib/callLog';
import { reviewHints } from '../src/lib/reviewHints';

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
const req = { created_at: 1_000_000, starts_at: 1_000_000 + 5 * 3600, kind: 'meet' as const };
ok(expiryOf(req) === req.starts_at - 3 * 3600, '6  starting in 5 hours: the deadline is 3 hours before the start');
ok(canAccept(req, req.starts_at - 3 * 3600), '6  accepting exactly at the 3-hour deadline is allowed');
ok(!canAccept(req, req.starts_at - 3 * 3600 + 1), '7  one second later it isn’t');
ok(expiryOf({ ...req, kind: 'video' }) === req.starts_at - 3 * 3600, '   the same for a video date');
const far = { created_at: 1_000_000, starts_at: 1_000_000 + 4 * 86400, kind: 'meet' as const };
ok(expiryOf(far) === far.created_at + 86400 && !canAccept(far, far.created_at + 86400 + 1), '8  days ahead: it expires 24 hours after the request');
// Short notice (less than 3 hours to go, or so little time left before the 3-hour mark that the short window is longer)
{
  const T = 1_000_000, at = (kind: 'video' | 'meet', ahead: number) => expiryOf({ created_at: T, starts_at: T + ahead, kind });
  ok(at('video', 3600) === T + 600 && at('video', 1200) === T + 600, 'S1 a video date 1 hour or 20 minutes away: 10 minutes to answer');
  ok(at('video', 900) === T + 300, 'S2 never later than 10 minutes before a video date starts');
  ok(at('meet', 7200) === T + 1800 && at('meet', 5400) === T + 1800, 'S3 in person 2 hours or 1½ hours away: 30 minutes to answer');
  ok(at('meet', 4800) === T + 1200, 'S4 never later than 1 hour before an in-person date starts');
  ok(at('meet', 3 * 3600 + 600) === T + 1800 && at('video', 3 * 3600 + 300) === T + 600, 'S5 just over 3 hours away: the short window, not 5 or 10 minutes');
  ok(at('meet', 4 * 3600) === T + 3600 && at('video', 4 * 3600) === T + 3600, 'S6 4 hours away: as before, until 3 hours before the start');
  ok(!canAccept({ created_at: T, starts_at: T + 3600, kind: 'video' }, T + 601), 'S7 a short-notice video request can’t be accepted after its 10 minutes');
  ok(at('video', 3600) === T + 600 && expiryOf({ created_at: T, starts_at: T, kind: 'video', instant: 1 }) === T + 120, 'F1 a free-now video date (it starts when accepted): 2 minutes to answer');
  ok(canAccept({ created_at: T, starts_at: T, kind: 'video', instant: 1 }, T + 120) && !canAccept({ created_at: T, starts_at: T, kind: 'video', instant: 1 }, T + 121), 'F2 at 2 minutes still, a second later not');
  ok(noticeS('video', 60) === 3600 && noticeS('meet', 1440) === 86400 && noticeS('video', 7) === 1200 && noticeS('meet', null) === 5400, 'S8 a companion’s notice: one of the options, else 20 minutes (video) / 1½ hours (in person)');
}

// ---- Start times and lengths
const t = utc('2026-11-09T12:00:00Z');
ok(ruleProblem('meet', t + 4 * 3600, 60, LEAD_S, t) === null && ruleProblem('video', t + 4 * 3600, 30, LEAD_S, t) === null, '   any 15-minute start 3½ hours or more ahead; video from 30 minutes');
ok(ruleProblem('video', t + 1800, 30, 1200, t) === null && ruleProblem('video', t + 900, 30, 1200, t) === 'Pick a time at least 20 minutes from now.', 'S9 with 20 minutes’ notice: a video date in 30 minutes is fine, in 15 it’s too soon');
ok(ruleProblem('meet', t + 5400, 60, 5400, t) === null && ruleProblem('meet', t + 4500, 60, 5400, t) === 'Pick a time at least 1½ hours from now.' && ruleProblem('meet', t + 3 * 86400, 60, 86400, t) === null && ruleProblem('meet', t + 86400 - 900, 60, 86400, t) === 'Pick a time at least 1 day from now.', 'S10 in person with 1½ hours’ or 1 day’s notice');
ok(!!ruleProblem('meet', t + 4 * 3600 + 600, 60, LEAD_S, t) && !!ruleProblem('meet', t + 4 * 3600, 50, LEAD_S, t) && !!ruleProblem('meet', t + 3 * 3600, 60, LEAD_S, t) && !!ruleProblem('meet', t + 8 * 86400, 60, LEAD_S, t), '   off-grid, odd lengths, too soon or too far are refused');
ok(firstStart(union([[t + 3600, t + 7200], [t + 5 * 3600, t + 9 * 3600]]), 60, t + 3.5 * 3600, t + 7 * 86400) === t + 5 * 3600, '   the next free start skips what’s too soon');

// ---- Video dates: who wasn't there, and what the companion earns (30-minute date from S, 5 minutes to wait)
{
  const S = 1_800_000_000, E = S + 1800, W = 300, m = (x: number) => S + x * 60;
  const C = (x: number, on = true): Presence => ({ s: 'customer', t: m(x), on });
  const P = (x: number, on = true): Presence => ({ s: 'companion', t: m(x), on });
  const lost = (...log: Presence[]) => unpaidTime(log, S, E, W).unpaid / 60;
  ok(lost(C(0), P(0)) === 0, 'V1 both there the whole time: paid in full');
  ok(lost(C(-8), P(-5)) === 0, 'V2 both early: nothing lost (the time before the start doesn’t count)');
  ok(lost(C(0), P(0), C(5, false)) === 0, 'V3 the customer leaves at minute 5: the companion is still paid in full');
  ok(lost(P(0), C(10)) === 0, 'V4 the customer is 10 minutes late: paid in full');
  ok(lost(C(0), P(0), P(20, false)) === 10, 'V5 the companion leaves at 20, the customer stays: 10 minutes unpaid');
  ok(lost(C(0), P(0), P(20, false), C(20.5, false)) === 10, 'V6 the companion leaves at 20, the customer gives up half a minute later: still 10 unpaid');
  ok(lost(C(0), P(0), C(20, false), P(20.5, false)) === 0, 'V7 the customer leaves at 20, the companion half a minute later: nothing unpaid');
  ok(lost(C(0), P(6)) === 6, 'V8 the companion is 6 minutes late: 6 minutes unpaid');
  ok(lost(C(0), P(3)) === 3, 'V9 3 minutes late: 3 minutes unpaid');
  ok(lost(C(0), P(0), P(10, false), P(12)) === 2, 'V10 the companion drops for 2 minutes and comes back: 2 minutes unpaid');
  ok(lost(C(0), P(0), C(10, false), C(12)) === 0, 'V11 the customer drops for 2 minutes and comes back: nothing unpaid');
  ok(lost(C(0), P(0), C(10, false), P(16, false), C(18)) === 0, 'V12 the customer drops, the companion waits 6 minutes and goes; the customer is back later: nothing unpaid');
  ok(lost(C(0), P(0), P(10, false), C(16, false), P(18)) === 20, 'V13 the companion drops, the customer waits 6 minutes and goes; the companion is back later: 20 minutes unpaid');
  ok(lost(C(0), P(0), C(10, false), P(11, false), C(12)) === 18, 'V14 the customer drops, the companion leaves after 1 minute without waiting; the customer is back at 12: 18 unpaid');
  ok(lost(P(0), P(1, false)) === 0, 'V15 the customer never comes (the companion leaves after a minute): paid in full');
  ok(lost(C(0), C(2, false)) === 30, 'V16 the companion never comes: nothing earned');
  ok(lost(C(0), C(6, false), P(10)) === 30, 'V17 the customer waits 6 minutes and goes; the companion comes at 10 and stays: nothing earned');
  ok(lost(C(0), C(4, false), P(10)) === 10, '    the customer waited only 4 minutes: the companion loses just the 10 late minutes');
  ok(Math.floor(lost(C(0), P(0), P(5, false), P(5.2), P(29, false))) === 1, 'V18 a 12-second blip and leaving a minute early: 1 whole minute unpaid (seconds round in the companion’s favour)');
  const u = unpaidTime([C(0), P(0)], S, E, W);
  ok(u.overlap === 1800 && u.customerAtEnd && u.companionAtEnd, 'V19 together the whole time, both there at the end');
  const cov = (to: number, ...log: Presence[]) => unpaidTime(log, S, m(to), W).covered;
  ok(cov(7, C(0), C(6, false)) === 'customer' && cov(12, C(0), C(6, false), P(10)) === 'customer' && cov(3, C(0)) === null && cov(6, C(0)) === 'customer'
    && cov(12, P(0), P(6, false)) === 'companion' && cov(12, C(0), P(0), P(5, false)) === 'customer' && cov(4, C(0), P(0), P(2, false)) === null && cov(9, C(0), C(6, false), P(8)) === 'customer'
    && cov(15, C(0), C(6, false), P(8), C(9)) === null && cov(3, C(-8)) === null,
    'V21 who is covered so far (for the call screen): whoever waited 5 minutes from the start, until they’re together again');
  ok(earned(1700, 1800, 600) === 1133 && earned(1700, 1800, 0) === 1700 && earned(1700, 1800, 1800) === 0 && earned(1700, 1800, 2400) === 0, 'V20 earnings in proportion to the time paid, never below 0 or above the share');
}

// ---- The admin's call log: who was in the call, why it was paid like that, what happened (60-minute date at 14:00 UTC)
{
  const S = Date.UTC(2026, 10, 18, 14) / 1000, E = S + 3600, W = 300, m = (x: number) => S + Math.round(x * 60);
  const C = (x: number, on = true): Presence => ({ s: 'customer', t: m(x), on });
  const P = (x: number, on = true): Presence => ({ s: 'companion', t: m(x), on });
  const ev = (s: 'customer' | 'companion', x: number, e: CallEvent['e']): CallEvent => ({ s, t: m(x), e });
  const clock = (t: number) => new Date(t * 1000).toISOString().slice(11, 16);
  const names = { customer: 'Cora', companion: 'Lena' };
  const why = (log: Presence[], events: CallEvent[] = [], at = E + 60) => explainCall({ log, events, start: S, end: E, wait: W, now: at, names, clock });
  const same = (a: unknown, b: unknown, label: string) => { const ok_ = JSON.stringify(a) === JSON.stringify(b); ok(ok_, label); if (!ok_) console.log('   got', JSON.stringify(a)); };

  // The mockup: Lena joins 2 minutes early and pings, Cora comes 6 minutes late, Lena drops out 14:38–14:46.
  const log = [P(-2), C(6), P(38, false), P(46)];
  const events = [ev('companion', -2, 'ring'), ev('companion', 3, 'ping'), ev('companion', 6.03, 'video'), ev('customer', 6.05, 'video'),
    ev('companion', 38, 'drop'), ev('customer', 38.02, 'no-video'), ev('companion', 46.05, 'video'), ev('customer', 46.07, 'video')];
  const bars = presenceBars(log, S - 600, E);
  same(bars, { customer: [{ from: m(6), to: E }], companion: [{ from: m(-2), to: m(38) }, { from: m(46), to: E }] }, 'L1 who was in the call when, up to the booked end');
  const w = why(log, events);
  same(w.why, [
    'Cora came 6 minutes late (14:06). Lena was there and waited, so that time is paid.',
    'Lena’s connection dropped at 14:38 and was back at 14:46. Cora was in the call meanwhile, so 8 minutes aren’t paid.',
    'Both were in the call at the booked end (15:00).',
  ], 'L2 why: late customer paid, the companion’s 8-minute drop not paid');
  same(w.unpaid, [{ from: m(38), to: m(46) }], 'L3 the unpaid stretch');
  same(callTimeline(log, events, names, 10), [
    { t: m(-2), text: 'Lena joined · Cora’s phone rang' },
    { t: m(3), text: 'Lena pinged Cora (1 of 10)' },
    { t: m(6), text: 'Cora joined · video connected', tone: 'ok' },
    { t: m(38), text: 'Lena’s connection dropped', tone: 'warn' },
    { t: m(46), text: 'Lena came back · video connected', tone: 'ok' },
  ], 'L4 what happened, a join and its ring or video in one line');

  same(why([C(0), P(6)]).why, ['Lena came 6 minutes late (14:06). Cora was waiting in the call, so 6 minutes aren’t paid.', 'Both were in the call at the booked end (15:00).'], 'L5 the companion is late');
  same(why([C(0), P(0), P(50, false)], [ev('companion', 50, 'bye')]).why, ['Lena hung up at 14:50, 10 minutes before the end, while Cora stayed: 10 minutes aren’t paid.'], 'L6 the companion hangs up early');
  same(why([C(0), P(0), C(40, false)], [ev('customer', 40, 'bye')]).why, ['Cora hung up at 14:40, 20 minutes before the end, while Lena stayed: still paid.'], 'L7 the customer hangs up early');
  same(why([C(0), P(0), P(10, false), C(16, false), P(18)], [ev('companion', 10, 'drop')]).why, [
    'Lena’s connection dropped at 14:10. Cora was in the call without them for 6 minutes (14:10–14:16): not paid.',
    'Neither was in the call for 2 minutes (14:16–14:18): not paid, as Lena left first.',
    'Cora had waited 5 minutes for Lena and left. Lena was in the call alone afterwards for 42 minutes (14:18–15:00): not paid.',
  ], 'L8 the customer waits 5 minutes for the companion and goes: covered from then on');
  same(why([C(0), P(0), C(10, false), P(16, false), C(18)]).why, [
    'Cora left the call at 14:10. Lena was in the call without them for 6 minutes (14:10–14:16): paid.',
    'Neither was in the call for 2 minutes (14:16–14:18): paid, as Cora left first.',
    'Cora was in the call alone for 42 minutes (14:18–15:00), after Lena had waited 5 minutes for them: still paid.',
  ], 'L9 the companion waits 5 minutes for the customer and goes: covered');
  same(why([C(0)], [], m(20)).why, ['Cora has been waiting for Lena since 14:00: not paid while Lena isn’t there.'], 'L10 while it’s on: says what’s happening now');
  same(why([P(-1), P(0.2, false), P(0.3), C(0.4)]).why, ['Both were in the call at the booked end (15:00).'], 'L11 blips under 30 seconds aren’t worth a sentence');
  same(why([]).why, [], 'L12 nobody joined: nothing to explain from the call');
}

// ---- Profile changes: what the check points out in a new text (English and German)
{
  const h = (t: string) => reviewHints(t).map((x) => `${x.label}: ${x.words.join(', ')}`);
  ok(JSON.stringify(h('Write me on Insta for more pics. I also do video dates in the evening.')) === JSON.stringify(['Social media or messenger: insta']), 'R1 social media');
  ok(JSON.stringify(h('Ich nehme auch Barzahlung oder eine Überweisung, gern im Hotel.')) === JSON.stringify(['Payment outside ZeitMit: barzahlung, überweisung', 'Meeting at home or in private: hotel']), 'R2 German payment and place words (umlauts too)');
  ok(JSON.stringify(h('Sexy evenings, overnight at my place')) === JSON.stringify(['Sexual content: sexy', 'Meeting at home or in private: overnight, my place']), 'R3 sexual content and private places');
  ok(h('Melde dich bei mir! Ich liebe scharfes Essen, Signale im Wald, Cashews und Sussex.').length === 0, 'R4 everyday words aren’t flagged (bei mir, Cashews, Sussex)');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll engine checks passed');
process.exit(failures ? 1 : 0);
