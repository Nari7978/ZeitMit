import { useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { AM, ageStr, eur } from '../data';
import { useStore } from '../store';
import { openBooking } from '../nav';
import { Icon } from '../ui/Icon';
import { Box, Enter, H, PressBox, Row, Stripes, Txt, Photo } from '../ui/primitives';
import { CircleButton, useTopPad } from '../ui/common';

export default function Swipe() {
  const top = useTopPad();
  const insets = useSafeAreaInsets();
  const C = useStore((s) => s.companions);
  const [i, setI] = useState(0);
  const dx = useRef(new Animated.Value(0)).current;
  const busy = useRef(false);
  const idx = useRef(0);
  idx.current = i;
  const listRef = useRef(C);
  listRef.current = C;

  const cur = C[i];
  const nxt = C[i + 1];

  const go = (dir: 'left' | 'right') => {
    const c = listRef.current[idx.current];
    if (busy.current || !c) return;
    busy.current = true;
    if (dir === 'right' && !useStore.getState().saved.includes(c.id)) useStore.getState().toggleSave(c.id);
    Animated.timing(dx, { toValue: dir === 'left' ? -520 : 520, duration: 300, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: true }).start(() => {
      dx.setValue(0);
      busy.current = false;
      setI((x) => x + 1);
    });
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderMove: (_, g) => { if (!busy.current) dx.setValue(g.dx); },
        onPanResponderRelease: (_, g) => {
          if (g.dx > 100) go('right');
          else if (g.dx < -100) go('left');
          else Animated.spring(dx, { toValue: 0, useNativeDriver: true }).start();
        },
        onPanResponderTerminate: () => Animated.spring(dx, { toValue: 0, useNativeDriver: true }).start(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const rotate = dx.interpolate({ inputRange: [-520, 520], outputRange: ['-28.9deg', '28.9deg'] });
  const likeOp = dx.interpolate({ inputRange: [0, 90], outputRange: [0, 1], extrapolate: 'clamp' });
  const passOp = dx.interpolate({ inputRange: [-90, 0], outputRange: [1, 0], extrapolate: 'clamp' });

  return (
    <View style={{ flex: 1, backgroundColor: colors.sun }}>
      <Row style={{ paddingTop: top, paddingHorizontal: 16, gap: 10 }}>
        <CircleButton icon="x" label="Close" size={44} iconSize={20} onPress={() => router.back()} />
        <H size={24} ls={-0.03} style={{ flex: 1 }}>Swipe mode</H>
        {cur ? (
          <View style={{ height: 32, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.ink, justifyContent: 'center' }}>
            <Txt size={13} weight={700} color={colors.sun}>{Math.min(i + 1, C.length)} / {C.length}</Txt>
          </View>
        ) : null}
      </Row>

      {cur ? (
        <>
          <View style={{ flex: 1, marginTop: 18, marginHorizontal: 22 }}>
            {nxt ? (
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 30, borderWidth: 2.5, borderColor: colors.ink, overflow: 'hidden', transform: [{ translateY: 14 }, { scale: 0.94 }] }}>
                <Photo hue={nxt.hue} url={nxt.photoUrl} />
              </View>
            ) : null}
            <Animated.View {...pan.panHandlers} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, transform: [{ translateX: dx }, { rotate }] }}>
              <Box shadow={6} style={{ flex: 1, borderRadius: 30 }}>
                <View style={{ flex: 1, borderRadius: 30, borderWidth: 2.5, borderColor: colors.ink, overflow: 'hidden' }}>
                  <Photo hue={cur.hue} url={cur.photoUrl} />
                  <Txt kind="mono" size={10} weight={500} lh={1.4} color="rgba(17,17,17,.5)" style={{ position: 'absolute', top: 18, left: 18, right: 120 }}>{cur.photoUrl ? '' : cur.photo}</Txt>
                  <Animated.View style={[stamp, { left: 20, backgroundColor: colors.mint, opacity: likeOp, transform: [{ rotate: '-12deg' }] }]}>
                    <H size={28}>LIKE</H>
                  </Animated.View>
                  <Animated.View style={[stamp, { right: 20, backgroundColor: colors.white, opacity: passOp, transform: [{ rotate: '12deg' }] }]}>
                    <H size={28}>PASS</H>
                  </Animated.View>
                  <View style={{ position: 'absolute', left: 12, right: 12, bottom: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 22, backgroundColor: colors.white, borderWidth: 2.5, borderColor: colors.ink, gap: 6 }}>
                    <Row style={{ justifyContent: 'space-between', gap: 8 }}>
                      <H size={28} ls={-0.03} numberOfLines={1} style={{ flexShrink: 1 }}>{cur.name}{ageStr(cur)}</H>
                      <Txt size={13}><Txt size={18} weight={700}>{eur(cur.rate)}</Txt>/h</Txt>
                    </Row>
                    <Txt size={14} color={colors.gray800}>{cur.tagline}</Txt>
                    <Row style={{ gap: 6, flexWrap: 'wrap' }}>
                      {cur.acts.slice(0, 3).map((a) => (
                        <View key={a} style={{ height: 26, paddingHorizontal: 10, borderRadius: 999, backgroundColor: colors.butter, borderWidth: 1.5, borderColor: colors.ink, justifyContent: 'center' }}>
                          <Txt size={12} weight={600}>{AM[a].label}</Txt>
                        </View>
                      ))}
                    </Row>
                    <Pressable accessibilityRole="link" onPress={() => router.replace({ pathname: '/profile/[id]', params: { id: cur.id } })} style={{ alignSelf: 'flex-start', paddingTop: 4 }}>
                      <Txt size={13} weight={700} style={{ textDecorationLine: 'underline' }}>View full profile</Txt>
                    </Pressable>
                  </View>
                </View>
              </Box>
            </Animated.View>
          </View>
          <Row style={{ justifyContent: 'center', gap: 20, paddingTop: 26, paddingBottom: Math.max(40, insets.bottom + 16) }}>
            <RoundAction label="Pass" icon="x" size={62} iconSize={26} bg={colors.white} fg={colors.ink} onPress={() => go('left')} />
            <RoundAction
              label="Book"
              icon="calendar-plus"
              size={54}
              iconSize={22}
              bg={colors.ink}
              fg={colors.sun}
              onPress={() => {
                router.replace({ pathname: '/profile/[id]', params: { id: cur.id } });
                openBooking(cur.id);
              }}
            />
            <RoundAction label="Like" icon="heart" size={74} iconSize={30} bg={colors.pink} fg={colors.white} onPress={() => go('right')} />
          </Row>
        </>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingBottom: 60, gap: 12 }}>
          <Enter kind="pop">
            <Box shadow={4} style={{ width: 96, height: 96, borderRadius: 30, borderWidth: 2.5, borderColor: colors.ink, backgroundColor: colors.pink, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="party-popper" size={40} color={colors.white} />
            </Box>
          </Enter>
          <H size={30} ls={-0.03} align="center">{C.length ? 'That’s everyone for now' : 'No companions yet'}</H>
          <Txt size={15} color={colors.gray800} align="center">{C.length ? 'New companions join Berlin every week.' : 'We’re reviewing the first profiles now. Check back soon.'}</Txt>
          {!C.length ? (
            <PressBox shadow={4} fx="push" onPress={() => router.back()} style={[endBtn, { marginTop: 10 }]}><Txt size={15} weight={700}>Back to Discover</Txt></PressBox>
          ) : (
          <Row style={{ gap: 10, marginTop: 10 }}>
            <PressBox shadow={4} fx="push" onPress={() => setI(0)} style={endBtn}><Txt size={15} weight={700}>Start again</Txt></PressBox>
            <PressBox shadow={4} fx="push" onPress={() => { router.back(); useStore.getState().openSheet('saved'); }} style={[endBtn, { backgroundColor: colors.ink }]}>
              <Txt size={15} weight={700} color={colors.white}>See who I liked</Txt>
            </PressBox>
          </Row>
          )}
        </View>
      )}
    </View>
  );
}

const stamp = { position: 'absolute' as const, top: 22, paddingVertical: 4, paddingHorizontal: 12, borderWidth: 3, borderColor: colors.ink, borderRadius: 12 };
const endBtn = { height: 50, paddingHorizontal: 18, borderRadius: 16, borderWidth: 2.5, borderColor: colors.ink, backgroundColor: colors.white, justifyContent: 'center' as const };

function RoundAction({ label, icon, size, iconSize, bg, fg, onPress }: { label: string; icon: string; size: number; iconSize: number; bg: string; fg: string; onPress: () => void }) {
  return (
    <PressBox shadow={4} fx="push" accessibilityLabel={label} onPress={onPress} style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2.5, borderColor: colors.ink, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={iconSize} color={fg} />
    </PressBox>
  );
}
