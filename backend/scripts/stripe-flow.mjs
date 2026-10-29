// Payment flows against a LOCAL API that talks to a mock Stripe (STRIPE_API_BASE), e.g.
//   npx wrangler dev --var STRIPE_SECRET_KEY:sk_test_mock --var STRIPE_API_BASE:http://localhost:9999
// Moves booking start times in the local database to reach the time-dependent rules.
// Usage: node scripts/stripe-flow.mjs [api] [mockStripe]
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

const [BASE = 'http://localhost:8787', MOCK = 'http://localhost:9999'] = process.argv.slice(2);
let failures = 0;
const ok = (c, l) => { console.log(`${c ? '✓' : '✗'} ${l}`); if (!c) failures++; };
const call = async (m, p, t, b) => { const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, data: await r.json().catch(() => null) }; };
const login = async (e) => { const r = await call('POST', '/auth/request-code', null, { email: e }); return (await call('POST', '/auth/verify', null, { email: e, code: r.data.devCode })).data; };
const sql = (q) => execSync(`npx wrangler d1 execute DB --local --command "${q}"`, { stdio: 'pipe' });
const pay = (url) => fetch(MOCK + new URL(url).pathname).then((r) => r.json());
const intent = async (bookingId) => {
  const ref = JSON.parse(execSync(`npx wrangler d1 execute DB --local --json --command "SELECT payment_ref FROM bookings WHERE id = '${bookingId}'"`, { stdio: 'pipe' }).toString())[0].results[0].payment_ref;
  return (await fetch(MOCK + '/state').then((x) => x.json())).intents[ref];
};
const admin = (userId) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: userId, email: 'admin@example.com', role: 'admin', exp: Math.floor(Date.now() / 1000) + 600 })}`;
  return `${head}.${crypto.createHmac('sha256', process.env.JWT_SECRET ?? 'local-dev-secret-change-me').update(head).digest('base64url')}`;
};

const payer = await login(`payer+${Date.now()}@example.com`);
const T = payer.token;
const A = admin(payer.user.id);
await call('PATCH', '/me', T, { name: 'Payer', ageConfirmed: true });
sql(`UPDATE users SET id_status = 'approved' WHERE id = '${payer.user.id}'`);
const L = (await login('lena@demo.zeitmit.app')).token;
const J = (await login('jonas@demo.zeitmit.app')).token;
const far = async (cid, n) => (await call('GET', `/companions/${cid}`)).data.slots.flatMap((d) => d.times.map((t) => [d.date, t])).slice(-n);
const lena = await far('demo_lena', 3);
const jonas = await far('demo_jonas', 1);

/** Books, pays through the mock Checkout and returns the paid booking. */
async function paidBooking(cid, [date, time], act) {
  const r = await call('POST', '/bookings', T, { companionId: cid, act, date, time, dur: 1, place: 'Café', boundariesAgreed: true });
  await pay(r.data.checkoutUrl);
  await call('POST', `/bookings/${r.data.id}/confirm-payment`, T);
  return r.data;
}

// 1) Checkout, hidden until paid, then a free cancellation releases the hold
let r = await call('POST', '/bookings', T, { companionId: 'demo_lena', act: 'coffee', date: lena[0][0], time: lena[0][1], dur: 1, place: 'Café' });
ok(r.status === 201 && !!r.data.checkoutUrl, 'booking returns a Stripe Checkout URL');
const a = r.data;
ok(!(await call('GET', '/bookings', T)).data.some((b) => b.id === a.id), 'unpaid booking hidden from the customer');
ok(!(await call('GET', '/companion/bookings', L)).data.requests.some((b) => b.id === a.id), 'companion does not see an unpaid request');
r = await call('POST', `/bookings/${a.id}/confirm-payment`, T);
ok(r.status === 402 && r.data.paid === false, 'confirm before paying → not paid');
await pay(r.data.checkoutUrl);
r = await call('POST', `/bookings/${a.id}/confirm-payment`, T);
ok(r.status === 200 && r.data.paid && r.data.booking.status === 'pending', 'confirm after paying → request sent');
await call('POST', `/companion/bookings/${a.id}/accept`, L);
r = await call('POST', `/bookings/${a.id}/cancel`, T, { reason: 'Plans changed' });
ok(r.status === 200 && r.data.late === false && (await intent(a.id)).status === 'canceled', 'free cancellation releases the card hold');

// 2) Meet code captures the payment
const b = await paidBooking('demo_jonas', jonas[0], 'walks');
await call('POST', `/companion/bookings/${b.id}/accept`, J);
sql(`UPDATE bookings SET starts_at = unixepoch() + 3600 WHERE id = '${b.id}'`);
const otp = (await call('GET', '/bookings', T)).data.find((x) => x.id === b.id).otp;
r = await call('POST', `/companion/bookings/${b.id}/verify-code`, J, { code: otp });
ok(r.status === 200 && (await intent(b.id)).status === 'succeeded', 'meet code captures the payment');

// 3) Late cancellation captures too (companion is paid); support can refund it afterwards
const c = await paidBooking('demo_lena', lena[1], 'coffee');
await call('POST', `/companion/bookings/${c.id}/accept`, L);
sql(`UPDATE bookings SET starts_at = unixepoch() + 5 * 3600 WHERE id = '${c.id}'`);
r = await call('POST', `/bookings/${c.id}/cancel`, T);
ok(r.status === 200 && r.data.late === true && (await intent(c.id)).status === 'succeeded', 'late cancellation takes the payment');
r = await call('POST', `/admin/bookings/${c.id}/refund`, A);
ok(r.status === 200 && (await intent(c.id)).status === 'refunded', 'support refunds a taken payment through Stripe');

// 4) Companion cancels: hold released, customer pays nothing
const d = await paidBooking('demo_lena', lena[2], 'coffee');
await call('POST', `/companion/bookings/${d.id}/accept`, L);
r = await call('POST', `/companion/bookings/${d.id}/cancel`, L, { reason: 'Emergency' });
ok(r.status === 200 && (await intent(d.id)).status === 'canceled', 'companion cancellation releases the card hold');

// 5) Support refund of a completed booking
r = await call('POST', `/admin/bookings/${b.id}/refund`, A);
ok(r.status === 200 && (await intent(b.id)).status === 'refunded', 'support refunds a completed booking');

// 6) Leaving checkout gives the time back at once, and that checkout can't be paid afterwards
const other = await login(`other+${Date.now()}@example.com`);
await call('PATCH', '/me', other.token, { name: 'Other', ageConfirmed: true });
sql(`UPDATE users SET id_status = 'approved' WHERE id = '${other.user.id}'`);
const at = (token, dur = 1) => call('POST', '/bookings', token, { companionId: 'demo_lena', act: 'coffee', date: lena[0][0], time: lena[0][1], dur, place: 'Café' });
const e = (await at(T)).data;
r = await at(other.token);
ok(r.status === 409, 'an open checkout holds the time for others');
r = await call('POST', `/bookings/${e.id}/release`, T);
ok(r.status === 200 && r.data.released === true, 'leaving checkout releases the time at once');
ok(!!(await pay(e.checkoutUrl)).error, 'that checkout page is closed, so it can’t be paid later');
r = await at(other.token);
ok(r.status === 201, 'someone else can book the time straight away');
await call('POST', `/bookings/${r.data.id}/release`, other.token);

// 7) Paid just before closing the page: release keeps the booking and sends the request
const f = (await at(T)).data;
await pay(f.checkoutUrl);
r = await call('POST', `/bookings/${f.id}/release`, T);
ok(r.status === 200 && r.data.paid === true && r.data.released === false, 'paid just before leaving: release keeps the booking');
ok((await call('GET', '/companion/bookings', L)).data.requests.some((x) => x.id === f.id), 'and the request reaches the companion');
await call('POST', `/bookings/${f.id}/cancel`, T);

// 8) Starting again (another length) replaces your own open checkout
const g = (await at(T)).data;
r = await at(T, 2);
ok(r.status === 201 && !!r.data.checkoutUrl && r.data.id !== g.id, 'the same customer can start again with another length');
ok(!!(await pay(g.checkoutUrl)).error, 'and their first checkout page was closed');
await call('POST', `/bookings/${r.data.id}/release`, T);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll payment checks passed');
process.exit(failures ? 1 : 0);
