import { useEffect, useId, useRef, type ReactNode } from 'react';
import {
  AccessibilityInfo, Animated, Easing, Image, Pressable, StyleSheet, Text, View,
  type PressableProps, type StyleProp, type TextProps, type TextStyle, type ViewStyle,
} from 'react-native';
import Svg, { Defs, Path, Pattern, Rect } from 'react-native-svg';
import { colors, em, font, type FontKind, type Weight } from '../theme';
import { oklch } from '../lib/oklch';
import { Icon } from './Icon';
import { photoUri } from '../lib/photos';
import { t } from '../i18n';
import { useStore } from '../store';

// ---------- Text ----------

type TxtProps = TextProps & {
  size?: number;
  weight?: Weight;
  color?: string;
  kind?: FontKind;
  /** letter-spacing in em, like the design */
  ls?: number;
  /** line-height: <= 3 is a multiplier, otherwise points */
  lh?: number;
  align?: TextStyle['textAlign'];
  style?: StyleProp<TextStyle>;
};

/** Translates plain-text children. Mixed text like "Hi {name}!" is translated as one sentence first. */
function translate(children: ReactNode): ReactNode {
  if (typeof children === 'string') return t(children);
  if (!Array.isArray(children)) return children;
  if (children.every((c) => typeof c === 'string' || typeof c === 'number')) {
    const whole = children.join('');
    const tr = t(whole);
    if (tr !== whole) return tr;
  }
  return children.map((c) => (typeof c === 'string' ? t(c) : c));
}

export function Txt({ size = 15, weight = 400, color = colors.ink, kind = 'body', ls, lh, align, style, children, ...rest }: TxtProps) {
  useStore((s) => s.user?.language); // re-render when the language changes
  return (
    <Text
      {...rest}
      children={translate(children)}
      style={[
        font(kind, weight),
        { fontSize: size, color },
        ls != null && { letterSpacing: em(size, ls) },
        lh != null && { lineHeight: lh <= 3 ? size * lh : lh },
        align && { textAlign: align },
        style,
      ]}
    />
  );
}

/** Display headline in Bricolage Grotesque. */
export const H = (p: TxtProps) => <Txt kind="display" weight={800} {...p} />;

/** Inline bold span for nested text. */
export const B = ({ children, size, color }: { children: ReactNode; size?: number; color?: string }) => (
  <Text style={[font('body', 700), size ? { fontSize: size } : null, color ? { color } : null]}>{children}</Text>
);

// ---------- Hard-shadow boxes ----------

const LAYOUT_KEYS = new Set([
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical',
  'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf', 'width', 'height', 'minWidth', 'minHeight', 'maxWidth',
  'maxHeight', 'position', 'top', 'left', 'right', 'bottom', 'zIndex', 'aspectRatio', 'transform', 'opacity',
]);

function split(style: StyleProp<ViewStyle>) {
  const flat = (StyleSheet.flatten(style) || {}) as Record<string, unknown>;
  const wrap: Record<string, unknown> = {};
  const face: Record<string, unknown> = {};
  for (const k of Object.keys(flat)) (LAYOUT_KEYS.has(k) ? wrap : face)[k] = flat[k];
  return { wrap: wrap as ViewStyle, face: face as ViewStyle, radius: (flat.borderRadius as number) ?? 0 };
}

type ShadowOpts = { shadow?: number; shadowColor?: string };

/** A view with the design's offset hard shadow (`box-shadow: Npx Npx 0 #111`). */
export function Box({ style, shadow = 0, shadowColor = colors.ink, children }: ShadowOpts & { style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  if (!shadow) return <View style={style}>{children}</View>;
  const { wrap, face, radius } = split(style);
  return (
    <View style={wrap}>
      <View pointerEvents="none" style={{ position: 'absolute', top: shadow, left: shadow, right: -shadow, bottom: -shadow, borderRadius: radius, backgroundColor: shadowColor }} />
      <View style={[face, { flexGrow: 1 }]}>{children}</View>
    </View>
  );
}

type PressFx = 'push' | 'scale' | 'fade' | 'none';

type PressBoxProps = ShadowOpts & Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  fx?: PressFx;
};

