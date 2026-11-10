// Private safety feedback after meet-ups: “Did you feel safe?”, stars and tags, seen only by admins.
// Runs against a LOCAL API with the demo companions seeded (it completes bookings by moving start times in the local
// database), e.g. `npm run dev`. Usage: node scripts/feedback.mjs [api] [mockBrevo] [adminEmail]
// With a mock Brevo (see emails.mjs) and the API started with `--var ADMIN_EMAILS:<adminEmail>`, it also checks the
// alert email the team gets when someone didn't feel safe.
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const [BASE = 'http://localhost:8787', MOCK = '', ADMIN = 'safety@example.com'] = process.argv.slice(2);
const CID = 'demo_noah';
let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? '✓' : '✗'} ${label}`); if (!cond) failures++; };
const call = async (method, path, token, body) => {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const sql = (q) => execSync(`npx wrangler d1 execute DB --local --command "${q}"`, { stdio: 'pipe' });
const count = (q) => JSON.parse(execSync(`npx wrangler d1 execute DB --local --json --command "${q}"`, { stdio: 'pipe' }).toString())[0].results[0].n;
const inbox = async (to, since) => (MOCK ? (await (await fetch(MOCK + '/emails')).json()).filter((m) => m.to === to && m.at >= since) : []);
/** Signs in with the on-screen dev code, or with the code from the login email when email is on. */
const login = async (email) => {
  const t0 = Date.now();
  let r = await call('POST', '/auth/request-code', null, { email });
  if (r.status === 429) { await new Promise((res) => setTimeout(res, 31000)); r = await call('POST', '/auth/request-code', null, { email }); }
  let code = r.data?.devCode;
  for (let i = 0; !code && MOCK && i < 40; i++) {
    code = (await inbox(email, t0)).reverse().find((m) => /is your ZeitMit code$/.test(m.subject))?.subject.slice(0, 6);
    if (!code) await new Promise((res) => setTimeout(res, 150));
  }
  return (await call('POST', '/auth/verify', null, { email, code })).data;
};
const adminToken = (userId) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: userId, email: 'admin@example.com', role: 'admin', exp: Math.floor(Date.now() / 1000) + 600 })}`;
  return `${head}.${crypto.createHmac('sha256', process.env.JWT_SECRET ?? 'local-dev-secret-change-me').update(head).digest('base64url')}`;
};
const cron = () => fetch(`${BASE}/__scheduled?cron=*/10+*+*+*+*`);
const asks = async (token, id) => (await call('GET', '/me/notifications', token)).data.filter((n) => n.go === `feedback:${id}`);

const stamp = Date.now();
const C = await login(`feedback+${stamp}@example.com`);
await call('PATCH', '/me', C.token, { name: 'Mira Feld', ageConfirmed: true });
sql(`UPDATE users SET id_status = 'approved' WHERE id = '${C.user.id}'`);
const N = await login('noah@demo.zeitmit.app');
const S = await login(`stranger+${stamp}@example.com`);
const A = adminToken(S.user.id);
const left = (await call('GET', '/companion/bookings', N.token)).data;
for (const x of [...left.requests, ...left.upcoming]) await call('POST', `/companion/bookings/${x.id}/cancel`, N.token, { reason: 'Something else' });

// Four meet-ups with Noah on different days, each completed with the real meet code.
const days = (await call('GET', `/companions/${CID}/slots`)).data.slice(-4);
const meet = async (d) => {
  const time = d.times.find((_, i) => d.fit[i] >= 1);
  const b = (await call('POST', '/bookings', C.token, { companionId: CID, act: 'movies', date: d.date, time, dur: 1, place: 'Kino Babylon' })).data;
  await call('POST', `/companion/bookings/${b.id}/accept`, N.token);
  return b;
};
const complete = async (b) => {
  sql(`UPDATE bookings SET starts_at = unixepoch() + 3600 WHERE id = '${b.id}'`);
  const otp = (await call('GET', '/bookings', C.token)).data.find((x) => x.id === b.id).otp;
  return call('POST', `/companion/bookings/${b.id}/verify-code`, N.token, { code: otp });
};
const list = [];
for (const d of days) list.push(await meet(d));
ok(list.length === 4 && list.every((b) => b?.id), 'four bookings with Noah');
const [m1, m2, m3, m4] = list;

// 1) Not before you've met, and only the two people who met
const good = { safe: 'yes', stars: 5 };
let r = await call('POST', `/bookings/${m1.id}/feedback`, C.token, good);
ok(r.status === 409, 'no feedback before the meet-up (confirmed, not met yet)');
for (const b of list) await complete(b);
ok((await call('GET', '/bookings', C.token)).data.filter((x) => list.some((b) => b.id === x.id)).every((x) => x.status === 'completed'), 'meet codes complete all four');
r = await call('POST', `/bookings/${m1.id}/feedback`, S.token, good);
ok(r.status === 404, 'someone who wasn’t there can’t answer (404)');

