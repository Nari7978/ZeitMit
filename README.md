# ZeitMit (Expo app)

React Native / Expo implementation of the **ZeitMit App v3** design (the 1c "bold & playful" direction) from `../project/ZeitMit App v3.dc.html`.

- Expo SDK 58, Expo Router (`src/app`), TypeScript, Zustand for state
- All data is mock, ported from the prototype (`src/data.ts`, `src/store.ts`); payments, verification and messaging are simulated
- Striped blocks (`Stripes`) stand in for licensed photography

```bash
npm install
npx expo start        # i / a / w for iOS, Android, web
npm run typecheck
```

## Structure

| Path | What |
| --- | --- |
| `src/app/` | Routes: customer tabs `(tabs)/`, companion tabs `companion/`, overlays `profile/[id]`, `book/[cid]`, `chat/[id]`, `notifications`, `become`, `swipe` |
| `src/screens/` | Screen implementations |
| `src/sheets/SheetHost.tsx` | All bottom sheets (filters, sort, city, gift, safety check-in, SOS, meet code, report, review, …) |
| `src/ui/` | Primitives: hard-shadow `Box`/`PressBox`, `Txt`, `Icon` (Lucide), `Stripes`, `Toggle`, `Chip`, nav bar, toast |
| `src/theme.ts` | Colours and font mapping (DM Sans + Bricolage Grotesque) |

The prototype's "Jump to screen" panel and phone frame were design-tool chrome and are not part of the app.
