import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { notifWhen, TONE } from '../data';
import { useStore, type Notif } from '../store';
import { followGo } from '../nav';
import { Icon } from '../ui/Icon';
import { H, Row, Txt } from '../ui/primitives';
import { CircleButton, StatusCover, TextButton, usePullRefresh } from '../ui/common';

export default function Notifications() {
  const insets = useSafeAreaInsets();
  const notifs = useStore((s) => s.notifs).map((n) => ({ ...n, ...notifWhen(n.created_at) }));
  const hasUnread = notifs.some((n) => !n.read);
  const refresh = usePullRefresh();

  const fire = (n: Notif & { g: string; time: string }) => {
    useStore.getState().readNotif(n.id);
    followGo(n.go);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.white }}>
      <StatusCover color={colors.white} />
      <ScrollView showsVerticalScrollIndicator={false} refreshControl={refresh} contentContainerStyle={{ paddingTop: insets.top + 4, paddingBottom: 40 + insets.bottom }}>
        <Row style={{ justifyContent: 'space-between', paddingTop: 4, paddingHorizontal: 12 }}>
          <CircleButton icon="chevron-left" label="Back" size={40} iconSize={24} border={0} bg="transparent" onPress={() => router.back()} />
          {hasUnread ? <TextButton label="Mark all read" onPress={() => useStore.getState().markAllRead()} style={{ padding: 8 }} /> : null}
        </Row>
        <H size={30} ls={-0.035} style={{ marginTop: 6, marginHorizontal: 20, marginBottom: 8 }}>Notifications</H>
        {(['Today', 'Yesterday', 'Earlier'] as const).map((g) => {
          const items = notifs.filter((n) => n.g === g);
          if (!items.length) return null;
          return (
            <View key={g}>
              <Txt size={13} weight={600} color={colors.gray600} style={{ paddingTop: 18, paddingHorizontal: 20, paddingBottom: 6 }}>{g}</Txt>
              {items.map((n) => (
                <Pressable key={n.id} accessibilityRole="button" onPress={() => fire(n)} style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start', paddingVertical: 14, paddingHorizontal: 20, backgroundColor: n.read ? 'transparent' : colors.butter }}>
                  <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: TONE[n.tone][0], alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={n.icon} size={18} color={TONE[n.tone][1]} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <Txt size={14.5} weight={n.read ? 500 : 600} style={{ flex: 1 }}>{n.title}</Txt>
                      <Txt size={12} color={colors.gray600}>{n.time}</Txt>
                    </Row>
                    <Txt size={13} lh={1.45} color={colors.gray600}>{n.body}</Txt>
                  </View>
                  {!n.read ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ink, marginTop: 6 }} /> : null}
                </Pressable>
              ))}
            </View>
          );
        })}
        <Txt size={12} lh={1.5} color={colors.gray500} align="center" style={{ marginTop: 24, marginHorizontal: 20 }}>
          We only notify you about bookings, messages and account activity. Marketing messages are off unless you turn them on.
        </Txt>
      </ScrollView>
    </View>
  );
}
