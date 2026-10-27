import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv, Env } from './types';
import { requireAdmin, requireAuth } from './lib/auth';
import { auth } from './routes/auth';
import { me } from './routes/me';
import { companions } from './routes/companions';
import { bookings, companionBookings, expirePending } from './routes/bookings';
import { companionProfile } from './routes/companionProfile';
import { escalateMissedCheckins, gifts, safety } from './routes/safety';
import { admin } from './routes/admin';
import { chat } from './chat';

export { ChatRoom } from './chat';

const app = new Hono<AppEnv>();

app.use('*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type'], allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'] }));

app.get('/', (c) => c.json({ name: 'zeitmit-api', ok: true, devLoginCodes: c.env.DEV_LOGIN_CODES === 'true' }));

app.route('/auth', auth);
app.route('/companions', companions);

app.use('/me/*', requireAuth);
app.use('/me', requireAuth);
app.route('/me', me);

app.use('/bookings/*', requireAuth);
app.use('/bookings', requireAuth);
app.route('/bookings', bookings);

app.use('/companion/*', requireAuth);
app.use('/companion', requireAuth);
app.route('/companion/bookings', companionBookings);
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
    ctx.waitUntil(Promise.all([expirePending(env), escalateMissedCheckins(env)]));
  },
} satisfies ExportedHandler<Env>;
