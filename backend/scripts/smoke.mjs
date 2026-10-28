// End-to-end smoke test against a running API (local `npm run dev` or the deployed Worker).
// Needs DEV_LOGIN_CODES = "true". Usage: node scripts/smoke.mjs [baseUrl]
// Admin steps sign a session with JWT_SECRET (defaults to the local .dev.vars value).
import crypto from 'node:crypto';
const BASE = process.argv[2] ?? 'http://localhost:8787';
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) failures++;
};

async function call(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function login(email) {
  const r = await call('POST', '/auth/request-code', null, { email });
  const v = await call('POST', '/auth/verify', null, { email, code: r.data.devCode });
  return v.data;
}

/** Admin session for an existing user (signed like the API does). */
function adminToken(userId) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: userId, email: 'admin@example.com', role: 'admin', exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const sig = crypto.createHmac('sha256', process.env.JWT_SECRET ?? 'local-dev-secret-change-me').update(head).digest('base64url');
  return `${head}.${sig}`;
}
const PIXEL = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
/** Uploads ID + selfie and has an admin approve them. */
async function verifyId(user) {
  const doc = await call('POST', '/photos', user.token, { kind: 'id', data: PIXEL });
  const selfie = await call('POST', '/photos', user.token, { kind: 'id', data: PIXEL });
  const sub = await call('POST', '/me/verification', user.token, { idPhotoId: doc.data.id, selfiePhotoId: selfie.data.id });
  const dec = await call('POST', `/admin/verifications/${user.user.id}/approve`, adminToken(user.user.id));
  return { sub, dec, doc: doc.data, selfie: selfie.data };
}

const health = await call('GET', '/');
ok(health.status === 200 && health.data.ok, 'health check');

const list = await call('GET', '/companions');
ok(list.status === 200 && list.data.length === 8, `lists approved companions (${list.data?.length})`);

const stamp = Date.now();
const customer = await login(`mira+${stamp}@example.com`);
ok(!!customer.token && customer.isNew, 'customer signs up with email code');
const T = customer.token;

const wrong = await call('POST', '/auth/verify', null, { email: 'nobody@example.com', code: '000000' });
ok(wrong.status === 400, 'rejects unknown/expired code');

const noAge = await call('GET', '/companions/demo_kai');
const day = noAge.data.slots.find((d) => d.times.length);
ok(!!day, `companion profile has open slots (${day?.date} ${day?.times[0]})`);

let r = await call('POST', '/bookings', T, { companionId: 'demo_kai', act: 'date', date: day.date, time: day.times[0], dur: 2, place: 'Museum lobby' });
ok(r.status === 403, 'booking blocked until 18+ confirmed');

await call('PATCH', '/me', T, { name: 'Mira Hoffmann', ageConfirmed: true });
r = await call('POST', '/bookings', T, { companionId: 'demo_kai', act: 'date', date: day.date, time: day.times[0], dur: 2, place: 'Museum lobby', boundariesAgreed: true });
ok(r.status === 403 && /Verify your ID/.test(r.data.error), 'booking blocked until ID verified');
r = await call('GET', '/me', T);
ok(r.data.idStatus === 'none', 'new customer starts unverified');
r = await call('POST', '/me/verification', T, { idPhotoId: 'ph_nope', selfiePhotoId: 'ph_nope2' });
ok(r.status === 400, 'verification needs own uploaded photos');
{
  const doc = await call('POST', '/photos', T, { kind: 'id', data: PIXEL });
  const selfie = await call('POST', '/photos', T, { kind: 'id', data: PIXEL });
  r = await call('POST', '/me/verification', T, { idPhotoId: doc.data.id, selfiePhotoId: selfie.data.id });
  ok(r.status === 200 && r.data.idStatus === 'pending', 'ID + selfie submitted for review');
  r = await call('GET', '/admin/verifications', T);
  ok(r.status === 403, 'customer cannot open ID reviews');
  const A = adminToken(customer.user.id);
  r = await call('GET', '/admin/verifications', A);
  const mine = r.data?.find((x) => x.id === customer.user.id);
  ok(!!mine?.idPhotoUrl && !!mine?.selfieUrl, 'admin sees both ID photos');
  r = await call('POST', `/admin/verifications/${customer.user.id}/reject`, A, { reason: 'Selfie is blurry.' });
  r = await call('GET', '/me', T);
  ok(r.data.idStatus === 'rejected' && r.data.idNote === 'Selfie is blurry.', 'rejection reason reaches the customer');
  const gone = await fetch(`${BASE}/photos/${doc.data.id}?token=${A}`);
  ok(gone.status === 404, 'ID photos deleted after the decision');
  const v = await verifyId(customer);
  ok(v.sub.status === 200 && v.dec.status === 200, 'resubmitted and approved');
  r = await call('GET', '/me', T);
  ok(r.data.idStatus === 'approved', 'customer is verified');
}
r = await call('POST', '/bookings', T, { companionId: 'demo_kai', act: 'date', date: day.date, time: day.times[0], dur: 2, place: 'Museum lobby' });
ok(r.status === 400 && /boundaries/.test(r.data.error), 'date booking requires agreeing to boundaries');

