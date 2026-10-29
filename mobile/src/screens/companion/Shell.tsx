import type { ReactNode } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useIsFocused } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../theme';
import { AM, hours, type ActId } from '../../data';
import { toCustomerMode } from '../../nav';
import { Icon } from '../../ui/Icon';
import { Enter, H, Row, tint, Txt } from '../../ui/primitives';
import { StatusCover, usePullRefresh } from '../../ui/common';
import { photoUri } from '../../lib/photos';
import { useNavBottom } from '../../ui/chrome';

/** Black header + scroll body shared by every companion-mode tab. */
export function CompShell({ title, children, pad = true }: { title: string; children: ReactNode; pad?: boolean }) {
  const insets = useSafeAreaInsets();
  const bottom = useNavBottom() + 90;
  const focused = useIsFocused();
  const refresh = usePullRefresh(undefined, colors.white);
  return (
    <View style={{ flex: 1, backgroundColor: colors.sun }}>
      {focused ? <StatusBar style="light" /> : null}
      <StatusCover color={colors.ink} />
      <ScrollView showsVerticalScrollIndicator={false} refreshControl={refresh} contentContainerStyle={{ paddingBottom: bottom }}>
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
export function Initial({ who, hue, size = 48, radius = 16, fontSize = 18, url }: { who: string; hue: number; size?: number; radius?: number; fontSize?: number; url?: string | null }) {
  const t = tint(hue);
  const uri = photoUri(url);
  return (
    <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <Txt size={fontSize} weight={700} color={t.fg}>{who[0]}</Txt>
      {uri ? <Image source={{ uri }} resizeMode="cover" style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors /> : null}
    </View>
  );
}

export const actLine = (act: ActId, dur: number) => AM[act].label + ' · ' + hours(dur);
