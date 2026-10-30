// Playful pieces for the home screen: a sticker with a hard shadow, the headline word that keeps changing,
// and a slowly sliding row of companion faces. Loops pause while the screen isn't visible or motion is reduced.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../theme';
import { type Companion } from '../data';
import { motionOff, Photo, Txt } from './primitives';

/**
 * A content-sized box with the design's hard offset shadow. Unlike Box it never stretches its face, so it stays as
 * small as its content even where the parent leaves room (Android would otherwise grow it).
 */
export function Sticker({ children, shadow = 4, shadowColor = colors.ink, radius = 16, style }: {
  children: ReactNode; shadow?: number; shadowColor?: string; radius?: number; style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={{ alignSelf: 'flex-start' }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: shadow, left: shadow, right: -shadow, bottom: -shadow, borderRadius: radius, backgroundColor: shadowColor }} />
      <View style={[{ borderRadius: radius, borderWidth: 2.5, borderColor: colors.ink }, style]}>{children}</View>
    </View>
  );
}

export type SwapWord = { text: string; bg: string; fg: string };

/** The headline's last word: pops in on a coloured sticker, then makes room for the next one. */
export function WordSwap({ words, running, size = 40 }: { words: SwapWord[]; running: boolean; size?: number }) {
  const [i, setI] = useState(0);
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!running || motionOff() || words.length < 2) return;
    const timer = setInterval(() => {
      Animated.timing(v, { toValue: 0, duration: 170, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => {
        setI((x) => (x + 1) % words.length);
        Animated.spring(v, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true }).start();
      });
    }, 2300);
    return () => clearInterval(timer);
  }, [running, words.length, v]);
  const w = words[i % words.length];
  const tilt = i % 2 ? '1.5deg' : '-2deg';
  return (
    <Animated.View
      style={{
        alignSelf: 'flex-start', marginTop: 8, opacity: v,
        transform: [{ rotate: tilt }, { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }, { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
      }}
    >
      <Sticker shadow={5} radius={18} style={{ paddingHorizontal: 14, paddingTop: 2, paddingBottom: 6, backgroundColor: w.bg }}>
        <Txt kind="display" weight={800} size={size} lh={size * 1.12} ls={-0.05} color={w.fg} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{w.text}</Txt>
      </Sticker>
    </Animated.View>
  );
}

const FACE = 64;
const GAP = 14;

/**
 * Companion faces drifting by. With only a few companions they sit still (repeating three faces would look empty);
 * tap a face to open the profile.
 */
export function FaceMarquee({ people, running, onOpen }: { people: Companion[]; running: boolean; onOpen: (id: string) => void }) {
  const x = useRef(new Animated.Value(0)).current;
  const moving = people.length >= 4 && running && !motionOff();
  const width = people.length * (FACE + GAP);
  useEffect(() => {
    if (!moving) return;
    x.setValue(0);
    const loop = Animated.loop(Animated.timing(x, { toValue: -width, duration: people.length * 2600, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [moving, width, people.length, x]);
  const row = moving ? [...people, ...people] : people;
  return (
    <View style={{ overflow: 'hidden' }}>
      <Animated.View style={{ flexDirection: 'row', gap: GAP, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 6, transform: [{ translateX: x }] }}>
        {row.map((c, k) => (
          <Pressable key={c.id + ':' + k} accessibilityRole="button" accessibilityLabel={c.name} onPress={() => onOpen(c.id)} style={{ width: FACE, alignItems: 'center', gap: 6 }}>
            <View style={{ width: FACE, height: FACE, borderRadius: FACE / 2, borderWidth: 2.5, borderColor: colors.ink, overflow: 'hidden', backgroundColor: colors.white, transform: [{ rotate: k % 2 ? '4deg' : '-4deg' }] }}>
              <Photo hue={c.hue} url={c.photoUrl} />
            </View>
            <Txt size={12} weight={600} numberOfLines={1}>{c.name}</Txt>
          </Pressable>
        ))}
        {!moving ? (
          <View style={{ width: FACE, alignItems: 'center', gap: 6 }}>
            <View style={{ width: FACE, height: FACE, borderRadius: FACE / 2, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
              <Txt kind="display" weight={800} size={22}>+</Txt>
            </View>
            <Txt size={12} weight={600} color={colors.gray600} numberOfLines={1}>More soon</Txt>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}
