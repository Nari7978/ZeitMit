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
echo 'JWT_SECRET=local-dev-secret-change-me' > .dev.vars   # the test scripts sign admin sessions with this
npm run db:migrate:local
npm run seed:demo:local        # the eight demo companions the tests book
npm run dev                    # http://localhost:8787
node scripts/smoke.mjs         # end-to-end checks against the local API
node scripts/local-flows.mjs   # time-dependent flows (meet code, late cancel); edits the local DB
```
`scripts/stripe-flow.mjs` checks every payment path against a mock Stripe: run the API with
`npx wrangler dev --var STRIPE_SECRET_KEY:sk_test_mock --var STRIPE_API_BASE:http://localhost:9999`.

## Test-mode features
- **`DEV_LOGIN_CODES = "true"`**: login codes come back in the API response instead of by email, and admin access is disabled. The deploy workflow switches this off once `BREVO_API_KEY` and `EMAIL_FROM_ADDRESS` are set.
- **Payments:** without `STRIPE_SECRET_KEY`, bookings and gifts are marked paid without charging anyone. With a Stripe test key they go through Stripe Checkout (bookings are authorised, captured with the meet code or a late cancellation, released otherwise).
- **Demo companions:** `migrations/0002_seed_demo.sql` adds eight sample companions (logins `<name>@demo.zeitmit.app`) and `0006_remove_demo_companions.sql` removes them again, so the live app starts empty. For local testing add them back with `npm run seed:demo:local` (the smoke test needs them).
- **Safety:** the trusted contact gets a private live page (`/t/<token>`) over WhatsApp, sent from the user's phone; SOS and missed check-ins email and push the admins. There is no automatic SMS.

## Booking rules
- Each paid booking has its own chat thread, open while the booking is pending or confirmed. It ends for both sides when the meet code is entered or the booking is cancelled.
- Customers cancel for free until `FREE_CANCEL_HOURS` (24) before the start; later the booking is cancelled without a refund and the companion keeps their pay. Companions can cancel any time before the meeting; the customer always gets everything back. Support can refund any booking from the admin panel.

## Payouts (sent by hand)
- A booking's money is earned when the meet code is entered (or the customer cancels late). It becomes withdrawable `PAYOUT_HOLD_DAYS` (2) days later, so there's time for complaints and refunds.
- Companions save a bank account (IBAN checked) and request their whole available balance, from `PAYOUT_MIN` (€20). One request can be open at a time, and the bank account is locked while it is.
- Admins see requests under Payouts with the full IBAN, send a SEPA transfer from the business account, then mark it as paid (optionally with the reference) or reject it with a reason. Companions are notified either way; a rejected amount goes back to their balance.
- A refund after a payout is deducted from the companion's next earnings (the balance can go negative). Removing a listing keeps earnings and history; deleting an account that's still owed money needs a confirmation.

## API overview
| Area | Endpoints |
| --- | --- |
| Login | `POST /auth/request-code`, `POST /auth/verify` |
| Me | `GET/PATCH/DELETE /me`, `PUT/DELETE /me/saved/:cid`, `GET /me/notifications`, `POST /me/notifications/read`, `POST /me/reports`, `POST /me/blocks` |
| Browse | `GET /companions`, `GET /companions/:id`, `GET /companions/:id/slots` |
| Customer bookings | `GET/POST /bookings`, `POST /bookings/:id/confirm-payment·cancel·review` |
| Companion | `GET/PATCH /companion`, `POST /companion/apply`, `PUT /companion/availability`, `GET /companion/bookings`, `POST /companion/bookings/:id/accept·decline·cancel·verify-code` |
| Payouts | `GET/POST /companion/payouts`, `PUT /companion/payouts/account` |
| Chat | `GET /conversations`, `POST /conversations` (`{ bookingId }` or `{ companionId }`), `GET/POST /conversations/:id/messages`, `GET /conversations/:id/ws` (WebSocket, `?token=`) |
| Safety & gifts | `POST /safety/checkins`, `GET /safety/checkins/active`, `POST /safety/checkins/:id/ok·end·sos·location`, `GET /t/:token` (live page), `POST /gifts`, `POST /gifts/redeem` |
| Admin | `/admin/stats`, `/admin/verifications`, `/admin/companions`, `/admin/bookings` (+ refund), `/admin/payouts` (+ paid, reject), `/admin/reports`, `/admin/reviews`, `/admin/users` (+ suspend, delete) |
