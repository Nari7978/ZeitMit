// Admin tools (1.3.9):
//  - Live now: who is Free now (and whether customers see them), requests ringing, video dates on now with who is in
//    the call, the next hour, SOS; switching someone's Free now off.
//  - A video date's call log: who was in the call when, why it was paid like that, what happened; paying the companion
//    in full afterwards (ZeitMit pays the missing part; it counts in their earnings and payouts).
//  - Profile changes: an approved companion's new texts and photos wait for review, the live listing stays until then;
//    the admin approves or rejects (with a note) and the companion is told.
// Runs against a LOCAL API started with the short call timers, e.g.
//   npx wrangler dev --local --test-scheduled --var CALL_WAIT_SECONDS:3 --var CALL_PAY_STEP_SECONDS:1 --var CALL_PING_GAP_SECONDS:2
// with the demo companions seeded. Uses Yuki (video dates) and a new companion. Usage: node scripts/admin-tools.mjs [api]
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

const [BASE = 'http://localhost:8787'] = process.argv.slice(2);
const YID = 'demo_yuki';
let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? '✓' : '✗'} ${label}`); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(150); } return false; };
const call = async (method, path, token, body) => {
  const res = await fetch(BASE + path, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json', 'X-ZeitMit-Api': '3', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const login = async (email) => {
  const r = await call('POST', '/auth/request-code', null, { email });
  return (await call('POST', '/auth/verify', null, { email, code: r.data.devCode })).data;
};
const adminToken = (userId) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: userId, email: 'admin@example.com', role: 'admin', exp: Math.floor(Date.now() / 1000) + 1800 })}`;
  return `${head}.${crypto.createHmac('sha256', process.env.JWT_SECRET ?? 'local-dev-secret-change-me').update(head).digest('base64url')}`;
};
const sql = (q) => execSync(`npx wrangler d1 execute DB --local --command "${q}"`, { stdio: 'pipe' });
const all = (q) => JSON.parse(execSync(`npx wrangler d1 execute DB --local --json --command "${q}"`, { stdio: 'pipe' }).toString())[0].results;
const one = (q) => all(q)[0];
const row = (id) => one(`SELECT * FROM bookings WHERE id = '${id}'`);
const eur = (c) => '€' + (Number.isInteger(c / 100) ? c / 100 : (c / 100).toFixed(2));
const notes = async (token) => (await call('GET', '/me/notifications', token)).data ?? [];
const told = async (token, title, body) => until(async () => (await notes(token)).some((n) => n.title === title && (!body || body.test(n.body))), 5000);

