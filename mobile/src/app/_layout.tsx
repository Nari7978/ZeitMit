import { useEffect } from 'react';
import { AppState, View } from 'react-native';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque';
import { colors } from '../theme';
import { useStore } from '../store';
import { Toast, useNavBottom } from '../ui/chrome';
import { SheetHost } from '../sheets/SheetHost';
import { onNotificationTap, registerForPush } from '../lib/push';
import { useLive } from '../lib/live';
import { followGo } from '../nav';

const TAB_PATHS = ['/', '/search', '/bookings', '/messages', '/account', '/notifications'];

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold,
    BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold,
  });

  const session = useStore((s) => s.session);

  // Restore the saved session, then keep data fresh: on app resume and every 30s while open.
  useEffect(() => {
    void useStore.getState().boot();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active' && useStore.getState().session === 'in') void useStore.getState().refresh();
    });
    const t = setInterval(() => {
      if (AppState.currentState === 'active' && useStore.getState().session === 'in') void useStore.getState().refresh();
    }, 30000);
    return () => { sub.remove(); clearInterval(t); };
  }, []);

  // Live: the API says the moment something changes for you (a request, a cancellation, a message), so screens update at once.
  useLive(session === 'in' ? '/live' : null, (e) => {
    if (e.type === 'changed') useStore.getState().onLive(String(e.go ?? ''));
  });

  // Push: register once signed in; follow taps on notifications once the screens exist
  // (a tap can arrive before the navigator is mounted when it opened the app).
  useEffect(() => {
    if (session !== 'in' || !fontsLoaded) return;
    void registerForPush();
    return onNotificationTap((go) => {
      void useStore.getState().refresh();
      setTimeout(() => void followGo(go), 60);
    });
  }, [session, fontsLoaded]);

  const path = usePathname();
  const checkin = useStore((s) => !!s.checkin);
  const navBottom = useNavBottom();
  const onTabs = TAB_PATHS.includes(path) || path.startsWith('/companion');
  const toastBottom = onTabs ? navBottom + (checkin && path !== '/notifications' ? 158 : 82) : navBottom + 98;

  if (!fontsLoaded || session === 'loading') return <View style={{ flex: 1, backgroundColor: colors.sun }} />;
  const signedIn = session === 'in';

  return (
    <View style={{ flex: 1, backgroundColor: colors.sun }}>
      <StatusBar style="dark" />
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
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
      {signedIn ? <SheetHost /> : null}
      <Toast bottom={toastBottom} />
    </View>
  );
}