// 2) Asked once after it ends, up to 3 days later; not while it's still going on
sql(`UPDATE bookings SET starts_at = unixepoch() - 3 * 3600 WHERE id IN ('${m1.id}', '${m2.id}')`);
sql(`UPDATE bookings SET starts_at = unixepoch() - 4 * 86400 WHERE id = '${m3.id}'`);
sql(`UPDATE bookings SET starts_at = unixepoch() - 600 WHERE id = '${m4.id}'`);
r = await call('POST', `/bookings/${m2.id}/feedback`, C.token, { safe: 'unsure', stars: 4, tags: ['Friendly'], note: 'He was nice, but kept checking his phone and the street.' });
ok(r.status === 201 && r.data.concern === true, '“not sure” counts as a concern for the team');
await cron();
const c1 = await asks(C.token, m1.id), n1 = await asks(N.token, m1.id);
ok(c1.length === 1 && c1[0].title === 'How did it go with Noah?' && /felt safe/.test(c1[0].body) && /Only the ZeitMit safety team/.test(c1[0].body), `the customer is asked privately (“${c1[0]?.title}”)`);
ok(n1.length === 1 && n1[0].title === 'How did it go with Mira?', `so is the companion, by first name (“${n1[0]?.title}”)`);
ok((await asks(C.token, m2.id)).length === 0 && (await asks(N.token, m2.id)).length === 1, 'whoever already answered isn’t asked again');
ok((await asks(C.token, m3.id)).length === 0 && (await asks(N.token, m3.id)).length === 0, 'nobody is asked about a meet-up that ended over 3 days ago');
ok((await asks(C.token, m4.id)).length === 0, 'nor while the meet-up is still going on');
await cron();
ok((await asks(C.token, m1.id)).length === 1 && (await asks(N.token, m1.id)).length === 1, 'the next cron run doesn’t ask twice');

// 3) What a valid answer looks like
const bad = [[{ stars: 5 }, 'no answer to “did you feel safe?”'], [{ safe: 'maybe', stars: 5 }, 'an unknown answer'], [{ safe: 'yes' }, 'no stars'],
  [{ safe: 'yes', stars: 0 }, '0 stars'], [{ safe: 'yes', stars: 6 }, '6 stars'], [{ safe: 'yes', stars: 2.5 }, 'half stars']];
for (const [body, what] of bad) {
  r = await call('POST', `/bookings/${m1.id}/feedback`, C.token, body);
  ok(r.status === 400, `refused: ${what} (${r.data?.error})`);
}
r = await call('POST', `/bookings/${m1.id}/feedback`, C.token, { safe: 'yes', stars: 5, tags: ['Respectful', 'On time', 'Respectful', 'Hacked', 42], note: '   Lovely film night.   ' });
ok(r.status === 201 && r.data.concern === false, 'felt safe with 5 stars: thanks, no concern');
r = await call('POST', `/bookings/${m1.id}/feedback`, C.token, { safe: 'no', stars: 1 });
ok(r.status === 409, 'one answer per meet-up (409)');
const mine = (await call('GET', '/bookings', C.token)).data;
ok(mine.find((x) => x.id === m1.id)?.feedback === true && mine.find((x) => x.id === m3.id)?.feedback === false, 'the customer’s bookings say which ones they answered');
const t0 = Date.now();
const before = (await call('GET', '/admin/stats', A)).data.openFeedback;
r = await call('POST', `/bookings/${m1.id}/feedback`, N.token, { safe: 'no', stars: 1, tags: ['Crossed boundaries', 'Pushy or rude'], note: 'x'.repeat(700) });
ok(r.status === 201 && r.data.concern === true, 'the companion didn’t feel safe: a concern');
const done = (await call('GET', '/companion/bookings', N.token)).data.done;
ok(done.find((x) => x.id === m1.id)?.feedback === true && done.find((x) => x.id === m3.id)?.feedback === false, 'the companion’s past bookings say which ones they answered');
ok((await call('GET', '/admin/stats', A)).data.openFeedback === before + 1, 'the admin dashboard counts one more open concern');
r = await call('POST', `/bookings/${m3.id}/feedback`, C.token, { safe: 'yes', stars: 3, tags: ['Made me uncomfortable'] });
ok(r.status === 201 && r.data.concern === true, 'a worrying tag is a concern even when they felt safe');
r = await call('POST', `/bookings/${m3.id}/feedback`, N.token, { safe: 'yes', stars: 2 });
ok(r.status === 201 && r.data.concern === true, 'so are 2 stars or fewer');
r = await call('POST', `/bookings/${m4.id}/feedback`, C.token, { safe: 'yes', stars: 4, tags: ['Friendly'] });
ok(r.status === 201 && r.data.concern === false, 'the meet-up can be rated while it’s still going on');

