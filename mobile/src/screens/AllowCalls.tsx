// Asking for what the phone has to allow so video date requests ring even with ZeitMit closed (Android, companions who
// offer video dates): opens by itself as the app opens while something is missing, at most every 12 hours
// (app/_layout.tsx). One step at a time: each opens the phone's own dialog or settings page, and the list ticks itself
// off when they come back.
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { goBack } from '../nav';
import { Icon } from '../ui/Icon';
import { H, Row, Txt } from '../ui/primitives';
import { PrimaryButton, TextButton } from '../ui/common';
import { useReach, type ReachKey } from '../lib/callAccess';

const STEPS: { key: ReachKey; icon: string; title: string; body: string; button: string }[] = [
  { key: 'notifications', icon: 'bell', title: 'Notifications', body: 'Requests, messages and video date calls.', button: 'Allow notifications' },
  { key: 'fullScreen', icon: 'phone', title: 'Full-screen calls', body: 'Requests ring full screen, also on the lock screen.', button: 'Allow full-screen calls' },
  { key: 'overlay', icon: 'layers', title: 'Show over other apps', body: 'Requests come up while you use another app.', button: 'Allow over other apps' },
  { key: 'battery', icon: 'zap', title: 'No battery limits', body: 'So your phone doesn’t stop ZeitMit in the background.', button: 'Allow in the background' },
];

export default function AllowCalls() {
  const insets = useSafeAreaInsets();
  const { allowed, allow, brand } = useReach();
  const next = STEPS.find((s) => !allowed[s.key]);
  return (
    <View testID="allow-calls" style={{ flex: 1, backgroundColor: colors.sun, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 22, paddingVertical: 12, gap: 16 }}>
        <View style={{ width: 76, height: 76, borderRadius: 24, borderWidth: 2.5, borderColor: colors.ink, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-4deg' }] }}>
          <Icon name="bell-ring" size={34} />
        </View>
        <H size={38} lh={40} ls={-0.045}>Don’t miss a request</H>
        <Txt size={15} lh={1.5} color={colors.gray800}>So your phone rings for video date requests even when ZeitMit is closed, allow these. It takes a minute.</Txt>
        <View style={{ gap: 12, marginTop: 4 }}>
          {STEPS.map((s) => (
            <View key={s.key} testID={`allow-${s.key}`} style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
              <View style={{ width: 44, height: 44, borderRadius: 14, borderWidth: 2, borderColor: colors.ink, backgroundColor: allowed[s.key] ? colors.mintSoft : colors.white, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={s.icon} size={20} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt size={15} weight={700}>{s.title}</Txt>
                <Txt size={13.5} lh={1.45} color={colors.gray800}>{s.body}</Txt>
              </View>
              {allowed[s.key] ? (
                <Row style={{ gap: 5 }}>
                  <Icon name="circle-check" size={17} color={colors.greenDeep} />
                  <Txt size={13} weight={700} color={colors.greenDeep}>Allowed</Txt>
                </Row>
              ) : (
                <TextButton label="Allow" size={14} weight={700} onPress={() => void allow(s.key)} style={{ paddingVertical: 8, paddingLeft: 8 }} />
              )}
            </View>
          ))}
        </View>
        {brand ? (
          <Row style={{ gap: 10, alignItems: 'center', padding: 12, borderRadius: 14, backgroundColor: colors.butter }}>
            <Icon name="info" size={17} />
            <Txt size={13} lh={1.45} style={{ flex: 1 }}>{`On ${brand} phones, also allow Autostart for ZeitMit.`}</Txt>
            <TextButton label="Open settings" size={13} weight={700} onPress={() => void allow('app')} style={{ paddingVertical: 6 }} />
          </Row>
        ) : null}
        {!next ? (
          <Row style={{ gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.mintSoft }}>
            <Icon name="circle-check" size={18} color={colors.greenDeep} />
            <Txt size={14} weight={600} color={colors.greenDeep} style={{ flex: 1 }}>All set: requests ring even when ZeitMit is closed.</Txt>
          </Row>
        ) : null}
      </ScrollView>
      <View style={{ paddingHorizontal: 20, paddingTop: 10, gap: 4 }}>
        {next
          ? <PrimaryButton label={next.button} icon={next.icon} onPress={() => void allow(next.key)} />
          : <PrimaryButton label="Done" icon="check" onPress={goBack} />}
        {next ? <TextButton label="Not now" size={15} onPress={goBack} style={{ alignSelf: 'center', paddingVertical: 12 }} /> : null}
      </View>
    </View>
  );
}
