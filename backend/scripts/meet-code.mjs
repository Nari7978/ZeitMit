// Meet codes can't go through chat: in one message, spaced out, spelled out, as emoji or split over a few messages.
// Part 1 checks the detector itself (the server's copy and the app's copy must agree); part 2 runs it against a LOCAL
// API with the demo companions seeded. Usage: node scripts/meet-code.mjs [api]
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [BASE = 'http://localhost:8787'] = process.argv.slice(2);
const CID = 'demo_noah';
let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? '✓' : '✗'} ${label}`); if (!cond) failures++; };

// 1) The detector, server and app copies side by side
const dir = mkdtempSync(join(tmpdir(), 'meetcode-'));
const build = (src, out) => execFileSync('node_modules/.bin/esbuild', [src, '--bundle', '--format=esm', '--platform=node', '--log-level=error', `--outfile=${join(dir, out)}`]);
build('src/lib/meetCode.ts', 'server.mjs');
build('../mobile/src/lib/meetCode.ts', 'app.mjs');
const server = await import(join(dir, 'server.mjs'));
const app = await import(join(dir, 'app.mjs'));
const both = (text, code, prev) => {
  const a = server.sharesCode(text, code, prev), b = app.sharesCode(text, code, prev);
  if (a !== b) ok(false, `server and app disagree on ${JSON.stringify(text)}`);
  return a;
};
const CODE = '3568';
const blocked = ['3568', 'my code is 3568 ok', '3 5 6 8', '3-5-6-8', '3.5.6.8', '35 68', '35,68', '13568', 'three five six eight', 'Drei Fünf Sechs Acht',
  'drei-fünf-sechs-acht', '3 five 6 eight', '3️⃣5️⃣6️⃣8️⃣', '３５６８', 'Code: 3 😀 5 😀 6 😀 8', '3\n5\n6\n8', '3:5:6:8', '35:68', '1.3.5.6.8', 'at 18:30 3568'];
for (const t of blocked) ok(both(t, CODE), `blocked: ${JSON.stringify(t)}`);
const fine = ['See you at 18:30.', 'From 18:30–20:00', 'Am 28.11.2026 um 19.30 Uhr', '6h30 at the station',
  'See you at 18:30', 'We are 2 people, table 7', 'Meet at 19.00 at Alexanderplatz', 'Bus 356 then 8 minutes walk', '28.11. works for me',
  'I am 35, she is 68', 'Give me the meet code', 'one or two hours?', 'Platz für 4 Personen um 20 Uhr', ''];
for (const t of fine) ok(!both(t, CODE), `allowed: ${JSON.stringify(t)}`);
// Split over messages (previous ones newest first)
ok(both('68', CODE, ['35']), 'split: “35”, then “68”');
ok(both('68', CODE, ['the code starts with 35']), 'split: “… starts with 35”, then “68”');
ok(both('6 8', CODE, ['5', '3']), 'split over three messages: “3”, “5”, “6 8”');
ok(!both('68', CODE, ['35 people were there']), 'not a split: “35 people were there”, then “68”');
ok(!both('Sounds good', CODE, ['35']), 'not a split when the new message has no digits first');
// Codes from before this change can look like times or dates: those still count when written as times are left alone
ok(!both('See you at 18:30', '1830') && both('1830', '1830'), 'an old time-like code: “18:30” is a time, “1830” is blocked');
ok(!both('am 28.11. passt', '2811'), 'an old date-like code: “28.11.” is a date');
// Fuzz: the two copies always agree
const bits = ['3', '5', '6', '8', '1', ' ', '-', '.', ':', 'drei', 'five', 'code', 'um', '😀', '12:30', '\n'];
let same = true;
for (let i = 0; i < 3000; i++) {
  const t = Array.from({ length: 1 + (i % 9) }, (_, k) => bits[(i * 7 + k * 13 + ((i * k) % 5)) % bits.length]).join('');
  if (server.sharesCode(t, CODE, ['35']) !== app.sharesCode(t, CODE, ['35'])) { same = false; console.log('  differs:', JSON.stringify(t)); break; }
}
ok(same, 'server and app agree on 3000 generated messages');
// New codes never look like a time or a date
const timeOrDate = (c) => { const a = +c.slice(0, 2), b = +c.slice(2); return (a <= 24 && b <= 59) || (a >= 1 && a <= 31 && b >= 1 && b <= 12); };
let i = 0;
const all = Array.from({ length: 10000 }, (_, n) => String(n).padStart(4, '0'));
const fromList = () => all[i++ % all.length];
const picked = new Set();
for (let n = 0; n < 9000; n++) picked.add(server.newMeetCode(fromList));
ok([...picked].every((c) => /^\d{4}$/.test(c) && !timeOrDate(c)) && picked.size > 8000, `new codes are never times or dates (${picked.size} possible codes)`);
const real = Array.from({ length: 3000 }, () => server.newMeetCode());
ok(real.every((c) => !timeOrDate(c)) && new Set(real).size > 2000, 'random new codes too, and they vary');

// 2) Against the API
const call = async (method, path, token, body) => {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const login = async (email) => {
  const r = await call('POST', '/auth/request-code', null, { email });
  return (await call('POST', '/auth/verify', null, { email, code: r.data.devCode })).data;
};
const sql = (q) => execSync(`npx wrangler d1 execute DB --local --command "${q}"`, { stdio: 'pipe' });
const N = await login('noah@demo.zeitmit.app');
const C = await login(`codes+${Date.now()}@example.com`);
await call('PATCH', '/me', C.token, { name: 'Cora Code', ageConfirmed: true });
sql(`UPDATE users SET id_status = 'approved' WHERE id = '${C.user.id}'`);
const left = (await call('GET', '/companion/bookings', N.token)).data;
for (const x of [...left.requests, ...left.upcoming]) await call('POST', `/companion/bookings/${x.id}/cancel`, N.token, { reason: 'Something else' });
const day = (await call('GET', `/companions/${CID}/slots`)).data.find((d) => d.times.length);
const b = (await call('POST', '/bookings', C.token, { companionId: CID, act: 'movies', date: day.date, time: day.times[0], dur: 1, place: '' })).data;
await call('POST', `/companion/bookings/${b.id}/accept`, N.token);
const otp = (await call('GET', '/bookings', C.token)).data.find((x) => x.id === b.id).otp;
ok(/^\d{4}$/.test(otp) && !timeOrDate(otp), `the booking's code (${otp}) isn't a time or a date`);
const conv = (await call('POST', '/conversations', C.token, { bookingId: b.id })).data.id;
const send = (token, text) => call('POST', `/conversations/${conv}/messages`, token, { text });
const words = { 0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine' };
for (const [what, text] of [['the code', otp], ['in a sentence', `Here you go: ${otp}`], ['spaced out', otp.split('').join(' ')], ['with dashes', otp.split('').join('-')],
  ['spelled out', otp.split('').map((d) => words[d]).join(' ')]]) {
  const r = await send(C.token, text);
  ok(r.status === 400 && r.data?.code === 'meet_code', `the customer can't send it ${what} (${r.status} ${r.data?.code})`);
}
let r = await send(C.token, 'Hi! See you at 18:30 at the entrance, we are 2.');
ok(r.status === 201, 'a normal message with a time and a number goes through');
r = await send(C.token, otp.slice(0, 2));
ok(r.status === 201, 'half a code alone goes through');
r = await send(N.token, 'ok?');
r = await send(C.token, otp.slice(2));
ok(r.status === 400 && r.data?.code === 'meet_code', 'but the other half is refused, even with a reply in between');
r = await send(N.token, `is it ${otp}?`);
ok(r.status === 400 && r.data?.code === 'meet_code', 'the companion can’t send it either');
ok(r.data?.error === 'Meet codes can’t be shared in chat. Show yours in person when you meet: that’s what confirms the meet-up and releases the payment.', 'with the reason');
const msgs = (await call('GET', `/conversations/${conv}/messages`, C.token)).data;
ok(msgs.length === 3 && !msgs.some((m) => server.sharesCode(m.t, otp)), `refused messages aren't stored (${msgs.length} messages)`);
const notes = (await call('GET', '/me/notifications', N.token)).data.filter((n) => n.go === `chat:${conv}`);
ok(notes.length === 2 && !notes.some((n) => server.sharesCode(n.body ?? '', otp)), `and nobody is notified with the code (${notes.length} message notifications)`);
// A booking from before this change with a time-like code
sql(`UPDATE bookings SET meet_code = '1830' WHERE id = '${b.id}'`);
ok((await send(C.token, 'Running late, there by 18:30')).status === 201, 'old time-like code: “18:30” in a message is fine');
ok((await send(C.token, '1830')).status === 400, 'old time-like code: “1830” is refused');
// Other people's bookings don't block anything
const D = await login(`other+${Date.now()}@example.com`);
ok((await call('POST', `/conversations/${conv}/messages`, D.token, { text: 'hi' })).status === 404, 'strangers can’t post in the thread');
await call('POST', `/bookings/${b.id}/cancel`, C.token);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
