import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Image, View } from 'react-native';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque';
import { colors } from '../theme';
import { msSinceRefresh, useStore } from '../store';
import { Toast, useNavBottom } from '../ui/chrome';
import { APP_MAX_WIDTH, useAppFrame } from '../ui/layout';
import { SheetHost } from '../sheets/SheetHost';
import { onNotificationTap, registerForPush } from '../lib/push';
import { useLive } from '../lib/live';
import { followGo } from '../nav';

const TAB_PATHS = ['/', '/search', '/bookings', '/messages', '/account', '/notifications'];

// The splash screen (app.json: yellow with the wordmark) stays up until the first real screen can show.
void SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 250, fade: true });

const SPLASH = require('../../assets/splash-icon.png');
const SPLASH_WIDTH = 168; // as in app.json
const SPLASH_RATIO = 1426 / 356; // assets/splash-icon.png

/**
 * The splash screen drawn by the app: the same picture, for when loading takes longer than the native splash stays
 * up (2.5 s). After a moment a spinner shows that it's still working.
 */
function BootScreen() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 1500);
    return () => clearTimeout(t);
  }, []);
  return (
    <View style={{ flex: 1, backgroundColor: colors.sun, alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="dark" />
      <Image source={SPLASH} accessibilityLabel="ZeitMit" resizeMode="contain" style={{ width: SPLASH_WIDTH, height: Math.round(SPLASH_WIDTH / SPLASH_RATIO) }} />
      <View style={{ position: 'absolute', top: '50%', marginTop: 56, opacity: slow ? 1 : 0 }}>
        <ActivityIndicator color={colors.ink} />
      </View>
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold,
    BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold,
  });

  const session = useStore((s) => s.session);
  const welcomed = useStore((s) => s.welcomed);
  // Fonts that fail to load fall back to the system font rather than keeping the app from starting.
  const ready = (fontsLoaded || !!fontError) && session !== 'loading';

  // Hide the native splash once the first screen is there, or after 2.5 s (BootScreen looks the same and waits on).
  useEffect(() => {
    if (ready) { SplashScreen.hide(); return; }
    const t = setTimeout(() => SplashScreen.hide(), 2500);
    return () => clearTimeout(t);
  }, [ready]);

  // Live: the API says the moment something changes for you (a request, a cancellation, a message), so screens update
  // at once. After a reconnect, reload what may have been missed meanwhile.
  const live = useLive(session === 'in' ? '/live' : null, (e) => {
    if (e.type === 'changed') useStore.getState().onLive(String(e.go ?? ''));
  }, () => {
    if (msSinceRefresh() > 5000) void useStore.getState().refresh();
  });

  // Restore the saved session, then keep data fresh: on app resume, every 30 s while live updates are down, and every
  // 5 minutes regardless (new companions and ratings aren't sent live).
  useEffect(() => {
    void useStore.getState().boot();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active' && useStore.getState().session === 'in') void useStore.getState().refresh();
    });
    const t = setInterval(() => {
      if (AppState.currentState !== 'active' || useStore.getState().session !== 'in') return;
      if (!live.current || msSinceRefresh() > 5 * 60000) void useStore.getState().refresh();
    }, 30000);
    return () => { sub.remove(); clearInterval(t); };
  }, [live]);

  // Push: register once signed in; follow taps on notifications once the screens exist
  // (a tap can arrive before the navigator is mounted when it opened the app).
  useEffect(() => {
    if (session !== 'in' || !ready) return;
    void registerForPush();
    return onNotificationTap((go) => {
      void useStore.getState().refresh();
      setTimeout(() => void followGo(go), 60);
    });
  }, [session, ready]);

  const path = usePathname();
  const checkin = useStore((s) => !!s.checkin);
  const navBottom = useNavBottom();
  const { framed } = useAppFrame();
  const onTabs = TAB_PATHS.includes(path) || path.startsWith('/companion');
  const toastBottom = onTabs ? navBottom + (checkin && path !== '/notifications' ? 158 : 82) : navBottom + 98;

  if (!ready) return <BootScreen />;
  const signedIn = session === 'in';

  return (
    <View style={{ flex: 1, backgroundColor: colors.sun }}>
      <StatusBar style="dark" />
      {/* Tablets: the phone layout in a framed column (screens get exactly APP_MAX_WIDTH inside the frame). */}
      <View style={framed ? { flex: 1, width: APP_MAX_WIDTH + 4, alignSelf: 'center', borderLeftWidth: 2, borderRightWidth: 2, borderColor: colors.ink, overflow: 'hidden' } : { flex: 1 }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.sun }, animation: 'fade' }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="companion" />
          <Stack.Screen name="profile/[id]" options={{ animation: 'slide_from_right', contentStyle: { backgroundColor: colors.white } }} />
          <Stack.Screen name="chat/[id]" options={{ animation: 'slide_from_right', contentStyle: { backgroundColor: colors.cream } }} />
          <Stack.Screen name="notifications" options={{ animation: 'slide_from_right', contentStyle: { backgroundColor: colors.white } }} />
          <Stack.Screen name="book/[cid]" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="become" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="verify" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="payment-done" options={{ animation: 'none' }} />
          <Stack.Screen name="payouts" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="customer/[id]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="reschedule/[id]" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="swipe" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="settings/[page]" options={{ animation: 'slide_from_right' }} />
        </Stack.Protected>
        {/* First time on this phone: a few welcome screens, then login. */}
        <Stack.Protected guard={!signedIn && !welcomed}>
          <Stack.Screen name="welcome" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
      {signedIn ? <SheetHost /> : null}
      <Toast bottom={toastBottom} />
      </View>
    </View>
  );
}
