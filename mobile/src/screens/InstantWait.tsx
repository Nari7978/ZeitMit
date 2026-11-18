// A video date now, after paying: "Calling Anna…" with the 2-minute countdown, then either "Anna accepted!" (join the
// call) or the money back at once, with others who are free now. Follows the booking live (and asks again meanwhile).
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Svg, { Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { eur, hours } from '../data';
import { useStore } from '../store';
import { goBack, openInstant } from '../nav';
import { Icon } from '../ui/Icon';
import { H, PressBox, Row, Txt, Photo } from '../ui/primitives';
import { CircleButton, PrimaryButton } from '../ui/common';
import { FreeNowPill } from '../ui/FreeNowPill';

const REPLY_S = 120;

export default function InstantWait() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const b = useStore((s) => s.bookings.find((x) => x.id === id));
  const c = useStore((s) => (b ? s.byId[b.cid] : undefined));
  const companions = useStore((s) => s.companions);
  const others = useMemo(() => companions.filter((x) => x.freeNow && x.id !== b?.cid).slice(0, 3), [companions, b?.cid]);
  const [t, setT] = useState(() => Date.now() / 1000);
  const [cancelling, setCancelling] = useState(false);
  const insets = useSafeAreaInsets();
  const pending = b?.status === 'pending';

  // While it waits: a clock for the countdown, and the bookings asked again now and then (live updates come first).
  const known = !!b;
  useEffect(() => {
    if (known && !pending) return;
    const tick = setInterval(() => setT(Date.now() / 1000), 500);
    const ask = setInterval(() => void useStore.getState().refresh(), 4000);
    return () => { clearInterval(tick); clearInterval(ask); };
  }, [known, pending]);
  // The 2 minutes are up: ask now, so it closes (and the money comes back) without waiting for the next round.
  const left = b?.expiresAt ? Math.max(0, Math.ceil(b.expiresAt - t)) : REPLY_S;
  useEffect(() => {
    if (pending && left === 0) void useStore.getState().refresh();
  }, [pending, left]);

  const name = b?.companionName ?? c?.name ?? '';
  const photo = (size: number) => (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: colors.blush }}>
      {c ? <Photo hue={c.hue} url={c.photoUrl} style={{ width: size, height: size }} /> : null}
    </View>
  );
  const top = (
    <Row style={{ paddingTop: insets.top + 8, paddingHorizontal: 18, justifyContent: 'space-between' }}>
      <CircleButton icon="x" label="Close" onPress={() => (router.canGoBack() ? goBack() : router.replace('/'))} />
      <Txt size={14} weight={700}>Video date now</Txt>
      <View style={{ width: 44 }} />
    </Row>
  );

  if (!b) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.sun }}>
        {top}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.ink} /></View>
      </View>
    );
  }

  if (pending) {
    const R = 76, C = 2 * Math.PI * R;
    const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    const cancel = async () => {
      if (cancelling) return;
      setCancelling(true);
      await useStore.getState().cancelBooking(b.id, 'Plans changed');
      setCancelling(false);
    };
    return (
      <View style={{ flex: 1, backgroundColor: colors.sun }}>
        {top}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, gap: 6 }}>
          <View style={{ width: 2 * R + 76, height: 2 * R + 76, borderRadius: R + 38, backgroundColor: 'rgba(17,17,17,.06)', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <View style={{ width: 2 * R + 40, height: 2 * R + 40, borderRadius: R + 20, backgroundColor: 'rgba(17,17,17,.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={2 * R + 12} height={2 * R + 12} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
                <Circle cx={R + 6} cy={R + 6} r={R} stroke="rgba(17,17,17,.12)" strokeWidth={6} fill="none" />
                <Circle cx={R + 6} cy={R + 6} r={R} stroke={colors.ink} strokeWidth={6} fill="none" strokeLinecap="round" strokeDasharray={`${C}`} strokeDashoffset={C * (1 - Math.min(1, left / REPLY_S))} />
              </Svg>
              {photo(2 * R - 18)}
            </View>
          </View>
          <H size={30} align="center">{`Calling ${name}…`}</H>
          <H size={58} accessibilityLabel={`${left} seconds left`}>{clock}</H>
          <Txt size={15} align="center">{`${name} has 2 minutes to accept`}</Txt>
          <Row style={{ alignSelf: 'stretch', gap: 12, marginTop: 18, padding: 16, borderRadius: 18, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.white, alignItems: 'flex-start' }}>
            <Icon name="lock" size={20} />
            <Txt size={14} lh={1.45} style={{ flex: 1 }}>{`${eur(b.total / 100)} is held by ZeitMit. If ${name} doesn’t accept in time, it all comes back to you at once.`}</Txt>
          </Row>
        </View>
        <PressBox onPress={() => void cancel()} accessibilityLabel="Cancel request" disabled={cancelling} style={{ alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 20, marginBottom: insets.bottom + 18 }}>
          {cancelling ? <ActivityIndicator color={colors.roseDeep} /> : <Txt size={15} weight={700} color={colors.roseDeep}>Cancel request</Txt>}
        </PressBox>
      </View>
    );
  }

  if (b.status === 'confirmed' || b.status === 'completed') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.sun }}>
        {top}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 12 }}>
          <View style={{ width: 112, height: 112, borderRadius: 56, backgroundColor: colors.mint, borderWidth: 3, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={54} strokeWidth={3} />
          </View>
          <H size={34} align="center" style={{ marginTop: 10 }}>{`${name} accepted!`}</H>
          <Txt size={16} weight={600} align="center">{`Your video date starts now (${hours(b.dur)}).`}</Txt>
          <Row style={{ alignSelf: 'stretch', gap: 12, marginTop: 18, padding: 14, borderRadius: 20, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.white }}>
            {photo(52)}
            <View style={{ flex: 1 }}>
              <Txt size={16} weight={700}>{`${name} · Video date`}</Txt>
              <Txt size={13} color={colors.gray600}>{`${hours(b.dur)} · until ${b.end}`}</Txt>
            </View>
          </Row>
        </View>
        <View style={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 18, gap: 10 }}>
          <PrimaryButton label="Join video date" icon="video" bg={colors.mint} fg={colors.ink} shadowColor={colors.ink} onPress={() => router.replace(`/call/${b.id}`)} />
          <Txt size={13} color={colors.gray600} align="center">You pay only for the minutes you’re both there.</Txt>
        </View>
      </View>
    );
  }

  // Not answered, declined, cancelled or not free any more: the money comes back, and others are free now.
  const title = b.status === 'expired' ? `${name} couldn’t answer in time` : b.status === 'rejected' ? `${name} can’t take it right now`
    : b.status === 'conflicted' ? `${name} isn’t free right now` : 'Request cancelled';
  return (
    <View style={{ flex: 1, backgroundColor: colors.sun }}>
      {top}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 30, paddingBottom: insets.bottom + 30, gap: 12 }}>
        <View style={{ alignItems: 'center', gap: 10 }}>
          <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: colors.white, borderWidth: 3, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="hourglass" size={40} strokeWidth={2.4} />
          </View>
          <H size={28} align="center">{title}</H>
        </View>
        <Row style={{ gap: 12, padding: 16, borderRadius: 18, backgroundColor: colors.mintSoft, marginTop: 8 }}>
          <Icon name="circle-check" size={22} color={colors.greenDeep} />
          <View style={{ flex: 1 }}>
            <Txt size={15} weight={700}>{`${eur((b.refunded || b.total) / 100)} back in full`}</Txt>
            <Txt size={13} color={colors.gray800}>Nothing was charged.</Txt>
          </View>
        </Row>
        {others.length ? <Txt size={17} weight={700} style={{ marginTop: 14 }}>Free now for a video date</Txt> : null}
        {others.map((o) => (
          <View key={o.id} style={{ gap: 12, padding: 12, borderRadius: 20, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.white }}>
            <Row style={{ gap: 12 }}>
              <View style={{ width: 56, height: 56, borderRadius: 14, overflow: 'hidden' }}><Photo hue={o.hue} url={o.photoUrl} style={{ width: 56, height: 56 }} /></View>
              <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
                <Row style={{ gap: 8, justifyContent: 'space-between' }}>
                  <Txt size={16} weight={700} numberOfLines={1} style={{ flexShrink: 1 }}>{o.name}</Txt>
                  <Txt size={13} color={colors.gray600}>{`${eur(o.rate)} / hour`}</Txt>
                </Row>
                <FreeNowPill short />
              </View>
            </Row>
            <PrimaryButton label="Video date now" icon="video" height={42} size={14} radius={12} onPress={() => openInstant(o.id, o.freeNow!.max)} />
          </View>
        ))}
        {!others.length ? (
          <PrimaryButton label="Find someone else" onPress={() => router.replace('/search')} style={{ marginTop: 14 }} />
        ) : null}
      </ScrollView>
    </View>
  );
}
