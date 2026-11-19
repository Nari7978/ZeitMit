# ZeitMit Admin

Web admin panel (Vite + React), deployed to Cloudflare Pages at `zeitmit-admin.pages.dev` by `.github/workflows/admin.yml`.

- Overview stats
- Live now (updates every 10 seconds): requests ringing (cancel and refund), who is Free now and whether customers can see them (switch it off), video dates on now and who is in the call, what starts in the next hour, open SOS
- ID checks, and Companion reviews: ID photo check, approve / reject (ID photos are deleted after review)
- Profile changes: approved companions' new texts and photos wait here (old and new side by side, with what the check found); approve, leave single photos out, or reject with a note
- Bookings with refunds; a video date's call log (who was in the call when, why it was paid like that, what happened) with Refund in full and Pay in full
- Payouts, Reports and safety (user reports, flagged messages, SOS check-ins with map link, suspend users), Safety feedback, Reviews
- Users

Sign-in uses the same email code as the app. Only addresses in the `ADMIN_EMAILS` GitHub variable get admin access, and only when real email (Brevo) is configured.

```sh
npm install
VITE_API_URL=http://localhost:8787 npm run dev
```
