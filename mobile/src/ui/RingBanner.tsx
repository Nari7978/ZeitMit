// An incoming video date call, over whatever screen is open: who's waiting, Join now / Not now, and the phone
// vibrates while it rings. (With the app closed, the push notification does this.)
import { useEffect } from 'react';
import { Pressable, Vibration, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { endRing, useRing } from '../lib/ring';
import { followGo } from '../nav';
import { t } from '../i18n';
import { Icon } from './Icon';
import { Txt } from './primitives';

const NIGHT = '#101012';
/** Buzz, short pause, buzz, long pause; repeated while it rings (iPhones keep their own rhythm). */
const BUZZ = [0, 450, 250, 450, 1400];

export function RingBanner() {
  const ring = useRing((s) => s.ring);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!ring) return;
    try { Vibration.vibrate(BUZZ, true); } catch { /* no vibration here */ }
    const stop = setTimeout(() => endRing(ring.bookingId), Math.max(0, ring.until * 1000 - Date.now()));
    return () => {
      clearTimeout(stop);
      try { Vibration.cancel(); } catch { /* no vibration here */ }
    };
  }, [ring]);
  if (!ring) return null;

  const join = () => {
    endRing(ring.bookingId);
    void followGo(`call:${ring.bookingId}`);
  };
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12, zIndex: 100, alignItems: 'center' }}>
      <View
        testID="ring-banner" accessibilityRole="alert" accessibilityLiveRegion="assertive"
        style={{
          width: '100%', maxWidth: 440, padding: 14, gap: 12, borderRadius: 22, backgroundColor: NIGHT,
          shadowColor: 'rgb(18,14,38)', shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 14,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 46, height: 46, borderRadius: 16, backgroundColor: colors.lilac, alignItems: 'center', justifyContent: 'center' }}>
            <Txt raw size={20} weight={700}>{ring.who.slice(0, 1).toUpperCase()}</Txt>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt raw size={16} weight={700} color={colors.white} numberOfLines={1}>{ring.who}</Txt>
            <Txt size={13} lh={1.35} color="rgba(255,255,255,.78)" numberOfLines={2}>
              {ring.why === 'ping' ? 'is pinging you from your video date' : 'is waiting in your video date'}
            </Txt>
          </View>
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(46,209,154,.18)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="bell-ring" size={18} color={colors.mint} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable
            accessibilityRole="button" accessibilityLabel={t('Not now')} onPress={() => endRing(ring.bookingId)}
            style={({ pressed }) => ({ flex: 1, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,.14)', alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}
          >
            <Txt size={14} weight={700} color={colors.white} numberOfLines={1}>Not now</Txt>
          </Pressable>
          <Pressable
            accessibilityRole="button" accessibilityLabel={t('Join now')} onPress={join}
            style={({ pressed }) => ({ flex: 1.4, height: 44, borderRadius: 14, backgroundColor: colors.mint, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}
          >
            <Icon name="video" size={16} color={colors.ink} />
            <Txt size={14} weight={700} numberOfLines={1}>Join now</Txt>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
