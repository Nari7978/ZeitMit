import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, type Weight } from '../theme';
import { useStore } from '../store';
import { Icon } from './Icon';
import { HeartGlyph, PressBox, Txt, Row } from './primitives';

/** Fixed strip behind the status bar so scrolled content doesn't show through it. */
export function StatusCover({ color }: { color: string }) {
  const insets = useSafeAreaInsets();
  return <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, backgroundColor: color, zIndex: 20 }} />;
}

/** Top padding used by the design (54px = 50px status bar + 4). */
export function useTopPad(extra = 4) {
  return useSafeAreaInsets().top + extra;
}

type BtnProps = {
  label?: string;
  children?: ReactNode;
  onPress?: () => void;
  icon?: string;
  iconSize?: number;
  height?: number;
  radius?: number;
  size?: number;
  weight?: Weight;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  dim?: boolean;
  accessibilityLabel?: string;
};

/** Black primary button with the pink (or custom) offset shadow. */
export function PrimaryButton({ label, children, onPress, icon, iconSize = 16, height = 52, radius = 16, size = 15, weight = 600, style, dim, shadowColor = colors.pink, bg = colors.ink, fg = colors.white, accessibilityLabel }: BtnProps & { shadowColor?: string; bg?: string; fg?: string }) {
  return (
    <PressBox
      onPress={dim ? undefined : onPress}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!dim }}
      shadow={3}
      shadowColor={shadowColor}
      fx="scale"
      style={[{ height, borderRadius: radius, backgroundColor: bg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20, opacity: dim ? 0.4 : 1 }, style]}
    >
      {icon ? <Icon name={icon} size={iconSize} color={fg} /> : null}
      {label ? <Txt size={size} weight={weight} color={fg}>{label}</Txt> : children}
    </PressBox>
  );
}

/** White outlined button with the ink offset shadow. */
export function SecondaryButton({ label, children, onPress, icon, iconSize = 15, height = 46, radius = 14, size = 14, weight = 600, style, shadow = 3, border = 2, accessibilityLabel }: BtnProps & { shadow?: number; border?: number }) {
  return (
    <PressBox
      onPress={onPress}
      accessibilityLabel={accessibilityLabel ?? label}
      shadow={shadow}
      fx="push"
      style={[{ height, borderRadius: radius, backgroundColor: colors.white, borderWidth: border, borderColor: colors.ink, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20 }, style]}
    >
      {icon ? <Icon name={icon} size={iconSize} /> : null}
      {label ? <Txt size={size} weight={weight}>{label}</Txt> : children}
    </PressBox>
  );
}

/** Borderless text button. */
export function TextButton({ label, onPress, size = 14, weight = 600, color = colors.ink, style, underline }: { label: string; onPress: () => void; size?: number; weight?: Weight; color?: string; style?: StyleProp<ViewStyle>; underline?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8} style={({ pressed }) => [{ paddingVertical: 6, opacity: pressed ? 0.6 : 1 }, style]}>
      <Txt size={size} weight={weight} color={color} style={underline ? { textDecorationLine: 'underline' } : null}>{label}</Txt>
    </Pressable>
  );
}

/** Round icon button (back / close / share). */
export function CircleButton({ icon, onPress, label, size = 42, iconSize = 21, bg = colors.white, border = 2, borderColor = colors.ink, color = colors.ink, style }: { icon: string; onPress: () => void; label: string; size?: number; iconSize?: number; bg?: string; border?: number; borderColor?: string; color?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, borderWidth: border, borderColor, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.75 : 1 }, style]}
    >
      <Icon name={icon} size={iconSize} color={color} />
    </Pressable>
  );
}

