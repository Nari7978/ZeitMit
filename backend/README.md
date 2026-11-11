# ZeitMit API

Cloudflare Workers backend for the ZeitMit app, using only free-plan services.

| Piece | Cloudflare service |
| --- | --- |
| REST API (Hono) | Workers (`src/index.ts`) |
| Database | D1 (`migrations/`) |
| Realtime chat + typing | Durable Objects + WebSockets (`src/chat.ts`) |
| Expire unanswered requests, missed check-in alerts | Cron Trigger every 10 min |
| Booking engine: hours, free time, time zones | `src/lib/hours.ts`, `src/lib/time.ts` |
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
node scripts/slots.mjs         # free times: lengths, every kind of cancellation, live updates; edits the local DB
node scripts/reschedule.mjs    # moving bookings and the customer profile companions see; edits the local DB
node scripts/feedback.mjs      # private safety feedback after meet-ups and the admin list; edits the local DB
node scripts/custom-dates.mjs  # own hours for dates, days off, hours past midnight, blocked time; edits the local DB
node scripts/meet-code.mjs     # meet codes can't be sent in chat (also checks the app's copy of the check); edits the local DB
node scripts/video.mjs         # video dates: joining, ringing and pings, the call room, settling by who was there, no-shows (API: see below)
node scripts/next-free.mjs     # 15-minute starts; an accepted booking moves everyone's next free time to where it ends; edits the local DB
node scripts/kinds.mjs         # in person and video on one calendar: kinds per range, one clock, the same deadlines; edits the local DB
node scripts/availability.mjs  # the booking rules end to end: simultaneous accepts, deadlines, expiry, statuses, admin; edits the local DB
npm run test:engine            # the time engine without an API: daylight saving, exact deadlines, past midnight, other zones
```
`scripts/video.mjs` needs short timings and gets the pushes itself: run the API with
`npx wrangler dev --var CALL_WAIT_SECONDS:3 --var CALL_PAY_STEP_SECONDS:1 --var CALL_PING_GAP_SECONDS:2 --var EXPO_PUSH_URL:http://localhost:8798/push`.
`scripts/stripe-flow.mjs` checks every payment path against a mock Stripe: run the API with
`npx wrangler dev --var STRIPE_SECRET_KEY:sk_test_mock --var STRIPE_API_BASE:http://localhost:9999`.
`scripts/emails.mjs` checks the invoice and confirmation emails against a mock Brevo (it records what it's asked to send): run the API with
`npx wrangler dev --port 8789 --var BREVO_API_KEY:test --var EMAIL_FROM_ADDRESS:hello@zeitmit.app --var BREVO_API_BASE:http://localhost:9998`.
Add `--var ADMIN_EMAILS:safety@example.com` and run `node scripts/feedback.mjs http://localhost:8789 http://localhost:9998 safety@example.com` to also check the safety team's alert email.

## Test-mode features
- **`DEV_LOGIN_CODES = "true"`**: login codes come back in the API response instead of by email, and admin access is disabled. The deploy workflow switches this off once `BREVO_API_KEY` and `EMAIL_FROM_ADDRESS` are set.
- **Payments:** without `STRIPE_SECRET_KEY`, bookings and gifts are marked paid without charging anyone. With a Stripe test key they go through Stripe Checkout (bookings are authorised, captured with the meet code, a late cancellation or the end of a video date, in part when only some of it is owed, and released otherwise).
- **Demo companions:** `migrations/0002_seed_demo.sql` adds eight sample companions (logins `<name>@demo.zeitmit.app`) and `0006_remove_demo_companions.sql` removes them again, so the live app starts empty. For local testing add them back with `npm run seed:demo:local` (the smoke test needs them).
- **Safety:** the trusted contact gets a private live page (`/t/<token>`) over WhatsApp, sent from the user's phone; SOS and missed check-ins email and push the admins. There is no automatic SMS.

## Booking rules
- **Every booking is a request.** In-person dates and video dates (activity `call`) work the same way: the customer pays (the money is held), the companion accepts or declines, and only an accepted booking takes their time. Requests and suggested new times hold nothing, so several customers can ask for overlapping times; when the companion accepts one, every other request overlapping it ends as `conflicted`, refunded in full, and its customer is told.
- **Statuses** (a `CHECK` in the database; `src/routes/bookings.ts` says which change can follow which): `pending` (waiting for the companion), `confirmed`, `rejected` (declined), `expired` (no answer in time), `conflicted` (someone else was confirmed for that time), `cancelled` (by either side), `completed` (they met: meet code entered, or a video date settled after its end). App versions from before these statuses (requests without the `X-ZeitMit-Api: 3` header) see `rejected`, `expired` and `conflicted` as `cancelled`.
- **Times:** any start in 15-minute steps (`STEP_MIN`), from 3½ hours ahead (`LEAD_S`) up to 7 days ahead (`HORIZON_S`). Lengths go in 15-minute steps too: video from 30 minutes, in person from an hour (`MIN_MINUTES`), both up to 8 hours (`MAX_MINUTES`). The end is the start plus the length (`ends_at`), past midnight if need be. The price is per minute: rate × minutes ÷ 60, plus the 10% fee.
- **Accepting:** within 24 hours of the request (`EXPIRE_AFTER_S`) and at least 3 hours before the start (`ACCEPT_BEFORE_S`), so the deadline is `expires_at = min(created + 24 h, start − 3 h)` (`expiresAt` on each request). Exactly at the deadline still works, a second later doesn't. After it, the request ends as `expired` and is refunded: by the cron every 10 minutes, by every bookings list that's opened, and by a late accept. A request the companion answered with another time waits for the customer's answer instead.
- **One clock, no double booking:** a confirmed booking of either kind takes the time for both. Accepting is one database statement that confirms the request only if it's still pending, paid and before its deadline, and no confirmed booking overlaps it (`start < other end AND end > other start`). So of two overlapping requests accepted at the same moment only one can succeed; the other becomes `conflicted`. The app only offers free times, but the server checks every request again.
- **Hours** (`hours_week`, `hours_days`, `hours_blocks`), in the companion's time zone: weekly hours per weekday and own hours for specific dates up to 60 days ahead, each as up to 6 ranges in 15-minute steps, at least 30 minutes each. An end at or before the start runs into the next day (22:00–02:00 belongs to the day it starts). Each range is open for both kinds (the default), in person only or video only. A date's own hours replace that weekday's; `[]` is a day off. Blocks (unix times) close time whatever the hours say, until they're removed: a break, extended or shortened later, or a night off. Nothing reopens by itself: a cancelled booking frees its time only where the hours are open and nothing is blocked. Changing hours or blocking time keeps the bookings already there (`kept` says how many).
- **Time zones:** moments are stored as unix seconds (UTC). Hours follow the companion's zone (`companions.timezone`, `Europe/Berlin` by default); customers see times in their own zone (`users.timezone`, which the app reports), with the companion's zone named when it differs. On daylight-saving days a clock time that doesn't exist (02:30 when the clocks jump forward) can't be booked, and one that happens twice is labelled CET or CEST.
- `GET /companions/:id/availability` gives the companion's zone, the earliest and latest start, the step and, for each kind offered, the shortest and longest booking and the free intervals (unix): their hours minus blocks minus confirmed bookings. `GET /companions` gives each companion's next free start per kind (`free.meet`, `free.video`, null when not offered), `today` and the weekdays with free starts; `next`, `today` and `days` at the top level count either kind. They're for "Next free" on cards and the today / tomorrow / weekend / soonest filters. Live updates carry the same `availability` whenever it changes.
- Older app versions keep working on the same calendar: `GET /companions/:id/slots` and `/times` give half-hour starts in the companion's zone with the longest booking that fits (`fit`), bookings sent as `{ date, time, dur }` in that zone are accepted, and their controls (`PUT /companion/availability` for the fixed morning, afternoon and evening windows, `PUT/DELETE /companion/dates/:date`, both with an optional `kind`) edit the new hours.
- The meeting place is optional: when it's left empty the two agree on it in the chat, and the check-in page and alerts say it isn't set.
- With Stripe on, a request is sent once its checkout is paid. Unfinished checkouts hold no time; if someone else was confirmed for that time meanwhile, the paid request ends as `conflicted` and is refunded at once. Leaving checkout closes it (`POST /bookings/:id/release`, so it can't be paid later), trying again replaces your own open checkout, and abandoned ones are dropped after 35 minutes.
- Live updates go over WebSockets (`?token=`), through the chat Durable Object: `/live/slots/:id` sends a companion's new free times whenever they change, and `/live` tells your open app to reload when something changes for you (every notification does).
- Either side can move a booking to another free time of the same length, under the same rules. The customer moves a request the companion hasn't answered straight away (its deadline follows the new time); otherwise it's a suggestion the other side accepts or declines, and until then the booking keeps its time. A suggestion holds no time and has to be accepted at least 3 hours before the new start (the cron drops it after that). A companion's suggestion on a request also confirms it once accepted. Customers can change a confirmed booking up to 24 hours before; a booking moves at most `MAX_RESCHEDULES` (3) times.
- A companion application needs a profile photo plus `GALLERY_MIN` (3) to `GALLERY_MAX` (6) more photos (`kind: 'gallery'` uploads), shown as slides on the profile. `PUT /companion/gallery` (`{ ids }`, in order) replaces them later; once a listing has 3 it can't drop below 3, and removed photos are deleted.
- Companions see the profile of whoever booked them (name, photo, optional age, gender, languages, interests, About, ID-verified badge, meet-ups so far), never their email, phone or documents.
- Each paid booking has its own chat thread, open while the booking is pending or confirmed. It ends for both sides when the meet code is entered or the booking is cancelled.
- Meet codes never go through chat: entering one is what proves the two met and releases the payment, so it's shown in person only. A message containing the code of one of the pair's open bookings is refused (`400`, `code: 'meet_code'`), however it's written: spaced out, with symbols or emoji between the digits, as number words (English or German), or split over the sender's last 3 messages in 15 minutes. Times and dates ("18:30", "28.11.") are left alone, and new codes never look like one (`src/lib/meetCode.ts`; the app runs the same check before sending, `mobile/src/lib/meetCode.ts`).
- **ZeitMit's 10% fee is kept once the companion has accepted**, whatever happens after. A request that's declined, expires, loses its time or is cancelled before it's accepted is refunded in full.
- Customers cancel a request any time (full refund), and a confirmed booking until `FREE_CANCEL_HOURS` (24) before the start for everything but the fee (`freeUntil` on each confirmed booking); later the booking is cancelled without a refund and the companion keeps their pay. Companions can decline a request (full refund) or cancel a booking any time before the meeting (the customer gets everything but the fee back). Support can refund or cancel any booking from the admin panel, in full, which also lists any overlapping confirmed bookings, conflicted requests and requests past their deadline (`GET /admin/bookings/conflicts`).
- Amounts on a booking: `total` stays the price; `refunded` is what went back to the customer (so they paid `total - refunded`), `subtotal` what the companion earned once it's settled, and `fee` ZeitMit's part. Gift credit pays first and comes back last. With Stripe, keeping only part of a hold captures that amount (`amount_to_capture`) and releases the rest.

## Video dates
- A video date (activity `call`) happens in the app. The video goes straight between the two phones (WebRTC); nothing is recorded and no video passes through the server. One `CallRoom` Durable Object per booking passes the call setup between them (offer, answer, network candidates), notes when each side comes and goes and counts the seconds both have video connected.
- `POST /calls/:bookingId` returns who the call is with, when it ends and the ICE servers; `GET /calls/:bookingId/ws?token=` is the room's socket. Only the two people booked, on a confirmed paid video date (a request has no call until it's accepted), from 10 minutes before the start until the booked end, when the room ends the call.
- Video dates have their own boundaries, since nothing physical happens on a call: companions pick what they're comfortable with from `VIDEO_BOUNDARY_OPTIONS` (flirting, pet names, …; `companions.video_boundaries`, `okVideo` in the API) and the profile shows `VIDEO_NEVER_OFFERED` (`noVideo`) beside them. Dates in person keep `BOUNDARY_OPTIONS` (`ok`) and `NEVER_OFFERED` (`no`). Customers agree to the ones for the kind of date they book.
- Video dates have no meet code, meeting place or check-in. Either side can leave and rejoin until the booked end, when the room ends the call and settles the payment once (`call_closed`) from who was there (`src/lib/videoDate.ts`, tested by `npm run test:engine`):
  - The companion earns the booked time minus any time the customer was in the call and they weren't (late, left early, dropped out), counted in whole minutes (`CALL_PAY_STEP_SECONDS`, 60) in the companion's favour; the customer gets that part back (`billed_minutes` says how many minutes were paid). The customer being late, leaving early or not coming costs the companion nothing.
  - Whoever has waited `CALL_WAIT_SECONDS` (300) alone for the other, counted from the booked start, can leave without losing anything, even if the other comes back later. If the last one in leaves without waiting that long, the one who left first carries the time until they're together again.
  - The companion never joined, or earned nothing → everything but the fee back, `cancelled`; the customer never joined → the companion keeps their pay, `cancelled`; both were in the call but the video never connected → everything but the fee back, `cancelled`. Otherwise `completed`, in full or in part. Both sides are told what happened and what it cost.
  - The cron settles video dates whose room didn't (nobody joined, or the room missed its wake-up), asking the room for its record first. If Stripe refuses to settle, the payment stays held and admins get an alert.
- **Ringing:** whenever someone is in the call alone, the other person's phone rings: when they join (but not again for a reconnect within 2 minutes) and when they press Ping (`POST /calls/:id/ping`: from the booked start, only while you're in the call and the other person isn't, every `CALL_PING_GAP_SECONDS` (30), at most 10 times per video date; the room's `hello` says when the next ping can go out, `pingIn` and `pingsLeft`). A ring is one notification per call that each ring replaces (`go: "call:<booking id>"` opens the call), a live `ring` event that makes the open app show the call with vibration, and a high-priority push with sound. Rings are sent whatever the booking-update push setting says, since they're the call itself and only happen while it's on. When the one who rang hangs up before the other came, a live `ring-off` stops the ringing.
- Connecting: free public STUN servers by default, which is enough for most networks. For networks that block direct connections, add a free Cloudflare TURN relay (1,000 GB a month free): create a TURN key in the Cloudflare dashboard (Realtime → TURN) and add the repository secrets `TURN_KEY_ID` and `TURN_KEY_API_TOKEN`. The deploy stores them as Worker secrets and the server hands out short-lived relay credentials.

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
| Me | `GET/PATCH/DELETE /me` (incl. `timezone`), `PUT/DELETE /me/saved/:cid`, `GET /me/notifications`, `POST /me/notifications/read`, `POST /me/reports`, `POST /me/blocks` |
| Browse | `GET /companions`, `GET /companions/:id`, `GET /companions/:id/availability` (older apps: `/slots`, `/times`) |
| Customer bookings | `GET/POST /bookings` (`{ companionId, act, startsAt, minutes, place }`), `POST /bookings/:id/confirm-payment·release·cancel·review` |
| After a meet-up (either side) | `POST /bookings/:id/feedback` (private, for the safety team) |
| Video dates (either side) | `POST /calls/:id`, `GET /calls/:id/ws`, `POST /calls/:id/ping` |
| Moving a booking (either side) | `GET/POST/DELETE /bookings/:id/reschedule`, `POST /bookings/:id/reschedule/accept` |
| Companion | `GET/PATCH /companion` (incl. `timezone`, `week`, `days`, `blocks`), `POST /companion/apply`, `PUT /companion/gallery`, `PUT /companion/hours/week`, `PUT/DELETE /companion/hours/days/:date`, `POST /companion/hours/blocks`, `PATCH/DELETE /companion/hours/blocks/:id` (older apps: `PUT /companion/availability`, `PUT/DELETE /companion/dates/:date`), `GET /companion/customers/:id`, `GET /companion/bookings` (requests with their deadline and overlapping requests, upcoming, the latest 100 meet-ups as `done`, and `history`: those plus the latest 60 that didn't happen, newest first), `POST /companion/bookings/:id/accept·decline·cancel·verify-code` |
| Payouts | `GET/POST /companion/payouts`, `PUT /companion/payouts/account` |
| Chat | `GET /conversations`, `POST /conversations` (`{ bookingId }` or `{ companionId }`), `GET/POST /conversations/:id/messages`, `GET /conversations/:id/ws` (WebSocket, `?token=`) |
| Live | `GET /live` (your updates), `GET /live/slots/:id` (a companion's open times); WebSockets, `?token=` |
| Safety & gifts | `POST /safety/checkins`, `GET /safety/checkins/active`, `POST /safety/checkins/:id/ok·end·sos·location`, `GET /t/:token` (live page), `POST /gifts`, `POST /gifts/redeem` |
| Admin | `/admin/stats`, `/admin/verifications`, `/admin/companions`, `/admin/bookings` (`?status=&q=`, with counts per status; + refund, cancel), `/admin/bookings/conflicts`, `/admin/payouts` (+ paid, reject), `/admin/reports`, `/admin/feedback` (+ review), `/admin/reviews`, `/admin/users` (+ suspend, delete) |
