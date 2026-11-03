import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { colors } from '../../theme';
import { CheckinBar, CompanionNavBar } from '../../ui/chrome';
import { useStore } from '../../store';

export default function CompanionTabs() {
  // Companion mode is for companions: anyone else (e.g. from an old link) gets the page about becoming one.
  const notCompanion = useStore((s) => !!s.user && s.companionStatus === 'none');
  if (notCompanion) return <Redirect href="/become" />;
  return (
    <View style={{ flex: 1, backgroundColor: colors.sun }}>
      <Tabs tabBar={(p) => <CompanionNavBar {...p} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.sun }, animation: 'fade' }}>
        <Tabs.Screen name="index" options={{ title: 'Overview' }} />
        <Tabs.Screen name="requests" options={{ title: 'Requests' }} />
        <Tabs.Screen name="calendar" options={{ title: 'Calendar' }} />
        <Tabs.Screen name="inbox" options={{ title: 'Messages' }} />
        <Tabs.Screen name="listing" options={{ title: 'Your listing' }} />
      </Tabs>
      <CheckinBar />
    </View>
  );
}
