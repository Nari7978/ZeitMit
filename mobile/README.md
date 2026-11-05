# ZeitMit (Expo app)

React Native / Expo implementation of the **ZeitMit App v3** design (the 1c "bold & playful" direction) from `../project/ZeitMit App v3.dc.html`.

- Expo SDK 58, Expo Router (`src/app`), TypeScript, Zustand for state
- Data comes from the ZeitMit API (`../backend`, URL in `EXPO_PUBLIC_API_URL`); state lives in `src/store.ts`
- Striped blocks (`Stripes`) stand in for photos people haven't uploaded yet

```bash
npm install
npx expo start        # i / a / w for iOS, Android, web
npm run typecheck
```

## Structure

| Path | What |
| --- | --- |
| `src/app/` | Routes: customer tabs `(tabs)/`, companion tabs `companion/`, overlays `profile/[id]`, `book/[cid]`, `chat/[id]`, `notifications`, `become`, `swipe`, `history` (a companion's booking history), `call/[id]` (a video date) |
| `src/screens/` | Screen implementations |
| `src/sheets/SheetHost.tsx` | All bottom sheets (filters, sort, city, gift, safety check-in, SOS, meet code, report, review, …) |
| `src/ui/` | Primitives: hard-shadow `Box`/`PressBox`, `Txt`, `Icon` (Lucide), `Stripes`, `Toggle`, `Chip`, nav bar, toast |
| `src/lib/` | Helpers: Berlin dates and companions' own hours (`dates.ts`), the "How did it go?" card and one-time pop-up (`feedbackPrompt.ts`), open times (`slots.ts`), … |
| `src/theme.ts` | Colours and font mapping (DM Sans + Bricolage Grotesque) |

## Startup
- **Splash screen:** `expo-splash-screen` in `app.json` (sun yellow with the `assets/splash-icon.png` wordmark, 168 dp wide so it fits Android 12's circle). It stays up until the fonts and the saved session are ready (at most 2.5 s; after that `BootScreen` in `src/app/_layout.tsx` shows the same picture with a spinner).
- **Welcome screens:** the first launch on a phone shows `welcome` (three short screens) before `login`; after Skip or Get started they don't show again (`src/lib/welcome.ts`). Before login the app follows the phone's language.
- **Icons:** `assets/icon.png` and the Android adaptive icon (`android-icon-*.png`, with a monochrome layer for themed icons) use the "z!" mark.

## Video dates
- The call screen (`src/screens/VideoCall.tsx`) uses WebRTC: `react-native-webrtc` with its Expo config plugin on phones (`src/lib/rtc.tsx`) and the browser's own WebRTC on the web (`src/lib/rtc.web.tsx`). The call logic is in `src/lib/videoCall.ts`; the server's call room only introduces the two phones.
- `react-native-incall-manager` plays the sound through the loudspeaker (or headphones), `expo-keep-awake` keeps the screen on and `expo-screen-capture` blocks screenshots and screen recording during the call.
- These are native modules, so video dates need the EAS build (as the APK already is), not Expo Go. Camera and microphone permissions are set in `app.json`; the plugin's "draw over other apps" permission is removed.

## Layout note (Android)
`Box`/`PressBox` draw the hard shadow by wrapping the face in a second view that grows to fill the wrapper. On Android, Yoga's compatibility errata stretch that face in a centred or start-aligned column (a box with a fixed width in `alignItems: 'center'`, like the customer profile's avatar), which web doesn't show. Give such boxes `fit` (or `alignSelf: 'center'`/`'flex-start'`/`'flex-end'` on the box itself) so the face keeps its size; rows and full-width cards don't need it.

The prototype's "Jump to screen" panel and phone frame were design-tool chrome and are not part of the app.
