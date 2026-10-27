import { View } from 'react-native';
import { Tabs } from 'expo-router/js-tabs';
import { colors } from '../../theme';
import { CheckinBar, CompanionNavBar } from '../../ui/chrome';

export default function CompanionTabs() {
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
