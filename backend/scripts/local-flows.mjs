// Time-dependent flows that the smoke test can't reach through the API alone: it moves booking start times
// in the LOCAL database (wrangler d1 --local). Run against `npm run dev` with the demo companions seeded.
// Usage: node scripts/local-flows.mjs
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:8787';
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) failures++;
};
const call = async (method, path, token, body) => {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const login = async (email) => {
  const r = await call('POST', '/auth/request-code', null, { email });
  return (await call('POST', '/auth/verify', null, { email, code: r.data.devCode })).data;
};
const sql = (q) => execSync(`npx wrangler d1 execute DB --local --command "${q}"`, { stdio: 'pipe' });
const adminToken = (userId) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: userId, email: 'admin@example.com', role: 'admin', exp: Math.floor(Date.now() / 1000) + 600 })}`;
  return `${head}.${crypto.createHmac('sha256', process.env.JWT_SECRET ?? 'local-dev-secret-change-me').update(head).digest('base64url')}`;
};

const me = await login(`flows+${Date.now()}@example.com`);
const T = me.token;
const A = adminToken(me.user.id);
await call('PATCH', '/me', T, { name: 'Pia Weber', ageConfirmed: true });
sql(`UPDATE users SET id_status = 'approved' WHERE id = '${me.user.id}'`);
const lena = await login('lena@demo.zeitmit.app');
const L = lena.token;

const slots = (await call('GET', '/companions/demo_lena')).data.slots.flatMap((d) => d.times.map((t) => [d.date, t])).slice(-3);
const book = async ([date, time]) => (await call('POST', '/bookings', T, { companionId: 'demo_lena', act: 'coffee', date, time, dur: 1, place: 'Café Einstein' })).data;

// 1) Meet code ends the booking's chat for both
const b1 = await book(slots[0]);
await call('POST', `/companion/bookings/${b1.id}/accept`, L);
sql(`UPDATE bookings SET starts_at = unixepoch() + 3600 WHERE id = '${b1.id}'`);
const t1 = (await call('POST', '/conversations', T, { bookingId: b1.id })).data.id;
let r = await call('POST', `/conversations/${t1}/messages`, T, { text: 'See you at the entrance!' });
ok(r.status === 201, 'chat works before you meet');
const otp = (await call('GET', '/bookings', T)).data.find((x) => x.id === b1.id).otp;
r = await call('POST', `/companion/bookings/${b1.id}/verify-code`, L, { code: otp });
ok(r.status === 200, 'companion enters the meet code');
r = await call('GET', '/conversations', T);
ok(r.data.find((x) => x.id === t1)?.canSend === false, 'chat ended for the customer after the meet code');
r = await call('GET', '/conversations?side=companion', L);
ok(r.data.find((x) => x.id === t1)?.canSend === false, 'chat ended for the companion after the meet code');
r = await call('POST', `/conversations/${t1}/messages`, L, { text: 'Thanks!' });
ok(r.status === 403, 'nobody can write after the meet code');
r = await call('GET', `/conversations/${t1}/messages`, T);
ok(r.data.length === 1 && r.data[0].t === 'See you at the entrance!', 'history stays readable');

// 2) Booking again starts a fresh thread
const b2 = await book(slots[1]);
const t2 = (await call('POST', '/conversations', T, { bookingId: b2.id })).data.id;
r = await call('GET', '/conversations', T);
ok(t2 !== t1 && r.data.find((x) => x.id === t2)?.canSend === true, 'a new booking gets a new, open thread');
r = await call('POST', '/conversations', T, { companionId: 'demo_lena' });
ok(r.data.id === t2, 'Message on the profile opens the current booking’s thread');

// 3) Late cancellation: no refund, companion keeps their pay
await call('POST', `/companion/bookings/${b2.id}/accept`, L);
sql(`UPDATE bookings SET starts_at = unixepoch() + 5 * 3600 WHERE id = '${b2.id}'`);
const before = (await call('GET', '/companion/bookings', L)).data.earnings.released;
r = await call('POST', `/bookings/${b2.id}/cancel`, T, { reason: 'Feeling unwell' });
ok(r.status === 200 && r.data.late === true && r.data.refunded === 0, 'cancelling less than 24 h before: no refund');
r = await call('GET', '/bookings', T);
const late = r.data.find((x) => x.id === b2.id);
ok(late.status === 'cancelled' && late.pay === 'released' && /no refund/.test(late.note), 'booking shows it was a late cancellation');
r = await call('GET', '/companion/bookings', L);
ok(r.data.earnings.released === before + b2.total - Math.round(b2.total / 11), 'companion is paid for the reserved time');
r = await call('GET', '/me/notifications', L);
ok(r.data.some((n) => n.title === 'Pia cancelled late' && /You still get/.test(n.body)), 'companion is told they still get paid');
r = await call('GET', '/conversations', T);
ok(r.data.find((x) => x.id === t2)?.canSend === false, 'late-cancelled booking’s chat ends too');

// 4) Support can still refund money that was already taken (e.g. a no-show)
r = await call('POST', `/admin/bookings/${b2.id}/refund`, A);
ok(r.status === 200, 'admin refunds a paid-out booking');
r = await call('GET', '/bookings', T);
ok(r.data.find((x) => x.id === b2.id).pay === 'refunded', 'payment shows as refunded');
r = await call('POST', `/admin/bookings/${b2.id}/refund`, A);
ok(r.status === 409, 'a booking can only be refunded once');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