/** Heart save button with the springy bump from the prototype. */
export function SaveButton({ id, size, iconSize, variant, scrolled, style }: { id: string; size: number; iconSize: number; variant: 'photo' | 'light' | 'profile'; scrolled?: boolean; style?: StyleProp<ViewStyle> }) {
  const saved = useStore((s) => s.saved.includes(id));
  const bump = useStore((s) => s.bump === id);
  const toggleSave = useStore((s) => s.toggleSave);
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: bump ? 1.28 : 1, useNativeDriver: true, speed: 40, bounciness: 14 }).start();
  }, [bump, scale]);

  let bg: string = colors.cream;
  let stroke: string = saved ? colors.ink : colors.gray600;
  let border = 0;
  let borderColor: string = 'transparent';
  let sw = 2.2;
  if (variant === 'photo') {
    bg = saved ? colors.white : 'rgba(255,255,255,.24)';
    stroke = saved ? colors.ink : colors.white;
    sw = size < 38 ? 2.2 : 2;
  } else if (variant === 'profile') {
    bg = scrolled ? colors.white : 'rgba(255,255,255,.88)';
    border = 1;
    borderColor = scrolled ? colors.ink : 'transparent';
    sw = 2;
  }
  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={saved ? 'Unsave' : 'Save'}
        accessibilityState={{ selected: saved }}
        onPress={() => toggleSave(id)}
        hitSlop={6}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, borderWidth: border, borderColor, alignItems: 'center', justifyContent: 'center' }}
      >
        <HeartGlyph size={iconSize} fill={saved ? colors.ink : 'none'} stroke={stroke} strokeWidth={sw} />
      </Pressable>
    </Animated.View>
  );
}

/** Section heading row: "Featured this week ........ See all". */
export function SectionHead({ title, onSeeAll, style, dot }: { title: string; onSeeAll?: () => void; style?: StyleProp<ViewStyle>; dot?: boolean }) {
  return (
    <Row style={[{ justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 20 }, style]}>
      <Row style={{ gap: 8 }}>
        {dot ? (
          <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: 'rgba(23,138,96,.15)', alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green }} />
          </View>
        ) : null}
        <Txt kind="display" weight={700} size={21} ls={-0.02} numberOfLines={1}>{title}</Txt>
      </Row>
      {onSeeAll ? <TextButton label="See all" onPress={onSeeAll} /> : null}
    </Row>
  );
}

/** Tilted sticker icon used for empty states. */
export function EmptyState({ icon, title, body, tilt, action }: { icon: string; title: string; body: string; tilt: number; action?: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 44, paddingHorizontal: 36, gap: 10 }}>
      <View style={{ width: 88, height: 88, marginBottom: 8 }}>
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 28, backgroundColor: colors.blush, transform: [{ rotate: tilt + 'deg' }] }} />
        <View style={{ position: 'absolute', top: 4, left: 4, right: -4, bottom: -4, borderRadius: 28, backgroundColor: colors.ink }} />
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 28, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={34} />
        </View>
      </View>
      <Txt kind="display" weight={700} size={20} align="center">{title}</Txt>
      <Txt size={14} lh={1.5} color={colors.gray600} align="center">{body}</Txt>
      {action}
    </View>
  );
}

/** "Sample" / status pills. */
export function Pill({ label, bg, fg, dot, height = 26, size = 12, style, icon }: { label: string; bg: string; fg: string; dot?: string; height?: number; size?: number; style?: StyleProp<ViewStyle>; icon?: string }) {
  return (
    <Row style={[{ height, paddingHorizontal: 10, borderRadius: 999, backgroundColor: bg, gap: 6 }, style]}>
      {dot ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot }} /> : null}
      {icon ? <Icon name={icon} size={size + 1} color={fg} /> : null}
      <Txt size={size} weight={600} color={fg} numberOfLines={1}>{label}</Txt>
    </Row>
  );
}

/** Square icon tile (e.g. 40×40 pink rounded square with an icon). */
export function IconTile({ icon, size = 40, radius = 13, bg = colors.blush, color = colors.ink, iconSize = 18, border, style }: { icon: string; size?: number; radius?: number; bg?: string; color?: string; iconSize?: number; border?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ width: size, height: size, borderRadius: radius, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', borderWidth: border ?? 0, borderColor: colors.ink }, style]}>
      <Icon name={icon} size={iconSize} color={color} />
    </View>
  );
}
