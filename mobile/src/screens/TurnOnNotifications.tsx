// Asking for notifications: ZeitMit says what they're for first, and the phone's own dialog comes only after "Turn on
// notifications". Opens by itself once per phone after signing in, when the phone can still ask (app/_layout.tsx).
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { useStore } from '../store';
import { goBack } from '../nav';
import { Icon } from '../ui/Icon';
import { H, Txt } from '../ui/primitives';
import { PrimaryButton, TextButton } from '../ui/common';
import { turnOnPush } from '../lib/push';
import { Point } from './Welcome';

export default function TurnOnNotifications() {
  const insets = useSafeAreaInsets();
  const companion = useStore((s) => s.companionStatus === 'approved' || s.companionStatus === 'pending');
  const points: [string, string, string][] = companion
    ? [
      ['inbox', 'New requests', 'Know at once when someone wants to book you.'],
      ['bell-ring', 'Video date calls', 'Your phone rings when your customer is waiting in the call.'],
      ['message-circle', 'Messages', 'Replies from customers before you meet.'],
    ]
    : [
      ['calendar-check', 'Answers to your requests', 'Know at once when a companion accepts.'],
      ['bell-ring', 'Video date calls', 'Your phone rings when your companion is waiting in the call.'],
      ['message-circle', 'Messages', 'Replies from companions before you meet.'],
    ];
  return (
    <View style={{ flex: 1, backgroundColor: colors.sun, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 22, paddingVertical: 12, gap: 16 }}>
        <View style={{ width: 76, height: 76, borderRadius: 24, borderWidth: 2.5, borderColor: colors.ink, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-4deg' }] }}>
          <Icon name="bell" size={34} />
        </View>
        <H size={38} lh={40} ls={-0.045}>Don’t miss a thing</H>
        <Txt size={15} lh={1.5} color={colors.gray800}>Turn on notifications to hear about your bookings as they happen. You can change this any time in Settings.</Txt>
        <View style={{ gap: 14, marginTop: 4 }}>
          {points.map(([icon, title, body]) => <Point key={title} icon={icon} title={title} body={body} />)}
        </View>
      </ScrollView>
      <View style={{ paddingHorizontal: 20, paddingTop: 10, gap: 4 }}>
        <PrimaryButton label="Turn on notifications" icon="bell" onPress={() => void turnOnPush().finally(goBack)} />
        <TextButton label="Not now" size={15} onPress={goBack} style={{ alignSelf: 'center', paddingVertical: 12 }} />
      </View>
    </View>
  );
}