/** Pressable variant of Box with the design's :active feedback. */
export function PressBox({ style, shadow = 0, shadowColor = colors.ink, children, fx = 'fade', ...rest }: PressBoxProps) {
  const { wrap, face, radius } = split(style);
  return (
    <Pressable accessibilityRole="button" {...rest} style={wrap}>
      {({ pressed }) => {
        const p = pressed && !rest.disabled;
        const push = p && fx === 'push';
        const off = push ? Math.max(0, shadow - 2) : shadow;
        return (
          <>
            {shadow > 0 && (
              <View pointerEvents="none" style={{ position: 'absolute', top: shadow, left: shadow, right: -shadow, bottom: -shadow, borderRadius: radius, backgroundColor: shadowColor }} />
            )}
            <View
              style={[
                face,
                { flexGrow: 1 },
                push && { transform: [{ translateX: shadow - off }, { translateY: shadow - off }] },
                p && fx === 'scale' && { transform: [{ scale: 0.97 }] },
                p && fx === 'fade' && { opacity: 0.85 },
              ]}
            >
              {children}
            </View>
          </>
        );
      }}
    </Pressable>
  );
}

// ---------- Placeholder photography ----------

/** Diagonal striped block standing in for licensed photography (`stripes(hue)`). */
export function Stripes({ hue, l = [0.885, 0.855], c = [0.04, 0.05], style }: { hue: number; l?: [number, number]; c?: [number, number]; style?: StyleProp<ViewStyle> }) {
  const id = 'st' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const a = oklch(l[0], c[0], hue);
  const b = oklch(l[1], c[1], hue);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: a, overflow: 'hidden' }, style]} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id={id} patternUnits="userSpaceOnUse" width={18} height={18} patternTransform="rotate(45)">
            <Rect x={0} y={0} width={9} height={18} fill={a} />
            <Rect x={9} y={0} width={9} height={18} fill={b} />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

export const stripeBase = (hue: number) => oklch(0.885, 0.04, hue);

/** A person's photo, falling back to the striped placeholder until one is uploaded. */
export function Photo({ hue, url, style }: { hue: number; url?: string | null; style?: StyleProp<ViewStyle> }) {
  const uri = photoUri(url);
  return (
    <>
      <Stripes hue={hue} style={style} />
      {uri ? <Image source={{ uri }} resizeMode="cover" style={[StyleSheet.absoluteFill, style as object]} accessibilityIgnoresInvertColors /> : null}
    </>
  );
}

/** Solid tinted avatar colour used for customers (`oklch(0.92 0.04 h)`). */
export const tint = (hue: number) => ({ bg: oklch(0.92, 0.04, hue), fg: oklch(0.4, 0.08, hue) });

// ---------- Heart ----------

const HEART = 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z';
export function HeartGlyph({ size, fill, stroke, strokeWidth = 2 }: { size: number; fill: string; stroke: string; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={HEART} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
    </Svg>
  );
}

// ---------- Controls ----------

export function Toggle({ on, onPress, label, bordered }: { on: boolean; onPress: () => void; label: string; bordered?: boolean }) {
  const x = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(x, { toValue: on ? 1 : 0, duration: 200, useNativeDriver: true }).start();
  }, [on, x]);
  const knob = bordered ? 22 : 24;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={{ width: 50, height: 30, borderRadius: 999, backgroundColor: on ? colors.ink : colors.gray300, borderWidth: bordered ? 2 : 0, borderColor: colors.ink }}
    >
      <Animated.View
        style={{
          position: 'absolute', top: bordered ? 2 : 3, left: bordered ? 2 : 3, width: knob, height: knob, borderRadius: knob / 2,
          backgroundColor: colors.white, borderWidth: bordered ? 2 : 0, borderColor: colors.ink,
          shadowColor: '#000', shadowOpacity: bordered ? 0 : 0.2, shadowRadius: 1.5, shadowOffset: { width: 0, height: 1 }, elevation: bordered ? 0 : 2,
          transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) }],
        }}
      />
    </Pressable>
  );
}

/** Rounded selectable chip (`sel()` styling). */
export function Chip({
  label, on, onPress, icon, height = 36, radius = 999, size = 13, weight = 500, padL = 14, padR = 14, style, iconSize = 15,
}: {
  label: string; on: boolean; onPress: () => void; icon?: string; height?: number; radius?: number; size?: number;
  weight?: Weight; padL?: number; padR?: number; style?: StyleProp<ViewStyle>; iconSize?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={({ pressed }) => [
        {
          height, borderRadius: radius, borderWidth: 1, borderColor: colors.ink, backgroundColor: on ? colors.blush : colors.white,
          paddingLeft: padL, paddingRight: padR, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
          opacity: pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={iconSize} /> : null}
      <Txt size={size} weight={weight} numberOfLines={1}>{label}</Txt>
    </Pressable>
  );
}

// ---------- Motion ----------

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { reduceMotion = v; }).catch(() => {});

/** zmFade / zmPop / zmIn entry animations. */
export function Enter({ kind = 'fade', duration, delay = 0, style, children }: { kind?: 'fade' | 'pop' | 'in' | 'up' | 'rise'; duration?: number; delay?: number; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const v = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const easing = kind === 'pop' ? Easing.bezier(0.2, 0.8, 0.2, 1) : kind === 'fade' ? Easing.ease : Easing.bezier(0.2, 0.8, 0.2, 1);
    Animated.timing(v, { toValue: 1, duration: duration ?? (kind === 'pop' ? 550 : kind === 'rise' ? 420 : 300), delay, easing, useNativeDriver: true }).start();
  }, [v, kind, duration, delay]);
  let anim: object = { opacity: v };
  if (kind === 'pop') {
    anim = {
      opacity: v.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1] }),
      transform: [{ scale: v.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.4, 1.08, 1] }) }],
    };
  } else if (kind === 'in') {
    anim = { opacity: v, transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [32, 0] }) }] };
  } else if (kind === 'rise') {
    anim = { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] };
  } else if (kind === 'up') {
    anim = { transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [800, 0] }) }] };
  }
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

