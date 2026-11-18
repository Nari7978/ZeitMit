// A free-now video date request, full screen over whatever is open (like an incoming ride request): who, how long,
// what you earn, a 2-minute countdown, Decline / Accept. It rings with a ringtone and vibration until it's answered or
// the time is up. (With the app closed, the push notification rings instead.)
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router } from 'expo-router';
import Svg, { Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { eur, hours } from '../data';
import { hueOf, useStore, type CompBooking } from '../store';
import { startRinging, stopRinging } from '../lib/freeNow';
import { Initial } from '../screens/companion/Shell';
import { Icon } from './Icon';
import { H, PressBox, Row, Txt } from './primitives';

const NIGHT = '#101012';
const REPLY_S = 120;
/** Requests answered (or let go) on this phone: they stay out while the lists catch up. */
const handled = new Set<string>();

/** The open free-now request, if any (the oldest, with time left). */
const pick = (requests: CompBooking[], t: number) => requests.find((r) => r.instant && !handled.has(r.id) && (r.expiresAt ?? 0) > t) ?? null;

export function InstantRequest() {
  const requests = useStore((s) => s.comp.requests);
  const [t, setT] = useState(() => Date.now() / 1000);
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const insets = useSafeAreaInsets();
  const req = pick(requests, t);
  const id = req?.id;

  // A clock for the countdown while one is open; at 0 it goes (and the lists are asked again).
  useEffect(() => {
    if (!id) return;
    const iv = setInterval(() => setT(Date.now() / 1000), 500);
    return () => clearInterval(iv);
  }, [id]);
  useEffect(() => {
    if (!id) return;
    startRinging();
    return () => stopRinging();
  }, [id]);
  useEffect(() => {
    if (req || !requests.some((r) => r.instant && (r.expiresAt ?? 0) <= t && !handled.has(r.id))) return;
    // The time is up for one still listed: ask again, so it shows as missed and the customer gets their money back.
    for (const r of requests) if (r.instant && (r.expiresAt ?? 0) <= t) handled.add(r.id);
    void useStore.getState().loadCompanionSide();
  }, [req, requests, t]);
  if (!req) return null;

  const left = Math.max(0, Math.ceil((req.expiresAt ?? t) - t));
  const share = Math.min(1, left / REPLY_S);
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  const since = req.customer?.since ? new Date(req.customer.since * 1000).getFullYear() : null;
  const accept = async () => {
    if (busy) return;
    setBusy('accept');
    stopRinging();
    const ok = await useStore.getState().acceptRequest(req.id);
    handled.add(req.id);
    setBusy(null);
    if (ok) router.push(`/call/${req.id}`);
  };
  const decline = async () => {
    if (busy) return;
    setBusy('decline');
    stopRinging();
    handled.add(req.id);
    await useStore.getState().declineRequest(req.id);
    setBusy(null);
  };
  const R = 74, C = 2 * Math.PI * R;
  return (
    <View testID="instant-request" accessibilityViewIsModal accessibilityRole="alert" accessibilityLiveRegion="assertive"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 120, backgroundColor: NIGHT, paddingTop: insets.top + 18, paddingBottom: insets.bottom + 18, paddingHorizontal: 20 }}>
      <View style={{ alignItems: 'center', gap: 6 }}>
        <Row style={{ gap: 8, backgroundColor: colors.sun, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16 }}>
          <Icon name="bell-ring" size={16} />
          <Txt size={14} weight={700}>New video date request</Txt>
        </Row>
        <Txt size={13} color={colors.gray300}>Answer within 2 minutes</Txt>
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        <View style={{ width: 2 * R + 16, height: 2 * R + 16, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={2 * R + 16} height={2 * R + 16} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
            <Circle cx={R + 8} cy={R + 8} r={R} stroke="rgba(255,255,255,.14)" strokeWidth={6} fill="none" />
            <Circle cx={R + 8} cy={R + 8} r={R} stroke={colors.mint} strokeWidth={6} fill="none" strokeLinecap="round" strokeDasharray={`${C}`} strokeDashoffset={C * (1 - share)} />
          </Svg>
          <Initial who={req.who} hue={hueOf(req.customerId)} url={req.avatarUrl} size={2 * R - 16} radius={R} fontSize={52} />
        </View>
        <H size={40} color={colors.white} accessibilityLabel={`${left} seconds left`}>{clock}</H>
        <View style={{ alignItems: 'center', gap: 6 }}>
          <H size={30} color={colors.white} numberOfLines={1}>{req.who}</H>
          <Row style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {req.customer?.verified ? (
              <Row style={{ gap: 5, backgroundColor: 'rgba(46,209,154,.14)', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 }}>
                <Icon name="badge-check" size={15} color={colors.mint} />
                <Txt size={13} weight={700} color={colors.mint}>ID verified</Txt>
              </Row>
            ) : null}
            {since ? <Txt size={13} color={colors.gray300}>{`Member since ${since}`}</Txt> : null}
          </Row>
        </View>
        <View style={{ alignSelf: 'stretch', backgroundColor: colors.white, borderRadius: 22, padding: 16, gap: 8 }}>
          <Row style={{ gap: 10 }}><Icon name="video" size={18} /><Txt size={15} weight={700}>{`Video date · ${hours(req.dur)}`}</Txt></Row>
          <Row style={{ gap: 10 }}><Icon name="clock" size={18} /><Txt size={15}>Starts as soon as you accept</Txt></Row>
          <View style={{ height: 1, backgroundColor: colors.hairline, marginVertical: 4 }} />
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
            <View>
              <Txt size={13} color={colors.gray600}>You earn</Txt>
              <H size={34} color={colors.greenDeep}>{eur(req.payout / 100)}</H>
            </View>
            <Txt size={12} color={colors.gray600} align="right" style={{ flex: 1 }}>Already paid and held by ZeitMit</Txt>
          </Row>
        </View>
      </View>

      <Row style={{ gap: 12 }}>
        <PressBox fx="push" onPress={() => void decline()} accessibilityLabel="Decline" disabled={!!busy}
          style={{ flex: 1, height: 62, borderRadius: 16, borderWidth: 2, borderColor: 'rgba(255,255,255,.85)', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}>
          {busy === 'decline' ? <ActivityIndicator color={colors.white} /> : <><Icon name="x" size={20} color={colors.white} /><Txt size={17} weight={700} color={colors.white}>Decline</Txt></>}
        </PressBox>
        <PressBox fx="push" onPress={() => void accept()} accessibilityLabel="Accept" disabled={!!busy}
          style={{ flex: 1, height: 62, borderRadius: 16, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}>
          {busy === 'accept' ? <ActivityIndicator color={colors.ink} /> : <><Icon name="check" size={20} /><Txt size={17} weight={700}>Accept</Txt></>}
        </PressBox>
      </Row>
      <Txt size={12} color={colors.gray400} align="center" style={{ marginTop: 12 }}>Rings with sound and vibration until you answer</Txt>
    </View>
  );
}
