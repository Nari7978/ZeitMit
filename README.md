# ZeitMit

Real People. Real Moments. A companion booking app for Berlin: friends, dates and plus-ones, always in public and paid through ZeitMit.

| Folder | What |
| --- | --- |
| [`mobile/`](mobile) | Customer + companion app (Expo / React Native, TypeScript) |
| [`backend/`](backend) | API on Cloudflare Workers + D1 (free plan) |
| [`admin/`](admin) | Admin panel (planned) |

## Mobile app

```bash
cd mobile
npm install
npx expo start                           # preview
eas build -p android --profile preview   # installable APK
```

See [`mobile/README.md`](mobile/README.md) for structure and details.
