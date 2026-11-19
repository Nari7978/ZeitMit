// An incoming video date call, full screen over whatever is open, like a phone call: the other person is waiting in
// the call (or pinging you from it). Join now / Not now; it rings with sound and vibration until you answer or it
// stops (30 seconds, like a ring). With the app closed on Android, the phone's own incoming-call screen does this and
// opens the app here.
import { useEffect } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { endRing, useRing } from '../lib/ring';
import { startRinging, stopRinging } from '../lib/freeNow';
import { followGo } from '../nav';
import { nativeCalls } from '../../modules/zeitmit-calls';
import { Icon } from './Icon';
import { H, PressBox, Row, Txt } from './primitives';

const NIGHT = '#101012';

export function IncomingRing() {
  const ring = useRing((s) => s.ring);
  const insets = useSafeAreaInsets();
  const id = ring?.bookingId;
  useEffect(() => {
    if (!ring) return;
    // Shown here now: the phone's own ringing (Android, the app opened for it) stops, this one takes over.
    nativeCalls.endIncoming(ring.bookingId);
    startRinging();
    const stop = setTimeout(() => {
      endRing(ring.bookingId);
      nativeCalls.lockScreen(false);
    }, Math.max(0, ring.until * 1000 - Date.now()));
    return () => {
      clearTimeout(stop);
      stopRinging();
    };
  }, [ring]);
  if (!ring || !id) return null;

  const notNow = () => {
    endRing(id);
    nativeCalls.lockScreen(false);
  };
  const join = () => {
    endRing(id);
    void followGo(`call:${id}`);
  };
  return (
    <View testID="ring-banner" accessibilityViewIsModal accessibilityRole="alert" accessibilityLiveRegion="assertive"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 120, backgroundColor: NIGHT, paddingTop: insets.top + 18, paddingBottom: insets.bottom + 18, paddingHorizontal: 20 }}>
      <View style={{ alignItems: 'center' }}>
        <Row style={{ gap: 8, backgroundColor: colors.sun, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16 }}>
          <Icon name="video" size={16} />
          <Txt size={14} weight={700}>Video date</Txt>
        </Row>
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <View style={{ width: 196, height: 196, borderRadius: 98, borderWidth: 6, borderColor: colors.mint, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 168, height: 168, borderRadius: 84, backgroundColor: colors.lilac, alignItems: 'center', justifyContent: 'center' }}>
            <Txt raw size={64} weight={700}>{ring.who.slice(0, 1).toUpperCase()}</Txt>
          </View>
        </View>
        <View style={{ alignItems: 'center', gap: 6, paddingHorizontal: 8 }}>
          <H size={32} color={colors.white} numberOfLines={1}>{ring.who}</H>
          <Txt size={16} lh={1.4} color={colors.gray300} align="center">
            {ring.why === 'ping' ? 'is pinging you from your video date' : 'is waiting in your video date'}
          </Txt>
        </View>
      </View>

      <Row style={{ gap: 12 }}>
        <PressBox fx="push" onPress={notNow} accessibilityRole="button" accessibilityLabel="Not now"
          style={{ flex: 1, height: 62, borderRadius: 16, borderWidth: 2, borderColor: 'rgba(255,255,255,.85)', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}>
          <Icon name="x" size={20} color={colors.white} />
          <Txt size={17} weight={700} color={colors.white} numberOfLines={1}>Not now</Txt>
        </PressBox>
        <PressBox fx="push" onPress={join} accessibilityRole="button" accessibilityLabel="Join now"
          style={{ flex: 1, height: 62, borderRadius: 16, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}>
          <Icon name="video" size={20} />
          <Txt size={17} weight={700} numberOfLines={1}>Join now</Txt>
        </PressBox>
      </Row>
      <Txt size={12} color={colors.gray400} align="center" style={{ marginTop: 12 }}>Rings with sound and vibration until you answer</Txt>
    </View>
  );
}