// 4) Only admins see it, with what others said about the same person
r = await call('GET', '/admin/feedback', C.token);
ok(r.status === 403, 'customers can’t read the feedback (403)');
const concerns = (await call('GET', '/admin/feedback', A)).data;
const all = (await call('GET', '/admin/feedback?show=all', A)).data;
const ours = (rows) => rows.filter((x) => list.some((b) => b.id === x.booking_id));
ok(ours(concerns).length === 4 && ours(concerns).every((x) => x.concern === 1), `by default the admin sees the 4 concerns (${ours(concerns).length})`);
ok(ours(all).length === 6, `and all 6 answers with “All” (${ours(all).length})`);
const red = concerns.find((x) => x.booking_id === m1.id && x.role === 'companion');
ok(red?.safe === 'no' && red.stars === 1 && !!red.from_name?.startsWith('Noah'), `didn’t feel safe, 1 star, from ${red?.from_name} about ${red?.about_name}`);
ok(red?.about_name === 'Mira Feld' && red.about_email === `feedback+${stamp}@example.com`, 'with both people’s names and emails');
ok(JSON.stringify(red?.tags) === '["Crossed boundaries","Pushy or rude"]' && red.note.length === 600, 'tags as a list, the note cut at 600 characters');
ok(red?.act === 'Movies' && /\d/.test(red.when) && red.duration_h === 1, `with the booking: ${red?.act}, ${red?.when}`);
ok(red?.about_count === 2 && red.about_stars === 1.5 && red.about_unsafe === 1, `and what everyone said about Mira: ${red?.about_count} answers, ${red?.about_stars}★, ${red?.about_unsafe} not safe`);
const mira = all.find((x) => x.booking_id === m1.id && x.role === 'customer');
ok(mira?.safe === 'yes' && mira.stars === 5 && JSON.stringify(mira.tags) === '["Respectful","On time"]' && mira.note === 'Lovely film night.', 'known tags only, no repeats, trimmed note');
ok(mira?.about_count >= 4 && mira.about_unsafe >= 0, `Noah’s line counts everything said about Noah (${mira?.about_count} answers, ${mira?.about_stars}★)`);
const firstOpen = concerns.findIndex((x) => x.status !== 'open');
ok(firstOpen === -1 || concerns.slice(firstOpen).every((x) => x.status !== 'open'), 'open concerns come first');

// 5) Reviewing a concern
r = await call('POST', `/admin/feedback/${red.id}/review`, A);
ok(r.status === 200, 'admin marks it reviewed');
ok((await call('GET', '/admin/stats', A)).data.openFeedback === before + 2, 'the open count drops by one');
const after = (await call('GET', '/admin/feedback', A)).data;
ok(after.find((x) => x.id === red.id)?.status === 'reviewed', 'it stays in the list, marked reviewed');
ok(after.findIndex((x) => x.id === red.id) > after.findIndex((x) => x.booking_id === m3.id && x.status === 'open'), 'below the open ones');
r = await call('POST', '/admin/feedback/fb_nothing/review', A);
ok(r.status === 404, 'unknown feedback: 404');
r = await call('POST', `/admin/feedback/${red.id}/review`, C.token);
ok(r.status === 403, 'only admins can review');

// 6) The team hears straight away when someone didn't feel safe (only with a mock Brevo and ADMIN_EMAILS)
if (MOCK) {
  let alert = null;
  for (let i = 0; !alert && i < 40; i++) {
    alert = (await inbox(ADMIN, t0)).find((m) => /^Safety feedback: /.test(m.subject));
    if (!alert) await new Promise((res) => setTimeout(res, 150));
  }
  ok(alert?.subject === 'Safety feedback: Noah didn’t feel safe with Mira', `the team gets an email: “${alert?.subject}”`);
  ok(/Respect: 1\/5 · Crossed boundaries, Pushy or rude/.test(alert?.text ?? '') && alert.text.includes(m1.id) && alert.text.includes(`feedback+${stamp}@example.com`), 'with the stars, tags, booking and both emails');
  ok((await inbox(ADMIN, t0)).filter((m) => /^Safety feedback: /.test(m.subject)).length === 1, 'only for the serious one (not for “not sure”, 2 stars or a tag)');
} else console.log('  (no mock Brevo given: skipping the alert email check)');

// 7) Deleting an account removes what they said and what was said about them
r = await call('DELETE', `/admin/users/${C.user.id}?force=1`, A);
ok(r.status === 200, `admin deletes Mira’s account (${r.status} ${r.data?.error ?? ''})`);
ok(count(`SELECT COUNT(*) AS n FROM meet_feedback WHERE from_id = '${C.user.id}' OR about_id = '${C.user.id}' OR booking_id IN ('${list.map((b) => b.id).join("','")}')`) === 0, 'their feedback is gone, both ways');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