/** Shimmering loading placeholder (zmShimmer). */
export function Shimmer({ style }: { style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <View style={[{ overflow: 'hidden', backgroundColor: colors.shimmerA }, style]}>
      <Animated.View
        style={{
          position: 'absolute', top: 0, bottom: 0, width: 260, backgroundColor: colors.cream, opacity: 0.9,
          transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-260, 260] }) }],
        }}
      />
    </View>
  );
}

/** Three bouncing dots (zmDot). */
export function TypingDots() {
  const vals = [useRef(new Animated.Value(0.25)).current, useRef(new Animated.Value(0.25)).current, useRef(new Animated.Value(0.25)).current];
  useEffect(() => {
    const loops = vals.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 200),
          Animated.timing(v, { toValue: 1, duration: 480, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.25, duration: 480, useNativeDriver: true }),
          Animated.delay(240 - i * 200 > 0 ? 240 - i * 200 : 0),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {vals.map((v, i) => (
        <Animated.View key={i} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.gray600, opacity: v }} />
      ))}
    </View>
  );
}

/** Expanding ring behind the booking-sent badge (zmRing). */
const CONFETTI_COLORS = [colors.pink, colors.violet, colors.mint, colors.ink, colors.rose, '#FFC93C'];

/**
 * One-shot confetti burst from the centre of its parent (payment success).
 * Place it inside a box the size of the icon; pieces fly outward, fall and fade. Skipped with reduce motion.
 */
export function Confetti({ count = 28, spread = 170, delay = 120 }: { count?: number; spread?: number; delay?: number }) {
  const pieces = useRef(
    Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const dist = spread * (0.55 + Math.random() * 0.45);
      return {
        v: new Animated.Value(0),
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist * 0.8 - 40,
        fall: 90 + Math.random() * 80,
        spin: (Math.random() < 0.5 ? -1 : 1) * (240 + Math.random() * 360),
        w: i % 3 === 0 ? 9 : 7,
        h: i % 3 === 0 ? 9 : 14,
        round: i % 3 === 0,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        duration: 1100 + Math.random() * 500,
      };
    }),
  ).current;
  useEffect(() => {
    if (reduceMotion) return;
    Animated.stagger(8, pieces.map((p) => Animated.timing(p.v, { toValue: 1, duration: p.duration, delay, easing: Easing.out(Easing.quad), useNativeDriver: true }))).start();
  }, [pieces, delay]);
  if (reduceMotion) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
      {pieces.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute', width: p.w, height: p.h, borderRadius: p.round ? p.w / 2 : 2, backgroundColor: p.color,
            opacity: p.v.interpolate({ inputRange: [0, 0.08, 0.7, 1], outputRange: [0, 1, 1, 0] }),
            transform: [
              // Burst outward fast, then gravity takes over.
              { translateX: p.v.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, p.dx * 0.8, p.dx] }) },
              { translateY: p.v.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, p.dy * 0.8, p.dy + p.fall] }) },
              { rotate: p.v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.spin}deg`] }) },
              { scale: p.v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.3, 1, 0.8] }) },
            ],
          }}
        />
      ))}
    </View>
  );
}

export function Ring({ size, color }: { size: number; color: string }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    Animated.sequence([
      Animated.delay(350),
      Animated.timing(v, { toValue: 1, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
      Animated.timing(v, { toValue: 1, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    ]).start();
  }, [v]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.7] }) }],
      }}
    />
  );
}

// ---------- Layout helpers ----------

export const Row = ({ style, children }: { style?: StyleProp<ViewStyle>; children?: ReactNode }) => (
  <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>{children}</View>
);

export const Hairline = ({ style }: { style?: StyleProp<ViewStyle> }) => <View style={[{ height: 1, backgroundColor: colors.hairline }, style]} />;