r = await call('POST', '/bookings', T, { companionId: 'demo_kai', act: 'date', date: day.date, time: day.times[0], dur: 2, place: 'Museum lobby', boundariesAgreed: true, note: 'First time doing this.' });
ok(r.status === 201 && r.data.status === 'pending' && r.data.pay === 'held' && r.data.total === 6600, `booking created, €66 held (got ${r.data?.total})`);
const bookingId = r.data.id;

r = await call('POST', '/bookings', T, { companionId: 'demo_kai', act: 'date', date: day.date, time: day.times[0], dur: 1, place: 'x', boundariesAgreed: true });
ok(r.status === 409, 'same slot cannot be double-booked');

const kai = await login('kai@demo.zeitmit.app');
const K = kai.token;
r = await call('GET', '/companion/bookings', K);
ok(r.data.requests.some((b) => b.id === bookingId && b.who === 'Mira Hoffmann'), 'companion sees the request');
ok(!JSON.stringify(r.data).includes('"otp"'), 'companion never sees the meet code');
{
  const req = r.data.requests.find((b) => b.id === bookingId);
  ok(req?.customer?.verified === true && typeof req.customer.since === 'number' && !JSON.stringify(req).includes('@'), 'request shows customer ID-verified badge, never the email');
}

r = await call('POST', `/companion/bookings/${bookingId}/accept`, K);
ok(r.status === 200, 'companion accepts');

r = await call('GET', '/bookings', T);
const mine = r.data.find((b) => b.id === bookingId);
ok(mine.status === 'confirmed' && /^\d{4}$/.test(mine.otp), 'customer sees confirmed booking + 4-digit meet code');

r = await call('POST', `/companion/bookings/${bookingId}/verify-code`, K, { code: mine.otp });
const soon = mine.startsAt - Date.now() / 1000 <= 7200;
ok(soon ? r.status === 200 : r.status === 409, soon ? 'meet code releases payment' : 'meet code refused until close to start time');

r = await call('GET', '/me/notifications', T);
ok(r.data.some((n) => n.title === 'Booking accepted'), 'customer got "Booking accepted" notification');

// Chat + realtime
r = await call('GET', '/conversations', T);
const conv = r.data.find((x) => x.cid === 'demo_kai');
ok(!!conv && conv.status === 'confirmed', 'conversation linked to booking');
const wsUrl = BASE.replace(/^http/, 'ws') + `/conversations/${conv.id}/ws?token=${K}`;
const ws = new WebSocket(wsUrl);
const got = new Promise((res) => {
  ws.onmessage = (e) => res(JSON.parse(e.data));
  setTimeout(() => res(null), 4000);
});
await new Promise((res) => { ws.onopen = res; setTimeout(res, 3000); });
r = await call('POST', `/conversations/${conv.id}/messages`, T, { text: 'See you at the lobby!' });
ok(r.status === 201, 'customer sends a message');
const evt = await got;
ok(evt?.type === 'message' && evt.t === 'See you at the lobby!', 'companion receives it live over WebSocket');
ws.close();
r = await call('GET', '/conversations?side=companion', K);
ok(r.data.find((x) => x.id === conv.id)?.unread === 1, 'companion unread count = 1');
r = await call('GET', `/conversations/${conv.id}/messages`, K);
ok(r.data.at(-1).t === 'See you at the lobby!' && !r.data.at(-1).me, 'message history loads');

// Cancel + refund
const slot2 = (await call('GET', '/companions/demo_lena')).data.slots.find((d) => d.times.length);
r = await call('POST', '/bookings', T, { companionId: 'demo_lena', act: 'coffee', date: slot2.date, time: slot2.times[0], dur: 1, place: 'Café' });
r = await call('POST', `/bookings/${r.data.id}/cancel`, T);
ok(r.status === 200 && r.data.refunded === 3080, 'pending request cancels with full refund (€30.80)');

// Safety, gifts, saved
r = await call('POST', '/safety/checkins', T, { bookingId, contactName: 'Anna', contactPhone: '+49 151 2345678', every: 30 });
ok(soon ? r.status === 404 : r.status === 201, 'safety check-in starts for confirmed booking');
r = await call('POST', '/gifts', T, { amount: 100, to: 'Sam' });
ok(r.status === 201 && /^ZM-\d{4}-\d{4}$/.test(r.data.code), 'gift card issued');
const giftCode = r.data.code;
r = await call('POST', '/gifts/redeem', T, { code: giftCode });
ok(r.status === 400, 'sender cannot redeem own gift');
const friend = await login(`friend+${stamp}@example.com`);
await call('PATCH', '/me', friend.token, { name: 'Sam', ageConfirmed: true });
r = await call('POST', '/gifts/redeem', friend.token, { code: giftCode.toLowerCase() });
ok(r.status === 200 && r.data.credit === 10000, 'friend redeems €100 credit');
r = await call('POST', '/gifts/redeem', friend.token, { code: giftCode });
ok(r.status === 409, 'gift code works only once');
await verifyId(friend);
const slot3 = (await call('GET', '/companions/demo_noah')).data.slots.find((d) => d.times.length);
r = await call('POST', '/bookings', friend.token, { companionId: 'demo_noah', act: 'movies', date: slot3.date, time: slot3.times[0], dur: 2, place: 'Cinema' });
ok(r.status === 201 && r.data.creditUsed === 4400, 'credit applied to booking (€44)');
await call('POST', `/bookings/${r.data.id}/cancel`, friend.token);
r = await call('GET', '/me', friend.token);
ok(r.data.credit === 10000, 'cancel returns credit to account');

