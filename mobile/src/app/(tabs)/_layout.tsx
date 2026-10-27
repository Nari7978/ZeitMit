import { View } from 'react-native';
import { Tabs } from 'expo-router/js-tabs';
import { colors } from '../../theme';
import { CheckinBar, CustomerNavBar } from '../../ui/chrome';

export default function CustomerTabs() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.sun }}>
      <Tabs tabBar={(p) => <CustomerNavBar {...p} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.sun }, animation: 'fade' }}>
        <Tabs.Screen name="index" options={{ title: 'Discover' }} />
        <Tabs.Screen name="search" options={{ title: 'Search' }} />
        <Tabs.Screen name="bookings" options={{ title: 'Bookings' }} />
        <Tabs.Screen name="messages" options={{ title: 'Messages' }} />
        <Tabs.Screen name="account" options={{ title: 'Profile' }} />
      </Tabs>
      <CheckinBar />
    </View>
  );
}
