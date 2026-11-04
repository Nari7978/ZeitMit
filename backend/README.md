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
node scripts/slots.mjs         # open times: lengths, every kind of cancellation, live updates; edits the local DB
node scripts/reschedule.mjs    # moving bookings and the customer profile companions see; edits the local DB
node scripts/feedback.mjs      # private safety feedback after meet-ups and the admin list; edits the local DB
node scripts/custom-dates.mjs  # companions' own hours for specific dates and days off; edits the local DB
node scripts/meet-code.mjs     # meet codes can't be sent in chat (also checks the app's copy of the check); edits the local DB
```
`scripts/stripe-flow.mjs` checks every payment path against a mock Stripe: run the API with
`npx wrangler dev --var STRIPE_SECRET_KEY:sk_test_mock --var STRIPE_API_BASE:http://localhost:9999`.
`scripts/emails.mjs` checks the invoice and confirmation emails against a mock Brevo (it records what it's asked to send): run the API with
`npx wrangler dev --port 8789 --var BREVO_API_KEY:test --var EMAIL_FROM_ADDRESS:hello@zeitmit.app --var BREVO_API_BASE:http://localhost:9998`.
Add `--var ADMIN_EMAILS:safety@example.com` and run `node scripts/feedback.mjs http://localhost:8789 http://localhost:9998 safety@example.com` to also check the safety team's alert email.

## Test-mode features
- **`DEV_LOGIN_CODES = "true"`**: login codes come back in the API response instead of by email, and admin access is disabled. The deploy workflow switches this off once `BREVO_API_KEY` and `EMAIL_FROM_ADDRESS` are set.
- **Payments:** without `STRIPE_SECRET_KEY`, bookings and gifts are marked paid without charging anyone. With a Stripe test key they go through Stripe Checkout (bookings are authorised, captured with the meet code or a late cancellation, released otherwise).
- **Demo companions:** `migrations/0002_seed_demo.sql` adds eight sample companions (logins `<name>@demo.zeitmit.app`) and `0006_remove_demo_companions.sql` removes them again, so the live app starts empty. For local testing add them back with `npm run seed:demo:local` (the smoke test needs them).
- **Safety:** the trusted contact gets a private live page (`/t/<token>`) over WhatsApp, sent from the user's phone; SOS and missed check-ins email and push the admins. There is no automatic SMS.

## Booking rules
- Open times (`GET /companions/:id/slots`) are the companion's weekly windows minus bookings, at least an hour ahead. Each time comes with `fit`, the longest booking that fits before the next one and before midnight; a longer request is refused. Bookings last `MIN_HOURS` (1) to `MAX_HOURS` (8) hours in half-hour steps and are priced by the hour (rate × hours, plus the 10% fee).
- Companions can set their own hours for a specific date, up to `CUSTOM_DAYS_AHEAD` (60) days ahead: `PUT /companion/dates/:date` with `{ ranges: [['18:00', '23:00'], …] }` (up to 3 ranges in half hours from 06:00 to `24:00`, each at least an hour, not overlapping), or `{ ranges: [] }` for a day off. That date's hours replace the weekly windows: start times are every half hour within them (the day comes with `custom: true`) and a booking ends by its range's end. Bookings already made that day stay (the answer's `kept` says how many). `DELETE /companion/dates/:date` goes back to the weekly windows; `GET /companion` lists the dates. Customers still book up to 7 days ahead, and the list's "available today" and open days (`GET /companions`) follow the dates too.
- The meeting place is optional: when it's left empty the two agree on it in the chat, and the check-in page and alerts say it isn't set. Requests, confirmed bookings and meet-ups under way block their time; any cancellation frees it at once.
- While someone is on Stripe Checkout their time is held for others. Leaving checkout releases it straight away (`POST /bookings/:id/release` closes the checkout page first, so it can't be paid later); trying again with other details replaces your own open checkout. Abandoned ones expire after 35 minutes. If two people book the same time at the same moment, the first one saved keeps it.
- Live updates go over WebSockets (`?token=`), through the chat Durable Object: `/live/slots/:id` sends a companion's new open times whenever they change, and `/live` tells your open app to reload when something changes for you (every notification does).
- Either side can move a booking to another open time of the same length. The customer moves a request the companion hasn't answered straight away; otherwise it's a suggestion the other side accepts or declines, and until then the booking keeps its time while the suggested one is held for others (a companion's suggestion on a request also confirms it once accepted). Customers can change a confirmed booking up to 24 hours before; a booking moves at most `MAX_RESCHEDULES` (3) times.
- A companion application needs a profile photo plus `GALLERY_MIN` (3) to `GALLERY_MAX` (6) more photos (`kind: 'gallery'` uploads), shown as slides on the profile. `PUT /companion/gallery` (`{ ids }`, in order) replaces them later; once a listing has 3 it can't drop below 3, and removed photos are deleted.
- Companions see the profile of whoever booked them (name, photo, optional age, gender, languages, interests, About, ID-verified badge, meet-ups so far), never their email, phone or documents.
- Each paid booking has its own chat thread, open while the booking is pending or confirmed. It ends for both sides when the meet code is entered or the booking is cancelled.
- Meet codes never go through chat: entering one is what proves the two met and releases the payment, so it's shown in person only. A message containing the code of one of the pair's open bookings is refused (`400`, `code: 'meet_code'`), however it's written: spaced out, with symbols or emoji between the digits, as number words (English or German), or split over the sender's last 3 messages in 15 minutes. Times and dates ("18:30", "28.11.") are left alone, and new codes never look like one (`src/lib/meetCode.ts`; the app runs the same check before sending, `mobile/src/lib/meetCode.ts`).
- Customers cancel for free until `FREE_CANCEL_HOURS` (24) before the start; later the booking is cancelled without a refund and the companion keeps their pay. Companions can cancel any time before the meeting; the customer always gets everything back. Support can refund any booking from the admin panel.

## Emails
- After every payment (a booking or a gift card) the customer gets an invoice: numbered `ZM-<year>-<seq>` in one unbroken sequence, with the line items, the 10% fee and how it was paid (gift credit, card). Each number is stored once in `invoices` and kept when accounts are deleted, so an invoice is never sent twice.
- Seller details on invoices (legal name, address, tax number or VAT ID) come from `INVOICE_DETAILS`, one per line or split by `|`: set the repository variable of that name (Settings → Secrets and variables → Actions → Variables) and the deploy passes it on.
- When a booking is confirmed (the companion accepts, or the customer accepts the companion's suggested time), both sides get a confirmation with an `.ics` calendar file. If a confirmed booking moves, it's sent again with the new time; the calendar entry keeps its UID with a higher `SEQUENCE`, so calendars update it. The meet code is never emailed.
- Emails follow the person's language setting; on "automatic" they use the language the app last reported showing (`PATCH /me { uiLanguage }`). Without email configured (local development) nothing is sent, but invoice numbers are still given out.

## Safety feedback after meet-ups
- Once a meet-up has ended (its meet code was entered and its time is over), the cron asks both sides privately how it went, once, up to 3 days after the end: a notification and push that opens the form (`go: "feedback:<booking id>"`). The app also shows it on the completed booking and on Discover (customers), on the Overview and in the booking history (companions), and opens the form by itself once per meet-up on the home screen, up to 3 days after it ended.
- `POST /bookings/:id/feedback` with `{ safe: 'yes' | 'unsure' | 'no', stars: 1–5, tags?, note? }`: whether they felt safe, how respectful the other person was, optional tags (the lists are `FEEDBACK_GOOD` and `FEEDBACK_CONCERNS` in `src/types.ts`; others are dropped) and a note of up to 600 characters. One answer per person per booking, only by the two people who met.
- The other person never sees it. It's a concern when they didn't feel safe or weren't sure, gave 2 stars or fewer, or picked a worrying tag. Didn't feel safe, 1 star or "Crossed boundaries" also emails and notifies the admins (`ADMIN_EMAILS`) straight away.
- Admins see it under Safety feedback: concerns first (open, then reviewed), everything with "All answers", each with what everyone said about the same person (answers, average stars, how many didn't feel safe), and can mark it reviewed or suspend the person. Customers can still leave a public review afterwards; the two are separate.
- Deleting an account deletes the feedback they gave and the feedback about them.

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
| Customer bookings | `GET/POST /bookings`, `POST /bookings/:id/confirm-payment·release·cancel·review` |
| After a meet-up (either side) | `POST /bookings/:id/feedback` (private, for the safety team) |
| Moving a booking (either side) | `GET/POST/DELETE /bookings/:id/reschedule`, `POST /bookings/:id/reschedule/accept` |
| Companion | `GET/PATCH /companion`, `POST /companion/apply`, `PUT /companion/gallery`, `PUT /companion/availability`, `PUT/DELETE /companion/dates/:date`, `GET /companion/customers/:id`, `GET /companion/bookings` (requests, upcoming, the latest 100 meet-ups as `done`, and `history`: those plus the latest 60 cancellations, newest first), `POST /companion/bookings/:id/accept·decline·cancel·verify-code` |
| Payouts | `GET/POST /companion/payouts`, `PUT /companion/payouts/account` |
| Chat | `GET /conversations`, `POST /conversations` (`{ bookingId }` or `{ companionId }`), `GET/POST /conversations/:id/messages`, `GET /conversations/:id/ws` (WebSocket, `?token=`) |
| Live | `GET /live` (your updates), `GET /live/slots/:id` (a companion's open times); WebSockets, `?token=` |
| Safety & gifts | `POST /safety/checkins`, `GET /safety/checkins/active`, `POST /safety/checkins/:id/ok·end·sos·location`, `GET /t/:token` (live page), `POST /gifts`, `POST /gifts/redeem` |
| Admin | `/admin/stats`, `/admin/verifications`, `/admin/companions`, `/admin/bookings` (+ refund), `/admin/payouts` (+ paid, reject), `/admin/reports`, `/admin/feedback` (+ review), `/admin/reviews`, `/admin/users` (+ suspend, delete) |
