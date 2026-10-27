// Payment flow test against a local API configured with a mock Stripe (STRIPE_API_BASE).
// Usage: node scripts/stripe-flow.mjs http://localhost:8787 http://localhost:9999
const [BASE = 'http://localhost:8787', MOCK = 'http://localhost:9999'] = process.argv.slice(2);
let failures = 0;
const ok = (c, l) => { console.log(`${c ? '✓' : '✗'} ${l}`); if (!c) failures++; };
const call = async (m, p, t, b) => { const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, data: await r.json().catch(() => null) }; };
const login = async (e) => { const r = await call('POST', '/auth/request-code', null, { email: e }); return (await call('POST', '/auth/verify', null, { email: e, code: r.data.devCode })).data.token; };
const pay = (url) => fetch(MOCK + new URL(url).pathname).then((r) => r.json());

const T = await login(`payer+${Date.now()}@example.com`);
await call('PATCH', '/me', T, { name: 'Payer', ageConfirmed: true });
const slot = (await call('GET', '/companions/demo_lena')).data.slots.find((d) => d.times.length);
let r = await call('POST', '/bookings', T, { companionId: 'demo_lena', act: 'coffee', date: slot.date, time: slot.times[0], dur: 1, place: 'Café' });
ok(r.status === 201 && !!r.data.checkoutUrl, 'booking returns a Stripe Checkout URL');
const id = r.data.id;
ok(!(await call('GET', '/bookings', T)).data.some((b) => b.id === id), 'unpaid booking hidden from customer list');
const K = await login('lena@demo.zeitmit.app');
ok(!(await call('GET', '/companion/bookings', K)).data.requests.some((b) => b.id === id), 'companion does not see unpaid request');
r = await call('POST', `/bookings/${id}/confirm-payment`, T);
ok(r.status === 402 && r.data.paid === false, 'confirm before paying → not paid');
await pay(r.data.checkoutUrl);
r = await call('POST', `/bookings/${id}/confirm-payment`, T);
ok(r.status === 200 && r.data.paid && r.data.booking.status === 'pending', 'confirm after paying → request sent');
ok((await call('GET', '/companion/bookings', K)).data.requests.some((b) => b.id === id), 'companion now sees the request');
await call('POST', `/companion/bookings/${id}/accept`, K);
const otp = (await call('GET', '/bookings', T)).data.find((b) => b.id === id).otp;
r = await call('POST', `/bookings/${id}/cancel`, T);
const state1 = await fetch(MOCK + '/state').then((x) => x.json());
const pi = Object.values(state1.intents).at(-1);
ok(r.status === 200 || r.status === 409, `cancel response ${r.status}`);
if (r.status === 200) ok(pi.status === 'canceled', 'cancel releases the card hold (PI canceled)');

// Second booking: release with meet code captures payment
const slot2 = (await call('GET', '/companions/demo_jonas')).data.slots.find((d) => d.times.length);
r = await call('POST', '/bookings', T, { companionId: 'demo_jonas', act: 'walks', date: slot2.date, time: slot2.times[0], dur: 2, place: 'Museum' });
const id2 = r.data.id; await pay(r.data.checkoutUrl); await call('POST', `/bookings/${id2}/confirm-payment`, T);
const J = await login('jonas@demo.zeitmit.app');
await call('POST', `/companion/bookings/${id2}/accept`, J);
console.log('  (set booking start ~now for release test)');
process.stdout.write(id2 + '\n');
console.log(failures ? `\n${failures} failed` : '\nAll payment checks passed (part 1)');
