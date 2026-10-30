// App chrome: floating nav bar, check-in bar and toast.
import { useEffect, useRef } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { colors } from '../theme';
import { useStore } from '../store';
import { Icon } from './Icon';
import { Box, Enter, Txt } from './primitives';
import { locale, t } from '../i18n';

const clock = (unix: number) => new Intl.DateTimeFormat(locale(), { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(unix * 1000));

/** Distance of the floating nav bar from the bottom edge (22px in the design). */
export function useNavBottom() {
  return Math.max(22, useSafeAreaInsets().bottom);
}

type NavDef = { name: string; label: string; icon: string; badge?: number };

export function NavBar({ state, navigateToTab, items }: BottomTabBarProps & { items: NavDef[] }) {
  const bottom = useNavBottom();
  return (
    <View
      style={{
        position: 'absolute', left: 14, right: 14, bottom, height: 66, paddingHorizontal: 4, borderRadius: 999, backgroundColor: colors.ink,
        flexDirection: 'row', shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 10 }, elevation: 12,
      }}
    >
      {items.map((it) => {
        const idx = state.routes.findIndex((r) => r.name === it.name);
        const on = state.index === idx;
        const color = on ? colors.sun : colors.gray350;
        return (
          <Pressable
            key={it.name}
            accessibilityRole="tab"
            accessibilityLabel={it.label}
            accessibilityState={{ selected: on }}
            onPress={() => {
              useStore.getState().closeSheet();
              if (!on) navigateToTab(state.routes[idx].key);
            }}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 }}
          >
            <View style={{ width: 56, height: 30, alignItems: 'center', justifyContent: 'center' }}>
              {/* The highlight keeps its colour and only shows or hides: Android drops the rounded corners of a
                  background that was transparent when the tab first rendered. */}
              <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 15, backgroundColor: 'rgba(255,233,77,.14)', opacity: on ? 1 : 0 }} />
              <Icon name={it.icon} size={21} color={color} />
              {it.badge ? (
                <View style={{ position: 'absolute', top: -2, right: 8, minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: 999, backgroundColor: colors.red, borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
                  <Txt size={10} weight={700} color={colors.white}>{it.badge}</Txt>
                </View>
              ) : null}
            </View>
            <Txt size={11} weight={on ? 700 : 500} color={color}>{it.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function CustomerNavBar(props: BottomTabBarProps) {
  const pending = useStore((s) => s.bookings.filter((b) => b.status === 'pending').length);
  const unread = useStore((s) => s.convos.reduce((a, c) => a + c.unread, 0));
  return (
    <NavBar
      {...props}
      items={[
        { name: 'index', label: 'Discover', icon: 'compass' },
        { name: 'search', label: 'Search', icon: 'search' },
        { name: 'bookings', label: 'Bookings', icon: 'calendar-days', badge: pending },
        { name: 'messages', label: 'Messages', icon: 'message-circle', badge: unread },
        { name: 'account', label: 'Profile', icon: 'circle-user' },
      ]}
    />
  );
}

export function CompanionNavBar(props: BottomTabBarProps) {
  const reqs = useStore((s) => s.comp.requests.length);
  const unread = useStore((s) => s.compConvos.reduce((a, c) => a + c.unread, 0));
  return (
    <NavBar
      {...props}
      items={[
        { name: 'index', label: 'Overview', icon: 'layout-dashboard' },
        { name: 'requests', label: 'Requests', icon: 'inbox', badge: reqs },
        { name: 'calendar', label: 'Calendar', icon: 'calendar-range' },
        { name: 'inbox', label: 'Messages', icon: 'message-circle', badge: unread },
        { name: 'listing', label: 'Profile', icon: 'circle-user' },
      ]}
    />
  );
}

/** Green "Check-in on" bar shown above the nav while a safety check-in runs. */
export function CheckinBar() {
  const checkin = useStore((s) => s.checkin);
  const sheet = useStore((s) => s.sheet);
  // While a check-in runs with sharing on, update the location every 5 minutes.
  useEffect(() => {
    if (!checkin) return;
    const t = setInterval(() => void useStore.getState().sendLocation(), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [checkin]);
  const bottom = useNavBottom() + 78;
  if (!checkin || sheet) return null;
  const { checkinOk, openSheet } = useStore.getState();
  const state = checkin.status;
  const bg = state === 'sos' ? colors.pink : state === 'alerted' ? '#FFC93C' : colors.mint;
  const line = state === 'sos' ? 'SOS sent · tap for help' : state === 'alerted' ? 'Missed check-in · tap “I’m OK”' : checkin.nextDue ? 'Next check-in ' + clock(checkin.nextDue) : 'Check in at the end';
  return (
    <Enter style={{ position: 'absolute', left: 14, right: 14, bottom, zIndex: 45 }}>
      <Box shadow={4} style={{ paddingVertical: 10, paddingRight: 10, paddingLeft: 14, borderRadius: 20, backgroundColor: bg, borderWidth: 2.5, borderColor: colors.ink, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Share live link')} onPress={() => openSheet(state === 'active' ? 'checkinShare' : 'sos')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <Icon name={state === 'active' ? 'shield-check' : 'shield-alert'} size={22} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt size={14} weight={700} numberOfLines={1}>Check-in on · {checkin.otherName}</Txt>
            <Txt size={12} numberOfLines={1}>{line}</Txt>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => void checkinOk()}
          style={{ height: 38, paddingHorizontal: 12, borderRadius: 12, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.white, justifyContent: 'center' }}
        >
          <Txt size={13} weight={700}>I’m OK</Txt>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => openSheet('sos')}
          style={{ height: 38, paddingHorizontal: 12, borderRadius: 12, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.ink, justifyContent: 'center' }}
        >
          <Txt size={13} weight={700} color={colors.white}>SOS</Txt>
        </Pressable>
      </Box>
    </Enter>
  );
}

export function Toast({ bottom }: { bottom: number }) {
  const msg = useStore((s) => s.toast);
  const op = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (msg) {
      op.setValue(0);
      Animated.timing(op, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
  }, [msg, op]);
  if (!msg) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 20, right: 20, bottom, zIndex: 95, alignItems: 'center' }}>
      <Animated.View
        accessibilityLiveRegion="polite"
        style={{
          opacity: op, maxWidth: '100%', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 14, backgroundColor: colors.ink,
          shadowColor: 'rgb(18,14,38)', shadowOpacity: 0.5, shadowRadius: 15, shadowOffset: { width: 0, height: 10 }, elevation: 10,
        }}
      >
        <Txt size={13.5} lh={1.4} color={colors.white}>{msg}</Txt>
      </Animated.View>
    </View>
  );
}
