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
| `src/ui/` | Primitives: hard-shadow `Box`/`PressBox`, `Txt`, `Icon` (Lucide), `Stripes`, `Toggle`, `Chip`, nav bar, toast; picking a booking time (`TimePicker.tsx`: days, a day's free hours, a start in 15-minute steps, the length) |
| `src/lib/` | Helpers: dates in the phone's time zone and companions' hours with the API's rules (`dates.ts`, `tz.ts`), a companion's free time kept live, with the booking rules (`avail.ts`), the "How did it go?" card and one-time pop-up (`feedbackPrompt.ts`), … |
| `src/theme.ts` | Colours and font mapping (DM Sans + Bricolage Grotesque) |

## Startup
- **Splash screen:** `expo-splash-screen` in `app.json` (sun yellow with the `assets/splash-icon.png` wordmark, 168 dp wide so it fits Android 12's circle). It stays up until the fonts and the saved session are ready (at most 2.5 s; after that `BootScreen` in `src/app/_layout.tsx` shows the same picture with a spinner).
- **Welcome screens:** the first launch on a phone shows `welcome` (three short screens) before `login`; after Skip or Get started they don't show again (`src/lib/welcome.ts`). Before login the app follows the phone's language.
- **Icons:** `assets/icon.png` and the Android adaptive icon (`android-icon-*.png`, with a monochrome layer for themed icons) use the "z!" mark.

## Video dates
- The call screen (`src/screens/VideoCall.tsx`) uses WebRTC: `react-native-webrtc` with its Expo config plugin on phones (`src/lib/rtc.tsx`) and the browser's own WebRTC on the web (`src/lib/rtc.web.tsx`). The call logic is in `src/lib/videoCall.ts`; the server's call room only introduces the two phones.
- `react-native-incall-manager` plays the sound through the loudspeaker (or headphones), `expo-keep-awake` keeps the screen on and `expo-screen-capture` blocks screenshots and screen recording during the call.
- These are native modules, so video dates need the EAS build (as the APK already is), not Expo Go. Camera and microphone permissions are set in `app.json`; "Display over other apps" is allowed since 1.3.8 (incoming video dates can open the app on top, below).
- Ringing: while someone waits alone in the call they can ping the other person from the booked start (the Ping button counts down to the next one). The other person's open app shows the call full screen over any screen (`src/ui/IncomingRing.tsx`, state in `src/lib/ring.ts`) with the ringtone and vibration until they join, dismiss it or 30 seconds pass. Free now requests do the same (`src/ui/InstantRequest.tsx`).
- Video dates have their own boundaries (`VIDEO_OKOPTS` / `VIDEO_NO` in `src/data.ts`, `okVideo` on a companion): the profile and the booking show the ones for each kind of date, and companions pick them in their listing and application.

### Android: calls outside the open app (`modules/zeitmit-calls`, 1.3.8+)
A local Expo module (Kotlin, linked automatically from `modules/`; `plugins/withZeitmitCalls.js` lets the main activity use picture-in-picture). From JavaScript it's `nativeCalls` (`modules/zeitmit-calls/index.ts`, does nothing on the web, on iPhones and in older builds).
- **A video date keeps running when you leave the app:** `CallService`, a foreground service (camera and microphone) with an ongoing "Video date with Mia" notification (Hang up). Leaving the app shrinks the call into a floating window (picture-in-picture, by itself on Android 12+, on leaving on 8–11) that shows only the other person, with a Hang up button. The call screen switches to that layout (`onPip`). The call reconnects with a native timer, since JavaScript timers pause in the background.
- **Incoming video dates ring like phone calls with the app closed:** `CallMessagingService` sees every push before expo-notifications. A free-now request or "Mia is waiting in your video date" rings with the ZeitMit ringtone until it's answered or runs out. Over the lock screen it shows full screen. While the phone is in use it's a call notification with Accept / Decline, and with "Display over other apps" allowed the app opens on top of whatever is in use. Accept opens the app to answer (`useIncomingCalls` in `src/lib/calls.ts`). Decline declines without opening the app (with the session the app hands over in `api.ts`). A silent `call-off` push stops the ringing when a request is answered elsewhere, cancelled or runs out. While the app is on screen, everything stays in the app as before.
- **Free now stays online with the app closed:** `FreeNowService`, an ongoing "Free now for video dates until 23:30" notification (Turn off), checks in about every 2 minutes, even while the phone sleeps (`bg: true`; the server counts those for 30 minutes). Android only keeps an app running in the background with such a notification. Its status-bar icon is ZeitMit's "z!" (`zeitmit_small`); the video camera icon is only used while a video date is ringing or on.
- **Asking for what the phone has to allow (1.3.10):** companions who offer video dates get "Don’t miss a request" (`src/screens/AllowCalls.tsx`) as the app opens or comes back, while something is missing (notifications, full-screen calls, over other apps, no battery limits; an Autostart hint on some brands), at most every 12 hours. One step at a time: each opens the phone's own dialog or settings page, and the list ticks itself off on return (`src/lib/callAccess.ts`, also behind the Free now card's checklist). Customers keep the one-time "Turn on notifications" screen.
- Browser checks of these screens use a test web build made with `EXPO_PUBLIC_FAKE_CALLS=1`: a pretend Android phone whose answers live in `localStorage` (`zeitmit.fakeCalls`). Real builds leave it out.
- Texts on these notifications come from the app in its language (`src/lib/callTexts.ts`).
- The GitHub Actions job `Android build check` compiles the Android app on every change under `mobile/`, so a mistake in native code shows up before an EAS build. Its APK is signed with a test key; install it only after uninstalling an EAS-built ZeitMit.

### Listing changes wait for review (1.3.9)
Once a companion is approved, a new About or tagline, listing photo or gallery photo is checked by ZeitMit before customers see it. "Your listing" shows the newest version with "In review" on new photos and a note on what waits; a text or photo that wasn't approved shows ZeitMit's note until it's changed again. Removing or reordering gallery photos, and every other field (rate, activities, hours, …), still apply at once.

## Layout note (Android)
`Box`/`PressBox` draw the hard shadow by wrapping the face in a second view that grows to fill the wrapper. On Android, Yoga's compatibility errata stretch that face in a centred or start-aligned column (a box with a fixed width in `alignItems: 'center'`, like the customer profile's avatar), which web doesn't show. Give such boxes `fit` (or `alignSelf: 'center'`/`'flex-start'`/`'flex-end'` on the box itself) so the face keeps its size; rows and full-width cards don't need it.

The prototype's "Jump to screen" panel and phone frame were design-tool chrome and are not part of the app.
