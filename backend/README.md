# ZeitMit API

Cloudflare Workers backend for the ZeitMit app, using only free-plan services.

| Piece | Cloudflare service |
| --- | --- |
| REST API (Hono) | Workers (`src/index.ts`) |
| Database | D1 (`migrations/`) |
| Realtime chat + typing | Durable Objects + WebSockets (`src/chat.ts`) |
| Expire unanswered requests, missed check-in alerts | Cron Trigger every 10 min |
| Push notifications | Expo Push (no key needed) |

## Deploys
Every push that changes `backend/` runs `.github/workflows/backend.yml`, which creates the D1 database on first run, applies migrations, deploys the Worker and generates `JWT_SECRET`. It needs two GitHub Actions secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## Local development
```bash
cd backend
npm install
echo 'JWT_SECRET=local-dev-secret' > .dev.vars
npm run db:migrate:local
npm run dev                    # http://localhost:8787
node scripts/smoke.mjs         # end-to-end checks against the local API
```

## Test-mode features (switch off before real users)
- **`DEV_LOGIN_CODES = "true"`** in `wrangler.toml`: login codes come back in the API response instead of by email, and admin access is disabled. Add a free [Resend](https://resend.com) key (`npx wrangler secret put RESEND_API_KEY`) and set it to `"false"` to go live.
- **Payments are simulated:** bookings are marked "held" without charging anyone. Places to wire in Stripe are marked `TODO(payments)`.
- **Demo companions:** `migrations/0002_seed_demo.sql` adds the eight sample companions (logins `<name>@demo.zeitmit.app`).
- **Safety SMS:** missed check-ins and SOS raise in-app alerts and show in the admin API; texting the trusted contact is `TODO(sms)`.

## API overview
| Area | Endpoints |
| --- | --- |
| Login | `POST /auth/request-code`, `POST /auth/verify` |
| Me | `GET/PATCH/DELETE /me`, `PUT/DELETE /me/saved/:cid`, `GET /me/notifications`, `POST /me/notifications/read`, `POST /me/reports`, `POST /me/blocks` |
| Browse | `GET /companions`, `GET /companions/:id`, `GET /companions/:id/slots` |
| Customer bookings | `GET/POST /bookings`, `POST /bookings/:id/cancel`, `POST /bookings/:id/review` |
| Companion | `GET/PATCH /companion`, `POST /companion/apply`, `PUT /companion/availability`, `GET /companion/bookings`, `POST /companion/bookings/:id/accept·decline·verify-code` |
| Chat | `GET/POST /conversations`, `GET/POST /conversations/:id/messages`, `GET /conversations/:id/ws` (WebSocket, `?token=`) |
| Safety & gifts | `POST /safety/checkins`, `POST /safety/checkins/:id/ok·end·sos`, `POST /gifts` |
| Admin | `/admin/stats`, `/admin/companions`, `/admin/bookings`, `/admin/reports`, `/admin/users` |
