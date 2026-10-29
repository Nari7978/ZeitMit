import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv, Env } from './types';
import { requireAdmin, requireAuth } from './lib/auth';
import { auth } from './routes/auth';
import { me } from './routes/me';
import { companions } from './routes/companions';
import { bookings, companionBookings, expirePending, expireUnpaid } from './routes/bookings';
import { companionProfile } from './routes/companionProfile';
import { endOldCheckins, escalateMissedCheckins, gifts, liveCheckin, safety } from './routes/safety';
import { livePage, notFoundPage, pickLang } from './livePage';
import { admin } from './routes/admin';
import { chat } from './chat';
import { photos } from './routes/photos';
import { payouts } from './routes/payouts';
import { stripeOn } from './lib/stripe';

export { ChatRoom } from './chat';

const app = new Hono<AppEnv>();

app.use('*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type'], allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'] }));

app.get('/', (c) => c.json({ name: 'zeitmit-api', ok: true, devLoginCodes: c.env.DEV_LOGIN_CODES === 'true', payments: stripeOn(c.env), email: !!(c.env.BREVO_API_KEY || c.env.RESEND_API_KEY) }));

app.route('/auth', auth);
app.route('/companions', companions);
app.route('/photos', photos);

/** Stripe Checkout lands here, then hands control back to the app via its URL scheme. */
app.get('/payments/return', (c) => {
  const q = new URLSearchParams({ kind: c.req.query('kind') ?? '', id: c.req.query('id') ?? '', status: c.req.query('status') ?? '' });
  const deep = `zeitmit://payment-done?${q}`;
  const ok = c.req.query('status') === 'success';
  return c.html(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>ZeitMit</title>
<body style="font-family:system-ui;background:#FFE94D;color:#111;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px">
<div><h1 style="font-size:28px">${ok ? 'Payment done' : 'Payment cancelled'}</h1><p>Returning to ZeitMit…</p>
<p><a href="${deep}" style="color:#111;font-weight:700">Tap here if nothing happens</a></p></div>
<script>location.href=${JSON.stringify(deep)}</script></body>`);
});

/** Live safety page for a trusted contact (private link from WhatsApp, no login). */
app.get('/t/:token', async (c) => {
  const lang = pickLang(c.req.header('Accept-Language'));
  const live = await liveCheckin(c.env, c.req.param('token'));
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Robots-Tag', 'noindex');
  if (!live) return c.html(notFoundPage(lang), 404);
  return c.html(livePage(live, lang));
});

app.use('/me/*', requireAuth);
app.use('/me', requireAuth);
app.route('/me', me);

app.use('/bookings/*', requireAuth);
app.use('/bookings', requireAuth);
app.route('/bookings', bookings);

app.use('/companion/*', requireAuth);
app.use('/companion', requireAuth);
app.route('/companion/bookings', companionBookings);
app.route('/companion/payouts', payouts);
app.route('/companion', companionProfile);

app.use('/conversations/*', requireAuth);
app.use('/conversations', requireAuth);
app.route('/conversations', chat);

app.use('/safety/*', requireAuth);
app.route('/safety', safety);

app.use('/gifts/*', requireAuth);
app.use('/gifts', requireAuth);
app.route('/gifts', gifts);

app.use('/admin/*', requireAuth, requireAdmin);
app.route('/admin', admin);

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  if (err instanceof SyntaxError) return c.json({ error: 'Invalid JSON body.' }, 400);
  console.error(err);
  return c.json({ error: 'Something went wrong. Please try again.' }, 500);
});

app.notFound((c) => c.json({ error: 'Not found.' }, 404));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.all([expirePending(env), expireUnpaid(env), escalateMissedCheckins(env), endOldCheckins(env)]));
  },
} satisfies ExportedHandler<Env>;
