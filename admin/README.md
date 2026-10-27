# ZeitMit Admin

Web admin panel (Vite + React), deployed to Cloudflare Pages at `zeitmit-admin.pages.dev` by `.github/workflows/admin.yml`.

- Overview stats
- Companion reviews: ID photo check, approve / reject (ID photos are deleted after review)
- Bookings with refunds
- Reports and safety: user reports, flagged messages, SOS check-ins with map link, suspend users
- Users

Sign-in uses the same email code as the app. Only addresses in the `ADMIN_EMAILS` GitHub variable get admin access, and only when real email (Brevo) is configured.

```sh
npm install
VITE_API_URL=http://localhost:8787 npm run dev
```
