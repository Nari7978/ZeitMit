// Android 1.3.8: incoming video dates ring full screen with the app closed, and Free now stays online in the
// background. The server's part:
//  - the app says it can ring by itself (`pushCalls` with the push token);
//  - a free-now request's push carries who, how long, what the companion earns and until when it rings;
//  - phones that ring by themselves get a silent push that stops the ringing when a request is declined, cancelled,
//    runs out or can't happen, and when the one who rang hangs up before the other came (never on accept);
//  - Free now check-ins from the background (`bg`) count for 30 minutes instead of 10.
// Runs against a LOCAL API with the demo companions seeded and pushes sent to this script:
//   npx wrangler dev --local --test-scheduled --var EXPO_PUSH_URL:http://localhost:8798/push
// Uses Yuki (video dates). Usage: node scripts/call-screen.mjs [api]
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';

const [BASE = 'http://localhost:8787'] = process.argv.slice(2);
const YID = 'demo_yuki';
const TOKEN = 'ExponentPushToken[call-screen-test]';
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
const sql = (q) => execSync(`npx wrangler d1 execute DB --local --command "${q}"`, { stdio: 'pipe' });
const one = (q) => JSON.parse(execSync(`npx wrangler d1 execute DB --local --json --command "${q}"`, { stdio: 'pipe' }).toString())[0].results[0];
const row = (id) => one(`SELECT * FROM bookings WHERE id = '${id}'`);
const user = (id) => one(`SELECT push_token, push_calls FROM users WHERE id = '${id}'`);
const comp = () => one(`SELECT free_now_until, free_now_seen, free_now_bg FROM companions WHERE user_id = '${YID}'`);
const nowS = () => Math.floor(Date.now() / 1000);

// The push service (EXPO_PUSH_URL points here): keeps every push the API sends.
const pushes = [];
createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try { pushes.push(...[].concat(JSON.parse(body))); } catch { /* not JSON */ }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"data":{"status":"ok"}}');
  });
}).listen(8798);
const offs = (id) => pushes.filter((p) => p.to === TOKEN && p.data?.kind === 'call-off' && p.data.bookingId === id);

/** A socket (a call room) that keeps what it receives. */
const join = (id, token) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/calls/${id}/ws?token=${encodeURIComponent(token)}`);
  const got = [];
  ws.onmessage = (e) => got.push(JSON.parse(e.data));
  ws.onopen = () => resolve({ got, send: (m) => ws.send(JSON.stringify(m)), has: (t) => got.some((m) => m.type === t) });
  ws.onerror = () => reject(new Error('socket failed'));
});

const Y = await login('yuki@demo.zeitmit.app');
const customer = async (name) => {
  const u = await login(`callscreen+${name.toLowerCase()}+${Date.now()}@example.com`);
  await call('PATCH', '/me', u.token, { name, ageConfirmed: true });
  sql(`UPDATE users SET id_status = 'approved' WHERE id = '${u.user.id}'`);
  return u.token;
};
const A = await customer('Asha');
const now_ = (minutes = 30) => call('POST', '/bookings', A, { companionId: YID, act: 'call', instant: true, minutes, boundariesAgreed: true });
const listed = async () => (await call('GET', '/companions')).data.find((c) => c.id === YID);

// A clean slate for Yuki: nothing open, nothing confirmed around now, Free now off.
const open = (await call('GET', '/companion/bookings', Y.token)).data;
for (const x of [...open.requests, ...open.upcoming]) await call('POST', `/companion/bookings/${x.id}/cancel`, Y.token, { reason: 'Something else' });
sql(`UPDATE bookings SET starts_at = starts_at - 30 * 86400 WHERE companion_id = '${YID}' AND status IN ('completed', 'confirmed') AND starts_at > unixepoch() - 9 * 3600`);
sql(`UPDATE companions SET free_now_until = NULL, free_now_seen = NULL, free_now_bg = 0, free_now_misses = 0, free_now_paused = NULL WHERE user_id = '${YID}'`);

// 1) The app says whether it rings by itself, with its push token
let r = await call('PATCH', '/me', Y.token, { pushToken: TOKEN, pushCalls: true, prefs: { pushBookings: false } });
ok(r.status === 200 && user(YID).push_calls === 1, 'an Android 1.3.8 phone: rings incoming video dates by itself');
await call('PATCH', '/me', Y.token, { pushToken: TOKEN });
ok(user(YID).push_calls === 0, 'the same token from an app that can’t (no pushCalls): not any more');
await call('PATCH', '/me', Y.token, { pushToken: null, pushCalls: true });
ok(user(YID).push_calls === 0 && user(YID).push_token === null, 'no push token, nothing to ring');
await call('PATCH', '/me', Y.token, { name: 'Yuki' });
ok(user(YID).push_calls === 0, 'other changes leave it as it is');
await call('PATCH', '/me', Y.token, { pushToken: TOKEN, pushCalls: true });
ok(user(YID).push_calls === 1, 'back on');

// 2) Free now check-ins from the background count for 30 minutes, from the open app for 10
r = await call('PUT', '/companion/free-now', Y.token, { hours: 2 });
ok(r.status === 200 && comp().free_now_bg === 0, 'Free now on (from the app)');
r = await call('POST', '/companion/free-now/seen', Y.token, { bg: true });
ok(r.status === 200 && r.data.until > nowS() && comp().free_now_bg === 1, `a check-in from the background says it's still on (until ${r.data?.until})`);
sql(`UPDATE companions SET free_now_seen = unixepoch() - 900 WHERE user_id = '${YID}'`);
ok(!!(await listed())?.freeNow, 'last seen 15 minutes ago from the background: still free now');
sql(`UPDATE companions SET free_now_bg = 0 WHERE user_id = '${YID}'`);
ok((await listed())?.freeNow === null, 'the same from the open app: not any more (10 minutes)');
sql(`UPDATE companions SET free_now_bg = 1, free_now_seen = unixepoch() - 2000 WHERE user_id = '${YID}'`);
ok((await listed())?.freeNow === null, 'from the background over 30 minutes ago: not either');
r = await call('POST', '/companion/free-now/seen', Y.token, {});
ok(comp().free_now_bg === 0 && !!(await listed())?.freeNow, 'the open app checks in again: free now again');

