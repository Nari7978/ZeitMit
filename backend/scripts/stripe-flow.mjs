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
/** A GET to the mock, tried again if its idle connection had just closed (Node closes them after 5 seconds). */
const mockGet = async (path) => {
  for (let i = 0; ; i++) {
    try { return await fetch(MOCK + path).then((r) => r.json()); } catch (e) { if (i >= 2) throw e; await new Promise((r) => setTimeout(r, 200)); }
  }
};
const pay = (url) => mockGet(new URL(url).pathname);
const intent = async (bookingId) => {
  const ref = JSON.parse(execSync(`npx wrangler d1 execute DB --local --json --command "SELECT payment_ref FROM bookings WHERE id = '${bookingId}'"`, { stdio: 'pipe' }).toString())[0].results[0].payment_ref;
  return (await mockGet('/state')).intents[ref];
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
let pi = await intent(a.id);
ok(r.status === 200 && r.data.late === false && r.data.refunded === a.total - a.fee && pi.status === 'succeeded' && pi.amount === a.total && pi.amount_received === a.fee,
  `cancelling 24 h+ ahead once accepted: only the service fee is taken, the rest of the hold released (${pi.amount_received} of ${pi.amount} cents)`);

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
sql(`UPDATE bookings SET starts_at = unixepoch() + 5 * 3600, decided_at = unixepoch() - 3600 WHERE id = '${c.id}'`); // accepted an hour ago
r = await call('POST', `/bookings/${c.id}/cancel`, T);
ok(r.status === 200 && r.data.late === true && (await intent(c.id)).status === 'succeeded', 'late cancellation takes the payment');
r = await call('POST', `/admin/bookings/${c.id}/refund`, A);
ok(r.status === 200 && (await intent(c.id)).status === 'refunded', 'support refunds a taken payment through Stripe');

// 4) Companion cancels: hold released, customer pays nothing
const d = await paidBooking('demo_lena', lena[2], 'coffee');
await call('POST', `/companion/bookings/${d.id}/accept`, L);
r = await call('POST', `/companion/bookings/${d.id}/cancel`, L, { reason: 'Emergency' });
pi = await intent(d.id);
ok(r.status === 200 && r.data.refunded === d.total - d.fee && pi.status === 'succeeded' && pi.amount_received === d.fee, 'companion cancels: the customer pays only the service fee, the rest of the hold released');
r = await call('POST', `/admin/bookings/${d.id}/refund`, A);
ok(r.status === 409 && r.data?.error === 'Everything but the service fee was already refunded.', 'support sees that only the fee was kept');

// 5) Support refund of a completed booking
r = await call('POST', `/admin/bookings/${b.id}/refund`, A);
ok(r.status === 200 && (await intent(b.id)).status === 'refunded', 'support refunds a completed booking');

// 6) An open checkout holds no time; leaving it closes the checkout page, so it can't be paid afterwards
const other = await login(`other+${Date.now()}@example.com`);
await call('PATCH', '/me', other.token, { name: 'Other', ageConfirmed: true });
sql(`UPDATE users SET id_status = 'approved' WHERE id = '${other.user.id}'`);
const at = (token, dur = 1) => call('POST', '/bookings', token, { companionId: 'demo_lena', act: 'coffee', date: lena[0][0], time: lena[0][1], dur, place: 'Café' });
const e = (await at(T)).data;
r = await at(other.token);
ok(r.status === 201 && !!r.data.checkoutUrl, 'an open checkout holds no time: someone else can start one for the same time');
const o = r.data;
r = await call('POST', `/bookings/${e.id}/release`, T);
ok(r.status === 200 && r.data.released === true, 'leaving checkout drops it at once');
ok(!!(await pay(e.checkoutUrl)).error, 'that checkout page is closed, so it can’t be paid later');

// 6b) Paid after someone else was confirmed for that time: the request can't happen, so the card hold is released
const p2 = (await at(T)).data;
await pay(o.checkoutUrl);
await call('POST', `/bookings/${o.id}/confirm-payment`, other.token);
ok((await call('POST', `/companion/bookings/${o.id}/accept`, L)).status === 200, 'Lena accepts the other request');
await pay(p2.checkoutUrl);
r = await call('POST', `/bookings/${p2.id}/confirm-payment`, T);
const lost = (await fetch(`${BASE}/bookings`, { headers: { Authorization: `Bearer ${T}`, 'X-ZeitMit-Api': '3' } }).then((x) => x.json())).find((x) => x.id === p2.id);
ok(lost?.status === 'conflicted' && lost.pay === 'refunded' && (await intent(p2.id)).status === 'canceled', `paid for a time just taken: conflicted, card hold released (${lost?.status}, ${(await intent(p2.id))?.status})`);
await call('POST', `/bookings/${o.id}/cancel`, other.token);

// 7) Paid just before closing the page: release keeps the booking and sends the request
const f = (await at(T)).data;
await pay(f.checkoutUrl);
r = await call('POST', `/bookings/${f.id}/release`, T);
ok(r.status === 200 && r.data.paid === true && r.data.released === false, 'paid just before leaving: release keeps the booking');
ok((await call('GET', '/companion/bookings', L)).data.requests.some((x) => x.id === f.id), 'and the request reaches the companion');
r = await call('POST', `/bookings/${f.id}/cancel`, T);
ok(r.status === 200 && r.data.refunded === f.total && (await intent(f.id)).status === 'canceled', 'cancelling a request before it’s accepted releases the whole hold, fee too');

// 8) Starting again (another length) replaces your own open checkout
const g = (await at(T)).data;
r = await at(T, 2);
ok(r.status === 201 && !!r.data.checkoutUrl && r.data.id !== g.id, 'the same customer can start again with another length');
ok(!!(await pay(g.checkoutUrl)).error, 'and their first checkout page was closed');
await call('POST', `/bookings/${r.data.id}/release`, T);

// 9) Short notice and a slow checkout: the time to answer starts once the payment goes through, and a request paid
//    so late that it starts too soon for an answer is released at once (Lena open all day for this)
const berlin = (days) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + days * 86400000));
const call3 = async (m, p, t, b) => { const x = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', 'X-ZeitMit-Api': '3', Authorization: `Bearer ${t}` }, body: b ? JSON.stringify(b) : undefined }); return { status: x.status, data: await x.json().catch(() => null) }; };
const rowOf = (id) => JSON.parse(execSync(`npx wrangler d1 execute DB --local --json --command "SELECT * FROM bookings WHERE id = '${id}'"`, { stdio: 'pipe' }).toString())[0].results[0];
for (let i = 0; i <= 2; i++) await call3('PUT', `/companion/hours/days/${berlin(i)}`, L, { ranges: [{ from: '00:00', to: '24:00' }] });
// Bookings other suites left in Lena's next hours move out of the way
sql(`UPDATE bookings SET starts_at = starts_at - 30 * 86400 WHERE companion_id = 'demo_lena' AND status IN ('confirmed', 'completed') AND starts_at < unixepoch() + 9 * 3600 AND starts_at > unixepoch() - 9 * 3600`);
const soon = Math.ceil((Date.now() / 1000 + 5400 + 60) / 900) * 900;
const slow = (await call3('POST', '/bookings', T, { companionId: 'demo_lena', act: 'coffee', startsAt: soon, minutes: 60, place: 'Café', boundariesAgreed: true })).data;
ok(!!slow?.checkoutUrl, `a coffee in about 1½ hours goes to checkout (${slow?.error ?? 'ok'})`);
sql(`UPDATE bookings SET created_at = created_at - 3000 WHERE id = '${slow.id}'`); // 50 minutes on the checkout page
await pay(slow.checkoutUrl);
await call3('POST', `/bookings/${slow.id}/confirm-payment`, T);
let s = rowOf(slow.id);
ok(s.status === 'pending' && Math.abs(s.created_at - Date.now() / 1000) < 10 && s.expires_at === s.created_at + 1800, 'paid after 50 minutes: still a request, with 30 minutes to answer from the payment');
await call3('POST', `/bookings/${slow.id}/cancel`, T);
const tooLate = (await call3('POST', '/bookings', T, { companionId: 'demo_lena', act: 'coffee', startsAt: soon, minutes: 60, place: 'Café', boundariesAgreed: true })).data;
sql(`UPDATE bookings SET starts_at = unixepoch() + 1800 WHERE id = '${tooLate.id}'`); // so long on the checkout page that it starts in half an hour
await pay(tooLate.checkoutUrl);
await call3('POST', `/bookings/${tooLate.id}/confirm-payment`, T);
s = rowOf(tooLate.id);
ok(s.status === 'expired' && s.pay_status === 'refunded' && /^Too close to the start to send · .+ refunded in full$/.test(s.cancel_note ?? ''), `paid half an hour before the start: too late to answer, so it’s closed and refunded (${s.status}, ${s.cancel_note})`);
ok((await intent(tooLate.id)).status === 'canceled', 'the card hold is released');
const told = (await call3('GET', '/me/notifications', T)).data;
ok(told.some((n) => n.title === 'Too late for that time' && /starts too soon for Lena to answer, so .+ is refunded in full\. Pick a later time\.$/.test(n.body)), 'the customer is told to pick a later time');
ok(!(await call3('GET', '/companion/bookings', L)).data.requests.some((x) => x.id === tooLate.id), 'Lena never sees it');
sql(`DELETE FROM hours_days WHERE companion_id = 'demo_lena'`);

// 10) Free now with a card: the 2 minutes to answer start once the payment goes through, and declining releases the hold
const Y = (await login('yuki@demo.zeitmit.app')).token;
const yl = (await call3('GET', '/companion/bookings', Y)).data;
for (const x of [...yl.requests, ...yl.upcoming]) await call3('POST', `/companion/bookings/${x.id}/cancel`, Y, { reason: 'Something else' });
sql(`UPDATE bookings SET starts_at = starts_at - 30 * 86400 WHERE companion_id = 'demo_yuki' AND status IN ('confirmed', 'completed') AND starts_at < unixepoch() + 9 * 3600 AND starts_at > unixepoch() - 9 * 3600`);
await call3('PUT', '/companion/free-now', Y, { hours: 1 });
const nowPaid = (await call3('POST', '/bookings', T, { companionId: 'demo_yuki', act: 'call', instant: true, minutes: 30, place: '', boundariesAgreed: true })).data;
ok(!!nowPaid?.checkoutUrl, `a video date now with Yuki goes to checkout (${nowPaid?.error ?? 'ok'})`);
ok(!(await call3('GET', '/companion/bookings', Y)).data.requests.some((x) => x.id === nowPaid.id), 'Yuki’s phone doesn’t ring before it’s paid');
sql(`UPDATE bookings SET created_at = created_at - 100 WHERE id = '${nowPaid.id}'`); // 100 seconds on the checkout page
await pay(nowPaid.checkoutUrl);
await call3('POST', `/bookings/${nowPaid.id}/confirm-payment`, T);
s = rowOf(nowPaid.id);
ok(s.status === 'pending' && s.instant === 1 && Math.abs(s.created_at - Date.now() / 1000) < 10 && s.expires_at === s.created_at + 120 && s.starts_at === s.created_at,
  'paid after 100 seconds: Yuki still has the full 2 minutes, counted from the payment');
ok((await call3('GET', '/companion/bookings', Y)).data.requests.some((x) => x.id === nowPaid.id && x.instant === true), 'now it’s in Yuki’s requests');
await call3('POST', `/companion/bookings/${nowPaid.id}/decline`, Y);
s = rowOf(nowPaid.id);
ok(s.status === 'rejected' && s.pay_status === 'refunded' && (await intent(nowPaid.id)).status === 'canceled', 'Yuki declines: refunded, the card hold is released');
await call3('DELETE', '/companion/free-now', Y);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll payment checks passed');
process.exit(failures ? 1 : 0);