// Photos
r = await call('POST', '/photos', T, { kind: 'avatar', data: PIXEL });
ok(r.status === 201, 'avatar uploaded');
const pic = await fetch(BASE + r.data.url);
ok(pic.ok && pic.headers.get('content-type') === 'image/jpeg', 'avatar served publicly');
r = await call('GET', '/me', T);
ok(!!r.data.avatarUrl, 'profile has avatarUrl');
r = await call('POST', '/photos', T, { kind: 'id', data: PIXEL });
const idPhoto = r.data;
ok((await fetch(BASE + idPhoto.url)).status === 403, 'ID photo is private');

// Settings
r = await call('PATCH', '/me', T, { prefs: { pushMessages: false }, language: 'de' });
r = await call('GET', '/me', T);
ok(r.data.prefs.pushMessages === false && r.data.prefs.pushBookings === true && r.data.language === 'de', 'settings saved');
await call('POST', '/me/blocks', T, { targetId: 'demo_mehmet' });
r = await call('GET', '/me/blocks', T);
ok(r.data.some((x) => x.id === 'demo_mehmet' && x.name === 'Mehmet'), 'blocked list');
await call('DELETE', '/me/blocks/demo_mehmet', T);
r = await call('GET', '/me/blocks', T);
ok(r.data.length === 0, 'unblock');
await call('PUT', '/me/saved/demo_lena', T);
r = await call('GET', '/me', T);
ok(r.data.saved.includes('demo_lena') && r.data.name === 'Mira Hoffmann', 'saved companions + profile');

// Become a companion
const apply = { name: 'Mira', about: 'Designer, new-ish to Berlin. Into galleries, good coffee and long walks.', acts: ['coffee', 'culture'], langs: ['German', 'English'], levels: { German: 'Native' }, rate: 28, days: ['Sat', 'Sun'], wins: ['pm'], adult: true, rules: true, tagline: 'Galleries and good coffee' };
r = await call('POST', '/companion/apply', T, { ...apply, idPhotoId: idPhoto.id });
ok(r.status === 400 && /age/i.test(r.data.error), 'application needs an age');
r = await call('POST', '/companion/apply', T, { ...apply, idPhotoId: idPhoto.id, age: 17, gender: 'w' });
ok(r.status === 400, 'under-18 application rejected');
r = await call('POST', '/companion/apply', T, { ...apply, idPhotoId: idPhoto.id, age: 27 });
ok(r.status === 400 && /identify/.test(r.data.error), 'application needs a gender');
r = await call('POST', '/companion/apply', T, { ...apply, age: 27, gender: 'w' });
ok(r.status === 400, 'application needs an ID photo');
r = await call('POST', '/companion/apply', T, { ...apply, idPhotoId: idPhoto.id, age: 27, gender: 'w', pronouns: 'she/her' });
ok(r.status === 201 && r.data.status === 'pending', 'companion application goes to review');
r = await call('PATCH', '/companion', T, { tagline: 'Slow museums, fast coffee', interests: ['Art', 'Coffee'], langs: ['German'], levels: { German: 'Native' }, area: 'Neukölln' });
ok(r.status === 200, 'companion edits listing');
r = await call('GET', '/companion', T);
ok(r.data.tagline === 'Slow museums, fast coffee' && r.data.langs[0][1] === 'Native' && r.data.area === 'Neukölln', 'listing edits saved');
ok(r.data.g === 'w' && r.data.ageValue === 27 && r.data.pron === 'she/her', 'gender, age and pronouns saved');
r = await call('PATCH', '/companion', T, { gender: 'nb', age: 28, pronouns: '' });
r = await call('GET', '/companion', T);
ok(r.data.g === 'nb' && r.data.ageValue === 28 && !r.data.pron, 'gender, age and pronouns editable');
r = await call('GET', '/companions');
ok(!r.data.some((c) => c.id === customer.user.id), 'pending companion is not public');

// Access control
r = await call('GET', '/admin/stats', T);
ok(r.status === 403, 'non-admin blocked from admin API');
r = await call('GET', '/bookings');
ok(r.status === 401, 'unauthenticated request rejected');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