// 3) A free-now request's push says who, how long, what Yuki earns and until when it rings
const before = pushes.length;
r = await now_(30);
const v1 = r.data?.id;
ok(r.status === 201 && !!v1, `Asha asks for a video date now (${r.status} ${r.data?.error ?? ''})`);
ok(await until(() => pushes.slice(before).some((p) => p.to === TOKEN && p.data?.kind === 'instant' && p.data.bookingId === v1)), 'Yuki’s phone rings');
const ring = pushes.slice(before).find((p) => p.data?.kind === 'instant' && p.data.bookingId === v1);
const b1 = row(v1);
ok(ring.data.who === 'Asha' && ring.data.minutes === 30 && ring.data.earn === b1.subtotal && ring.data.expiresAt === b1.expires_at,
  `with who, how long and what she earns (${JSON.stringify({ who: ring.data.who, minutes: ring.data.minutes, earn: ring.data.earn })}), until ${ring.data.expiresAt}`);
ok(ring.priority === 'high' && ring.title === 'Video date request from Asha', 'still a high-priority push with its title (for phones that can’t ring by themselves)');

// 4) The ringing stops when it's declined, cancelled or runs out; not when it's accepted
await call('POST', `/companion/bookings/${v1}/decline`, Y.token);
ok(await until(() => offs(v1).length === 1), 'declined (on another phone): a push stops the ringing');
const off = offs(v1)[0];
ok(off.priority === 'high' && off.title === undefined && off.body === undefined && off.sound === undefined, 'a silent one, nothing shown');
const v2 = (await now_(30)).data?.id;
await call('POST', `/bookings/${v2}/cancel`, A, { reason: 'Plans changed' });
ok(await until(() => offs(v2).length === 1), 'Asha cancels it: the ringing stops');
const v3 = (await now_(30)).data?.id;
sql(`UPDATE bookings SET created_at = created_at - 121 WHERE id = '${v3}'`);
await call('GET', '/bookings', A);
ok(row(v3).status === 'expired' && await until(() => offs(v3).length === 1), 'not answered in 2 minutes: expired, and the ringing stops');
const v4 = (await now_(30)).data?.id;
r = await call('POST', `/companion/bookings/${v4}/accept`, Y.token);
await sleep(800);
ok(r.status === 200 && offs(v4).length === 0, 'accepted (on this phone): nothing to stop');

// 5) The one who rang hangs up before the other came: the ringing stops
const pre = pushes.length;
const a1 = await join(v4, A);
ok(await until(() => a1.has('hello')), 'Asha joins the video date, Yuki isn’t there yet');
ok(await until(() => pushes.slice(pre).some((p) => p.to === TOKEN && p.data?.kind === 'ring' && p.data.bookingId === v4)), 'Yuki’s phone rings');
a1.send({ type: 'bye' });
ok(await until(() => offs(v4).length === 1), 'Asha hangs up before Yuki came: a push stops the ringing');
await call('POST', `/companion/bookings/${v4}/cancel`, Y.token, { reason: 'Something else' });

// 6) Phones that can't ring by themselves don't get those silent pushes
await call('PATCH', '/me', Y.token, { pushToken: TOKEN });
const v5 = (await now_(30)).data?.id;
await call('POST', `/companion/bookings/${v5}/decline`, Y.token);
await sleep(800);
ok(offs(v5).length === 0, 'without pushCalls: no silent push');

// Tidy up: Free now off, the test push token gone
await call('DELETE', '/companion/free-now', Y.token);
r = await call('POST', '/companion/free-now/seen', Y.token, { bg: true });
ok(r.status === 200 && r.data.until === null, 'Free now off: a check-in from the background hears it’s off (until null)');
await call('PATCH', '/me', Y.token, { pushToken: null, prefs: { pushBookings: true } });

console.log(failures ? `\n${failures} check(s) failed` : '\nAll call screen checks passed');
process.exit(failures ? 1 : 0);
