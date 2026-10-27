import type { ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useIsFocused } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../theme';
import { AM, hours, type ActId } from '../../data';
import { toCustomerMode } from '../../nav';
import { Icon } from '../../ui/Icon';
import { Enter, H, Row, tint, Txt } from '../../ui/primitives';
import { StatusCover } from '../../ui/common';
import { useNavBottom } from '../../ui/chrome';

/** Black header + scroll body shared by every companion-mode tab. */
export function CompShell({ title, children, pad = true }: { title: string; children: ReactNode; pad?: boolean }) {
  const insets = useSafeAreaInsets();
  const bottom = useNavBottom() + 90;
  const focused = useIsFocused();
  return (
    <View style={{ flex: 1, backgroundColor: colors.sun }}>
      {focused ? <StatusBar style="light" /> : null}
      <StatusCover color={colors.ink} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: bottom }}>
        <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 26, backgroundColor: colors.ink, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, gap: 14 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Row style={{ gap: 8, height: 30, paddingHorizontal: 12, borderRadius: 999, backgroundColor: 'rgba(255,255,255,.1)' }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.sun }} />
              <Txt size={12} weight={600} color={colors.white}>Companion mode</Txt>
            </Row>
            <Pressable accessibilityRole="button" onPress={toCustomerMode} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,.2)' }}>
              <Icon name="repeat" size={13} color={colors.white} />
              <Txt size={12} weight={600} color={colors.white}>Customer view</Txt>
            </Pressable>
          </Row>
          <H size={30} ls={-0.035} color={colors.white}>{title}</H>
        </View>
        <Enter style={pad ? { padding: 20, gap: 14 } : { paddingVertical: 12 }}>{children}</Enter>
      </ScrollView>
    </View>
  );
}

/** Customer initial in a tinted rounded square. */
export function Initial({ who, hue, size = 48, radius = 16, fontSize = 18 }: { who: string; hue: number; size?: number; radius?: number; fontSize?: number }) {
  const t = tint(hue);
  return (
    <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Txt size={fontSize} weight={700} color={t.fg}>{who[0]}</Txt>
    </View>
  );
}

export const actLine = (act: ActId, dur: number) => AM[act].label + ' · ' + hours(dur);
