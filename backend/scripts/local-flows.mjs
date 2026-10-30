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

// 5) Payouts: a new companion earns, requests a payout, ZeitMit pays it (by hand) or rejects it
{
  const PIXEL = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  const co = await login(`earner+${Date.now()}@example.com`);
  const P = co.token;
  await call('PATCH', '/me', P, { name: 'Jana Koch', ageConfirmed: true });
  const idp = (await call('POST', '/photos', P, { kind: 'id', data: PIXEL })).data;
  // A profile photo and 3 more, as the app asks for
  const photos = async () => {
    const up = async (kind) => (await call('POST', '/photos', P, { kind, data: PIXEL })).data.id;
    return { photoId: await up('companion'), galleryIds: [await up('gallery'), await up('gallery'), await up('gallery')] };
  };
  r = await call('POST', '/companion/apply', P, {
    ...(await photos()),
    name: 'Jana', age: 31, gender: 'w', about: 'Architect who loves slow city walks, museums and long talks over good coffee in Berlin.',
    acts: ['coffee', 'walks'], langs: ['German', 'English'], rate: 30, days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], wins: ['am', 'pm', 'eve'],
    adult: true, rules: true, idPhotoId: idp.id,
  });
  ok(r.status === 201, 'new companion applies');
  await call('POST', `/admin/companions/${co.user.id}/approve`, A);

  const janaSlots = (await call('GET', `/companions/${co.user.id}`)).data.slots.flatMap((d) => d.times.map((t) => [d.date, t])).slice(-2);
  const earn = async ([date, time]) => {
    const bk = (await call('POST', '/bookings', T, { companionId: co.user.id, act: 'coffee', date, time, dur: 2, place: 'Café' })).data;
    await call('POST', `/companion/bookings/${bk.id}/accept`, P);
    sql(`UPDATE bookings SET starts_at = unixepoch() + 3600 WHERE id = '${bk.id}'`);
    const code = (await call('GET', '/bookings', T)).data.find((x) => x.id === bk.id).otp;
    await call('POST', `/companion/bookings/${bk.id}/verify-code`, P, { code });
    return bk;
  };
  const e1 = await earn(janaSlots[0]);
  r = await call('GET', '/companion/payouts', P);
  ok(r.data.balance.pending === 6000 && r.data.balance.available === 0 && r.data.rules.holdDays === 2 && r.data.balance.nextAvailableAt > Date.now() / 1000,
    `earnings wait ${r.data.rules.holdDays} days before they can be withdrawn (€60 pending)`);
  sql(`UPDATE bookings SET released_at = released_at - 3 * 86400 WHERE id = '${e1.id}'`);
  r = await call('GET', '/companion/payouts', P);
  ok(r.data.balance.available === 6000 && r.data.balance.pending === 0, 'after the wait: €60 available');
  r = await call('GET', '/companion/bookings', P);
  ok(r.data.earnings.available === 6000, 'Overview gets the same balance');

  r = await call('POST', '/companion/payouts', P);
  ok(r.status === 400 && /bank account/.test(r.data.error), 'payout needs a bank account first');
  r = await call('PUT', '/companion/payouts/account', P, { holderName: 'Jana Koch', iban: 'DE89 3704 0044 0532 0130 01' });
  ok(r.status === 400 && /IBAN/.test(r.data.error), 'IBAN check digits are verified');
  r = await call('PUT', '/companion/payouts/account', P, { holderName: 'Jana Koch', iban: 'de89 3704 0044 0532 0130 00' });
  ok(r.status === 201 && r.data.ibanMasked === 'DE89 •••• 3000', 'valid IBAN saved, only shown masked');

  r = await call('POST', '/companion/payouts', P);
  ok(r.status === 201 && r.data.amount === 6000 && r.data.status === 'requested', 'companion requests the whole €60');
  const po1 = r.data.id;
  r = await call('POST', '/companion/payouts', P);
  ok(r.status === 409, 'only one payout request at a time');
  r = await call('PUT', '/companion/payouts/account', P, { holderName: 'Someone Else', iban: 'DE89370400440532013000' });
  ok(r.status === 409, 'bank account is locked while a payout is on its way');
  r = await call('GET', '/companion/payouts', P);
  ok(r.data.balance.available === 0 && r.data.balance.requested === 6000, 'requested amount is reserved');

  r = await call('GET', '/admin/payouts', A);
  const row = r.data.find((x) => x.id === po1);
  ok(row && row.iban === 'DE89 3704 0044 0532 0130 00' && row.holderName === 'Jana Koch' && row.amount === 6000 && row.shortBy === 0, 'admin sees the request with the full IBAN');
  r = await call('GET', '/admin/stats', A);
  ok(r.data.pendingPayouts >= 1, 'admin badge counts open payout requests');
  r = await call('DELETE', `/admin/users/${co.user.id}`, A);
  ok(r.status === 409 && r.data.code === 'unpaid', 'admin is warned before deleting someone who is still owed money');
  r = await call('DELETE', '/me', P);
  ok(r.status === 409 && /earnings/.test(r.data.error), 'a companion can’t delete their account while money is owed');

  r = await call('POST', `/admin/payouts/${po1}/paid`, A, { reference: 'SEPA 2026-11-02' });
  ok(r.status === 200, 'admin marks the transfer as paid');
  r = await call('POST', `/admin/payouts/${po1}/paid`, A);
  ok(r.status === 409, 'a payout can only be marked once');
  r = await call('GET', '/companion/payouts', P);
  ok(r.data.balance.available === 0 && r.data.balance.paid === 6000 && r.data.payouts[0].status === 'paid' && r.data.payouts[0].reference === 'SEPA 2026-11-02', 'companion sees it as paid, with the reference');
  r = await call('GET', '/me/notifications', P);
  ok(r.data.some((n) => n.title === 'Payout sent' && n.go === 'payouts' && n.body.includes('DE89 •••• 3000')), 'companion is told the money is on its way');

  // Second payout gets rejected: the money goes back to the balance
  const e2 = await earn(janaSlots[1]);
  sql(`UPDATE bookings SET released_at = released_at - 3 * 86400 WHERE id = '${e2.id}'`);
  r = await call('POST', '/companion/payouts', P);
  const po2 = r.data.id;
  r = await call('POST', `/admin/payouts/${po2}/reject`, A, {});
  ok(r.status === 400, 'rejecting needs a reason');
  r = await call('POST', `/admin/payouts/${po2}/reject`, A, { reason: 'The account holder doesn’t match your verified name.' });
  ok(r.status === 200, 'admin rejects a payout with a reason');
  r = await call('GET', '/companion/payouts', P);
  ok(r.data.balance.available === 6000 && r.data.payouts[0].status === 'rejected' && /verified name/.test(r.data.payouts[0].note), 'rejected amount is back in the balance, with the reason');

  // A refund after the first payout: deducted from what's left
  r = await call('POST', `/admin/bookings/${e1.id}/refund`, A);
  r = await call('GET', '/companion/payouts', P);
  ok(r.status === 200 && r.data.balance.available === 0, 'refund of a paid-out booking is deducted from the balance (€60 − €60)');
  r = await call('GET', '/me/notifications', P);
  ok(r.data.some((n) => n.title === 'A booking was refunded' && n.go === 'payouts'), 'companion is told about the deduction');
  r = await call('POST', '/companion/payouts', P);
  ok(r.status === 409 && /from €20/.test(r.data.error), 'nothing to request below €20');
  r = await call('PUT', '/companion/payouts/account', P, { holderName: 'Jana Koch', iban: 'AT61 1904 3002 3457 3201' });
  ok(r.status === 200, 'bank account can change when nothing is on its way');
  r = await call('GET', '/me/notifications', P);
  ok(r.data.some((n) => n.title === 'Payout account changed'), 'a changed bank account is notified');

  // Removing the listing keeps earnings and history; applying again works
  r = await call('DELETE', `/admin/companions/${co.user.id}`, A);
  ok(r.status === 200, 'admin removes the listing');
  r = await call('GET', '/companion/payouts', P);
  ok(r.data.payouts.length === 2 && r.data.balance.paid === 6000, 'earnings and payout history survive a removed listing');
  const idp2 = (await call('POST', '/photos', P, { kind: 'id', data: PIXEL })).data;
  const again = await photos();
  r = await call('POST', '/companion/apply', P, {
    ...again,
    name: 'Jana', age: 31, gender: 'w', about: 'Architect who loves slow city walks, museums and long talks over good coffee in Berlin.',
    acts: ['coffee'], langs: ['German'], rate: 30, days: ['Sat'], wins: ['pm'], adult: true, rules: true, idPhotoId: idp2.id,
  });
  ok(r.status === 201, 'applying again after a removal works (bookings stay attached)');
  r = await call('DELETE', `/admin/users/${co.user.id}?force=1`, A);
  ok(r.status === 200, 'admin can still delete the account when forced');
  ok((await fetch(`${BASE}/photos/${again.galleryIds[0]}`)).status === 404, 'their photos are deleted with the account');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