/** A socket in a video date's call room that keeps what it receives. */
const join = (id, token) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/calls/${id}/ws?token=${encodeURIComponent(token)}`);
  const got = [];
  ws.onmessage = (e) => got.push(JSON.parse(e.data));
  ws.onopen = () => resolve({ ws, got, send: (m) => ws.send(JSON.stringify(m)), has: (t) => got.some((m) => m.type === t) });
  ws.onerror = () => reject(new Error('socket failed'));
});

const stamp = Date.now();
const Y = await login('yuki@demo.zeitmit.app');
const customer = async (name) => {
  const u = await login(`admintools+${name.split(" ")[0].toLowerCase()}+${stamp}@example.com`);
  await call('PATCH', '/me', u.token, { name, ageConfirmed: true });
  sql(`UPDATE users SET id_status = 'approved' WHERE id = '${u.user.id}'`);
  return u;
};
const Cora = await customer('Cora Cam');
const Asha = await customer('Asha Tan');
const A = adminToken(Cora.user.id);
const admin = (method, path, body) => call(method, `/admin${path}`, A, body);

// A clean slate for Yuki: nothing open, nothing around now, Free now off.
const open = (await call('GET', '/companion/bookings', Y.token)).data;
for (const x of [...open.requests, ...open.upcoming]) await call('POST', `/companion/bookings/${x.id}/cancel`, Y.token, { reason: 'Something else' });
sql(`UPDATE bookings SET starts_at = starts_at - 30 * 86400 WHERE companion_id = '${YID}' AND status IN ('completed', 'confirmed') AND starts_at > unixepoch() - 9 * 3600`);
sql(`UPDATE companions SET free_now_until = NULL, free_now_seen = NULL, free_now_bg = 0, free_now_misses = 0, free_now_paused = NULL WHERE user_id = '${YID}'`);

// ---------------------------------------------------------------- 1) Only admins
let r = await call('GET', '/admin/live', Cora.token);
ok(r.status === 403, 'Live now, call logs and profile changes are for admins only');

// ---------------------------------------------------------------- 2) Live now: Free now
r = await call('PUT', '/companion/free-now', Y.token, { hours: 2 });
const yukiLive = async () => (await admin('GET', '/live')).data.freeNow.find((f) => f.id === YID);
let f = await yukiLive();
const answered0 = f?.answered ?? 0, missed0 = f?.missed ?? 0; // other suites may have rung Yuki today
ok(r.status === 200 && f && f.until === r.data.until && f.bg === false && f.hidden === null && f.max >= 30 && f.name === 'Yuki' && f.rate > 0,
  `Yuki switches Free now on: listed, checked in from the open app, shown to customers (up to ${f?.max} min)`);
sql(`UPDATE companions SET free_now_seen = unixepoch() - 1200 WHERE user_id = '${YID}'`);
f = await yukiLive();
ok(f?.hidden === 'away' && f.seen < Date.now() / 1000 - 1100, 'their phone hasn’t checked in for 20 minutes: listed as not reached, hidden from customers');
await call('POST', '/companion/free-now/seen', Y.token, { bg: true });
f = await yukiLive();
ok(f?.hidden === null && f.bg === true, 'a check-in from the background: shown again, “rings in the background”');

// Requests ringing now
const before = (await admin('GET', '/stats')).data;
r = await call('POST', '/bookings', Asha.token, { companionId: YID, act: 'call', instant: true, minutes: 30, boundariesAgreed: true });
const v1 = r.data?.id;
let live = (await admin('GET', '/live')).data;
const ring = live.ringing.find((x) => x.id === v1);
ok(r.status === 201 && ring?.instant === true && ring.customer === 'Asha T.' && ring.companion === 'Yuki' && ring.minutes === 30 && ring.total === row(v1).total && ring.expiresAt === row(v1).expires_at,
  `Asha asks for a video date now: ringing (${ring?.customer} → ${ring?.companion}, ${ring?.minutes} min, ${eur(ring?.total ?? 0)}, until ${ring?.expiresAt})`);
ok(live.freeNow.find((x) => x.id === YID)?.hidden === 'busy', 'while it rings, Yuki is hidden from other customers (busy)');
ok((await admin('GET', '/stats')).data.live === before.live + 1, `the Live now badge counts it (${before.live} → ${before.live + 1})`);
await call('POST', `/companion/bookings/${v1}/decline`, Y.token);
live = (await admin('GET', '/live')).data;
ok(!live.ringing.some((x) => x.id === v1) && live.freeNow.find((x) => x.id === YID)?.answered === answered0 + 1, 'Yuki declines: no longer ringing; one more answered today');
const v2 = (await call('POST', '/bookings', Asha.token, { companionId: YID, act: 'call', instant: true, minutes: 30, boundariesAgreed: true })).data?.id;
sql(`UPDATE bookings SET created_at = created_at - 121 WHERE id = '${v2}'`);
await call('GET', '/bookings', Asha.token); // closes it as expired
f = await yukiLive();
ok(row(v2).status === 'expired' && f?.missed === missed0 + 1 && f.answered === answered0 + 1, 'one runs out unanswered: one more missed today');

// Switching it off
r = await admin('POST', `/companions/${YID}/free-now/off`);
ok(r.status === 200 && one(`SELECT free_now_until FROM companions WHERE user_id = '${YID}'`).free_now_until === null && !(await yukiLive()), 'the admin switches Yuki’s Free now off');
ok(await told(Y.token, 'Free now is off', /^ZeitMit switched off Free now for you\./), 'Yuki is told');
r = await call('POST', '/companion/free-now/seen', Y.token, { bg: true });
ok(r.data?.until === null, 'their phone hears it’s off at its next check-in (and stops the background service)');
r = await admin('POST', `/companions/${YID}/free-now/off`);
ok(r.status === 409, 'switching it off again: already off');

// The next hour
const book = async (token) => {
  const day = (await call('GET', `/companions/${YID}/times`)).data.video.find((d) => d.times.length);
  const b = await call('POST', '/bookings', token, { companionId: YID, act: 'call', date: day.date, time: day.times[0], dur: 1, boundariesAgreed: true });
  await call('POST', `/companion/bookings/${b.data.id}/accept`, Y.token);
  return b.data.id;
};
const soon = await book(Asha.token);
sql(`UPDATE bookings SET starts_at = unixepoch() + 1800 WHERE id = '${soon}'`);
live = (await admin('GET', '/live')).data;
const s1 = live.soon.find((x) => x.id === soon);
ok(s1?.video === true && s1.act === 'Video date' && s1.customer === 'Asha T.' && s1.companion === 'Yuki' && s1.checkin === false, `a video date in 30 minutes is in the next hour (${s1?.act})`);
await call('POST', `/companion/bookings/${soon}/cancel`, Y.token, { reason: 'Something else' });

// ---------------------------------------------------------------- 3) A video date on now, then its call log
// A 60-minute video date ending 34 seconds from now: Yuki joins first, Cora 7 seconds later, both with video; Yuki's
// connection drops at 13 s and comes back at 21 s (8 seconds Cora waited, not paid); Cora pings meanwhile.
const vd = await book(Cora.token);
sql(`UPDATE bookings SET starts_at = unixepoch() - 3566 WHERE id = '${vd}'`);
const t0 = Date.now();
const at = (s) => sleep(Math.max(0, t0 + s * 1000 - Date.now()));
const yuki1 = await join(vd, Y.token);
await until(() => yuki1.has('hello'));
await at(7);
const cora = await join(vd, Cora.token);
await until(() => cora.has('hello'));
cora.send({ type: 'media', on: true });
yuki1.send({ type: 'media', on: true });
await at(9);
let onNow = (await admin('GET', '/live')).data.calls.find((x) => x.id === vd);
ok(onNow?.here.customer && onNow.here.companion && onNow.video === true && onNow.alone === null && onNow.customer === 'Cora C.',
  'Live now: the video date is on, both in the call with video');
r = await admin('GET', `/bookings/${vd}/call`);
ok(r.status === 200 && r.data.now?.here.customer === true && r.data.now.video === true && r.data.money.held && r.data.why.some((w) => /^On now\. It’s settled at the booked end/.test(w)),
  'its call log while it’s on: who is in it now, “settled at the booked end”');
await at(13);
yuki1.ws.close();
await until(async () => !!(await admin('GET', '/live')).data.calls.find((x) => x.id === vd)?.alone);
await at(15);
r = await call('POST', `/calls/${vd}/ping`, Cora.token);
onNow = (await admin('GET', '/live')).data.calls.find((x) => x.id === vd);
ok(r.status === 200 && onNow?.alone?.side === 'customer' && onNow.alone.pings === 1 && Math.abs(onNow.alone.since - (t0 / 1000 + 13)) <= 2,
  `Yuki dropped out: Cora waiting alone since ${onNow?.alone ? new Date(onNow.alone.since * 1000).toISOString().slice(11, 19) : '?'}, pinged ${onNow?.alone?.pings}×`);
await at(21);
const yuki2 = await join(vd, Y.token);
await until(() => yuki2.has('hello'));
yuki2.send({ type: 'media', on: true });
ok(await until(() => cora.has('ended') && yuki2.has('ended'), 25000), 'the booked time ends');
ok(await until(() => row(vd).pay_status !== 'held', 8000), 'and it’s settled');
const vb = row(vd);
const SHARE = vb.total - vb.fee;
ok(vb.status === 'completed' && vb.pay_status === 'released' && vb.subtotal < SHARE && vb.billed_minutes === 59, `paid in part: Yuki earned ${eur(vb.subtotal)} of ${eur(SHARE)} (59 of 60 min)`);

r = await admin('GET', `/bookings/${vd}/call`);
const log = r.data;
ok(r.status === 200 && log.booking.customer.first === 'Cora' && log.booking.companion.name === 'Yuki' && log.booking.minutes === 60 && log.now === null, 'the call log: the booking');
ok(log.money.total === vb.total && log.money.fee === vb.fee && log.money.earned === vb.subtotal && log.money.refunded === vb.refunded && log.money.share === SHARE && log.money.billedMinutes === 59,
  `money: paid ${eur(log.money.paid)}, Yuki earned ${eur(log.money.earned)}, ${eur(log.money.refunded)} back to Cora, fee ${eur(log.money.fee)}`);
const secs = (bars) => bars.reduce((n, b) => n + b.to - b.from, 0);
ok(log.bars.companion.length === 2 && log.bars.customer.length === 1 && Math.abs(secs(log.bars.customer) - 27) <= 3 && Math.abs(secs(log.bars.companion) - 26) <= 3,
  `who was in the call: Yuki twice (${log.bars.companion.length} stretches), Cora once until the end`);
ok(log.unpaid.length === 1 && Math.abs(secs(log.unpaid) - 8) <= 2, `the unpaid stretch: ${secs(log.unpaid)} s while Yuki was out`);
const berlin = (t) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t * 1000));
// (Stretches under 30 seconds get no sentence of their own: the 8 seconds show in the money and the timeline.)
ok(log.why.length === 3 && /^Nobody was in the call for the first 59 minutes \(\d\d:\d\d–\d\d:\d\d\)\.$/.test(log.why[0])
  && log.why[1] === `Both were in the call at the booked end (${berlin(vb.ends_at)}).`
  && log.why[2] === `Yuki is paid for 59 of 60 minutes: ${eur(vb.subtotal)}. ${eur(vb.refunded)} went back to Cora.`,
  `why: ${JSON.stringify(log.why)}`);
const lines = log.timeline.map((l) => l.text);
ok(lines[0] === 'Yuki joined · Cora’s phone rang' && lines[1] === 'Cora joined · video connected' && log.timeline[1].tone === 'ok'
  && /^Yuki’s connection dropped · Cora pinged Yuki \(1 of 10\)$/.test(lines[2]) && log.timeline[2].tone === 'warn'
  && lines[3] === 'Yuki came back · video connected' && lines[4] === 'Booked time over · settled' && lines.length === 5,
  `what happened: ${JSON.stringify(lines)}`);
ok(log.together >= 15 && log.together <= 23 && log.canPayInFull === true && log.canRefund === true, `together with video ${log.together} s; it can be paid in full or refunded`);

// Paying Yuki in full
const bal = async () => (await call('GET', '/companion/payouts', Y.token)).data.balance;
const b0 = await bal();
r = await admin('POST', `/bookings/${vd}/pay-in-full`);
const missing = SHARE - vb.subtotal;
ok(r.status === 200 && r.data.topup === missing && row(vd).topup === missing && row(vd).subtotal === vb.subtotal && row(vd).refunded === vb.refunded,
  `Pay in full: ZeitMit adds the missing ${eur(missing)}; Cora keeps her refund`);
const b1 = await bal();
ok(b1.pending === b0.pending + missing, `Yuki’s earnings grow by it (${eur(b0.pending)} → ${eur(b1.pending)} waiting to become available)`);
const hist = (await call('GET', '/companion/bookings', Y.token)).data.history.find((x) => x.id === vd);
ok(hist?.payout === SHARE && hist.minutesPaid === undefined, `Yuki’s booking shows the full ${eur(SHARE)}, no longer “59 of 60 min”`);
ok(await told(Y.token, 'Paid in full by ZeitMit', new RegExp(`^ZeitMit added ${eur(missing).replace('.', '\\.')} for your video date on .+ with Cora, so you get the full ${eur(SHARE).replace('.', '\\.')}\\.$`)), 'Yuki is told');
r = await admin('GET', `/bookings/${vd}/call`);
ok(r.data.money.earned === SHARE && r.data.canPayInFull === false && r.data.why.at(-1) === `ZeitMit then paid Yuki the missing ${eur(missing)}, so they got the full ${eur(SHARE)}.`, 'the call log says so');
r = await admin('POST', `/bookings/${vd}/pay-in-full`);
ok(r.status === 409, 'paying in full twice: refused');

// Refunding it in full afterwards takes back all Yuki got for it, top-up included
r = await admin('POST', `/bookings/${vd}/refund`);
ok(r.status === 200 && row(vd).pay_status === 'refunded' && (await bal()).pending === b0.pending - vb.subtotal, 'Refund in full: Cora gets everything back, and it comes off Yuki’s earnings');
ok(await told(Y.token, 'A booking was refunded', new RegExp(`${eur(SHARE).replace('.', '\\.')} comes off your earnings\\.$`)), `Yuki is told the full ${eur(SHARE)} comes off`);
r = await admin('GET', `/bookings/${vd}/call`);
ok(r.data.canRefund === false && r.data.canPayInFull === false && r.data.why.at(-1)?.startsWith('Refunded by ZeitMit support · '), 'the call log shows the refund');
ok((await admin('GET', `/bookings/${soon}/call`)).data.timeline.length === 0, 'a video date nobody joined: an empty call log');
ok((await admin('GET', '/bookings/bk_nope/call')).status === 404, 'an unknown booking: not found');

// ---------------------------------------------------------------- 4) Profile changes
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const R = await login(`admintools+rosa+${stamp}@example.com`);
const up = async (kind) => (await call('POST', '/photos', R.token, { kind, data: PNG, mime: 'image/png' })).data;
const [idPhoto, photo1, g1, g2, g3] = [await up('id'), await up('companion'), await up('gallery'), await up('gallery'), await up('gallery')];
const ABOUT1 = 'I grew up by the sea and moved to Berlin for the museums, the parks and the long summer evenings.';
r = await call('POST', '/companion/apply', R.token, {
  name: 'Rosa', age: 31, gender: 'w', about: ABOUT1, tagline: 'Museums and long walks', acts: ['coffee', 'walks'], langs: ['English'], rate: 25,
  days: ['Mon', 'Sat'], wins: ['pm'], adult: true, rules: true, idPhotoId: idPhoto.id, photoId: photo1.id, galleryIds: [g1.id, g2.id, g3.id],
});
ok(r.status === 201, 'Rosa applies to be a companion');
const RID = R.user.id;
const comp = () => one(`SELECT bio, tagline, photo_id, gallery, status FROM companions WHERE user_id = '${RID}'`);
r = await call('PATCH', '/companion', R.token, { about: ABOUT1 + ' Still applying.' });
ok(r.status === 200 && r.data.review.length === 0 && comp().bio === ABOUT1 + ' Still applying.', 'while still applying, changes apply directly (the whole listing is reviewed anyway)');
await call('PATCH', '/companion', R.token, { about: ABOUT1 });
await admin('POST', `/companions/${RID}/approve`);
ok(comp().status === 'approved', 'Rosa is approved');

const ABOUT2 = ABOUT1 + ' Write me on Insta for more pics, and I also do evening walks.';
r = await call('PATCH', '/companion', R.token, { about: ABOUT2, tagline: 'Museums, walks and sea air', area: 'Wedding' });
ok(r.status === 200 && JSON.stringify(r.data.review) === '["about","tagline"]', 'a new About and tagline: sent for review');
ok(comp().bio === ABOUT1 && comp().tagline === 'Museums and long walks', 'the live listing keeps the old ones');
ok(one(`SELECT area FROM companions WHERE user_id = '${RID}'`).area === 'Wedding', 'other fields (area) still change at once');
let mine = (await call('GET', '/companion', R.token)).data;
ok(mine.bio === ABOUT1 && mine.review?.about === ABOUT2 && mine.review.tagline === 'Museums, walks and sea air' && mine.review.since > 0, 'Rosa’s listing screen gets what waits for review');
ok((await call('GET', `/companions/${RID}`)).data.bio === ABOUT1, 'customers see the old About');
const waiting = () => all(`SELECT field, status FROM profile_changes WHERE companion_id = '${RID}'`);
r = await call('PATCH', '/companion', R.token, { about: ABOUT2, tagline: 'Museums, walks and sea air' });
ok(r.data.review.length === 0 && waiting().length === 2, 'saving the same again changes nothing');
r = await call('PATCH', '/companion', R.token, { tagline: 'Museums and long walks' });
ok(waiting().filter((x) => x.status === 'pending').map((x) => x.field).join() === 'about' && (await call('GET', '/companion', R.token)).data.review.tagline === undefined,
  'changing the tagline back to the live one withdraws that change');
r = await call('PATCH', '/companion', R.token, { tagline: 'Museums, walks and sea air' });
ok(r.data.review.join() === 'tagline', 'and a new one waits again');

// Photos
const photo2 = await up('companion');
ok(photo2.review === true && comp().photo_id === photo1.id, 'a new listing photo waits for review; the current one stays');
const photo3 = await up('companion');
ok(one(`SELECT COUNT(*) AS n FROM photos WHERE id = '${photo2.id}'`).n === 0 && (await call('GET', '/companion', R.token)).data.review.photoUrl === `/photos/${photo3.id}`,
  'another one replaces it (the one nobody saw is deleted)');
// (As in the app: each photo is uploaded, then the gallery saved with it; unused uploads are cleaned up.)
const g4 = await up('gallery');
r = await call('PUT', '/companion/gallery', R.token, { ids: [g1.id, g2.id, g3.id, g4.id] });
ok(r.status === 200 && JSON.stringify(r.data.review) === JSON.stringify([g4.id]) && JSON.parse(comp().gallery).length === 3, 'a new gallery photo waits for review; the live gallery stays');
const g5 = await up('gallery');
r = await call('PUT', '/companion/gallery', R.token, { ids: [g2.id, g3.id, g4.id, g5.id] });
ok(r.status === 200 && r.data.review.join() === [g4.id, g5.id].join() && JSON.parse(comp().gallery).join() === [g1.id, g2.id, g3.id].join(),
  'another new one, and one removed meanwhile: all part of the change that waits');
mine = (await call('GET', '/companion', R.token)).data;
ok(mine.review.gallery?.ids.join() === [g2.id, g3.id, g4.id, g5.id].join() && mine.review.gallery.added.join() === [g4.id, g5.id].join(), 'Rosa sees her gallery as it will be, the new photos marked');

// The admin's list
const stats = (await admin('GET', '/stats')).data;
let cards = (await admin('GET', '/profile-changes')).data;
let card = cards.find((x) => x.companion.id === RID);
const ch = (field) => card.changes.find((x) => x.field === field);
ok(stats.pendingChanges >= 1 && card && card.changes.length === 4, `Profile changes: Rosa’s card with 4 changes (badge ${stats.pendingChanges})`);
ok(ch('about').before === ABOUT1 && ch('about').after === ABOUT2 && JSON.stringify(ch('about').hints) === JSON.stringify([{ label: 'Social media or messenger', words: ['insta'] }]),
  'About: old and new text, “insta” pointed out');
ok(ch('photo').before === `/photos/${photo1.id}` && ch('photo').after === `/photos/${photo3.id}`, 'the profile photo: old and new');
ok(ch('gallery').after.map((p) => `${p.id}:${p.added}`).join() === `${g2.id}:false,${g3.id}:false,${g4.id}:true,${g5.id}:true` && ch('gallery').removed.map((p) => p.id).join() === g1.id,
  'the gallery: which photos are new and which goes');

// Deciding: photo and gallery approved (the new gallery photo left out), texts rejected
const ids = { about: ch('about').id, tagline: ch('tagline').id, photo: ch('photo').id, gallery: ch('gallery').id };
r = await admin('POST', `/profile-changes/${RID}`, { approve: [ids.photo, ids.gallery], reject: [ids.about, ids.tagline] });
ok(r.status === 400, 'rejecting needs a note for the companion');
r = await admin('POST', `/profile-changes/${RID}`, { approve: [ids.gallery], dropPhotos: [g4.id, g5.id, g2.id], note: 'x y z' });
ok(r.status === 409 && waiting().filter((x) => x.status === 'pending').length === 4, 'leaving out photos so fewer than 3 stay: refused, nothing changed');
r = await admin('POST', `/profile-changes/${RID}`, { approve: [ids.photo, ids.gallery], reject: [ids.about, ids.tagline], dropPhotos: [g4.id], note: 'Social media isn’t allowed on ZeitMit' });
const c1 = comp();
ok(r.status === 200 && c1.photo_id === photo3.id && JSON.parse(c1.gallery).join() === [g2.id, g3.id, g5.id].join(), 'the new profile photo and gallery are live, without the photo left out');
ok(one(`SELECT COUNT(*) AS n FROM photos WHERE id IN ('${photo1.id}', '${g1.id}', '${g4.id}')`).n === 0, 'the old profile photo, the removed and the left-out gallery photos are deleted');
ok(c1.bio === ABOUT1 && c1.tagline === 'Museums and long walks', 'the texts stay as they were');
ok(await told(R.token, 'Some profile changes weren’t approved',
  /^Your new text and photos weren’t approved: Social media isn’t allowed on ZeitMit\. The rest is live now\.$/), 'Rosa is told, with the note');
mine = (await call('GET', '/companion', R.token)).data;
ok(mine.review.about === undefined && mine.review.rejected.map((x) => `${x.field}:${x.note}`).sort().join() === 'about:Social media isn’t allowed on ZeitMit,tagline:Social media isn’t allowed on ZeitMit',
  'her listing screen shows the note on the rejected texts');
ok(!(await admin('GET', '/profile-changes')).data.some((x) => x.companion.id === RID), 'nothing of hers waits any more');
const rejectedList = (await admin('GET', '/profile-changes?status=rejected')).data.filter((x) => x.companionId === RID);
const approvedList = (await admin('GET', '/profile-changes?status=approved')).data.filter((x) => x.companionId === RID);
ok(rejectedList.length === 2 && approvedList.length === 2 && approvedList.find((x) => x.field === 'gallery')?.note === 'Social media isn’t allowed on ZeitMit', 'the Approved and Rejected tabs list them');

// A clean change, approved
const ABOUT3 = ABOUT1 + ' Ask me about the best museum cafés.';
await call('PATCH', '/companion', R.token, { about: ABOUT3 });
card = (await admin('GET', '/profile-changes')).data.find((x) => x.companion.id === RID);
ok(card?.changes.length === 1 && ch('about').hints.length === 0, 'a new About without anything to point out');
r = await admin('POST', `/profile-changes/${RID}`, { approve: [ch('about').id] });
ok(r.status === 200 && comp().bio === ABOUT3 && (await call('GET', `/companions/${RID}`)).data.bio === ABOUT3, 'approved: customers see it now');
ok(await told(R.token, 'Profile changes approved', /^Your profile changes are live now\.$/), 'Rosa is told');
mine = (await call('GET', '/companion', R.token)).data;
ok(!mine.review.rejected.some((x) => x.field === 'about') && mine.review.rejected.some((x) => x.field === 'tagline'), 'the old note on the About text is gone; the tagline’s stays');
r = await admin('POST', `/profile-changes/${RID}`, { approve: [ch('about').id] });
ok(r.status === 409, 'deciding the same change twice: refused');

// Rejecting only a new profile photo
const photo4 = await up('companion');
card = (await admin('GET', '/profile-changes')).data.find((x) => x.companion.id === RID);
r = await admin('POST', `/profile-changes/${RID}`, { reject: [card.changes[0].id], note: 'Please use a photo where your face is visible' });
ok(r.status === 200 && comp().photo_id === photo3.id && one(`SELECT COUNT(*) AS n FROM photos WHERE id = '${photo4.id}'`).n === 0, 'a rejected profile photo is deleted; the live one stays');
ok(await told(R.token, 'Profile changes not approved', /^Your new profile photo wasn’t approved: Please use a photo where your face is visible\. Customers still see your previous version\.$/), 'Rosa is told why');

// Reordering and removing with nothing waiting: straight away
const g6 = await up('gallery');
await call('PUT', '/companion/gallery', R.token, { ids: [g2.id, g3.id, g5.id, g6.id] });
card = (await admin('GET', '/profile-changes')).data.find((x) => x.companion.id === RID);
r = await admin('POST', `/profile-changes/${RID}`, { approve: [card.changes[0].id] });
ok(r.status === 200 && JSON.parse(comp().gallery).length === 4, 'a new gallery photo approved: live');
r = await call('PUT', '/companion/gallery', R.token, { ids: [g3.id, g5.id, g2.id, g6.id] });
ok(r.data.review.length === 0 && JSON.parse(comp().gallery).join() === [g3.id, g5.id, g2.id, g6.id].join(), 'reordering the gallery: applies at once');
r = await call('PUT', '/companion/gallery', R.token, { ids: [g3.id, g5.id, g2.id] });
ok(r.data.review.length === 0 && JSON.parse(comp().gallery).length === 3 && one(`SELECT COUNT(*) AS n FROM photos WHERE id = '${g6.id}'`).n === 0, 'removing one: at once, and the photo is deleted');

for (const w of [cora, yuki2]) try { w.ws.close(); } catch { /* closed */ }
console.log(failures ? `\n${failures} check(s) failed` : '\nAll admin tools checks passed');
process.exit(failures ? 1 : 0);
