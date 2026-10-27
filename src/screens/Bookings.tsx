import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { colors } from '../theme';
import { AM, BTAB, CM, eur, hours, ST, type BTab } from '../data';
import { priceOf, useStore, type Booking } from '../store';
import { bookAgain, messageCompanion, openProfile } from '../nav';
import { Icon } from '../ui/Icon';
import { Box, Enter, H, Row, Stripes, Txt } from '../ui/primitives';
import { EmptyState, Pill, PrimaryButton, StatusCover, useTopPad } from '../ui/common';
import { useNavBottom } from '../ui/chrome';

const TABS: BTab[] = ['upcoming', 'pending', 'completed', 'cancelled'];
const EMPTY: Record<BTab, [string, string]> = {
  upcoming: ['No upcoming plans', 'Confirmed bookings appear here once a companion accepts.'],
  pending: ['No pending requests', 'Requests wait here until the companion responds.'],
  completed: ['Nothing completed yet', 'Past bookings and reviews will collect here.'],
  cancelled: ['No cancellations', 'Good news: nothing has been cancelled.'],
};

export default function Bookings() {
  const top = useTopPad();
  const bottom = useNavBottom() + 90;
  const btab = useStore((s) => s.btab);
  const bookings = useStore((s) => s.bookings);
  const list = bookings.filter((b) => b.status === BTAB[btab]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.sun }}>
      <StatusCover color={colors.sun} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: top, paddingBottom: bottom }}>
        <Enter>
          <View style={{ paddingTop: 8, paddingHorizontal: 20 }}><H size={30} ls={-0.035}>Bookings</H></View>
          <View accessibilityRole="tablist" style={{ marginTop: 16, marginHorizontal: 20, marginBottom: 18, padding: 4, borderRadius: 14, backgroundColor: 'rgba(17,17,17,.1)', flexDirection: 'row', gap: 2 }}>
            {TABS.map((k) => {
              const n = bookings.filter((b) => b.status === BTAB[k]).length;
              const on = btab === k;
              return (
                <Pressable
                  key={k}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  onPress={() => useStore.setState({ btab: k })}
                  style={{ flex: 1, height: 38, borderRadius: 11, backgroundColor: on ? colors.white : 'transparent', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, shadowColor: 'rgb(23,21,43)', shadowOpacity: on ? 0.1 : 0, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: on ? 1 : 0 }}
                >
                  <Txt size={12.5} weight={600} color={on ? colors.ink : colors.gray600} numberOfLines={1}>{k[0].toUpperCase() + k.slice(1)}</Txt>
                  <Txt size={11} weight={600} color={on ? colors.ink : colors.gray600} style={{ opacity: 0.6 }}>{n}</Txt>
                </Pressable>
              );
            })}
          </View>

          {list.length ? (
            <View style={{ gap: 12, paddingHorizontal: 20 }}>
              {list.map((b) => <BookingCard key={b.id} b={b} />)}
            </View>
          ) : (
            <EmptyState
              icon="calendar-heart"
              tilt={8}
              title={EMPTY[btab][0]}
              body={EMPTY[btab][1]}
              action={<PrimaryButton label="Discover companions" onPress={() => router.navigate('/')} height={46} radius={14} size={14} shadowColor="transparent" style={{ marginTop: 8 }} />}
            />
          )}
        </Enter>
      </ScrollView>
    </View>
  );
}

function BookingCard({ b }: { b: Booking }) {
  const c = CM[b.cid];
  const st = ST[b.status];
  const price = eur(priceOf(b));
  const { cancelBooking, showToast, openSheet, safety } = useStore.getState();
  const msg = () => {
    router.navigate('/messages');
    messageCompanion(b.cid);
  };

  type Act = { label: string; fn: () => void; primary?: boolean };
  const again: Act = { label: 'Book again', fn: () => bookAgain(c.id) };
  const actions: Act[] = {
    confirmed: [
      { label: 'Message', fn: msg },
      { label: 'Check-in', fn: () => openSheet('safety', { safety: { ...safety, bid: b.id } }) },
      { label: 'Meet code', fn: () => openSheet('otp', { otpFor: b.id }), primary: true },
    ],
    pending: [
      { label: 'Message', fn: msg },
      { label: 'Cancel request', fn: () => { cancelBooking(b.id); showToast('Request cancelled. ' + price + ' refunded in full.'); } },
    ],
    completed: b.reviewed
      ? [{ ...again, primary: true }]
      : [again, { label: 'Leave a review', fn: () => openSheet('review', { review: { bid: b.id, stars: 5, text: '' } }), primary: true }],
    cancelled: [again],
  }[b.status];

  const pay = {
    held: { icon: 'lock', text: price + ' held by ZeitMit', sub: b.status === 'pending' ? 'Refunded in full if ' + c.name + ' declines' : 'Released when ' + c.name + ' enters your meet code', bg: colors.lilac },
    released: { icon: 'circle-check', text: price + ' released to ' + c.name, sub: 'Confirmed with meet code', bg: colors.mintSoft },
    refunded: { icon: 'rotate-ccw', text: price + ' refunded to you', sub: 'Back on your card in 3–5 days', bg: colors.butter },
  }[b.pay];

  return (
    <Enter>
      <Box shadow={4} style={{ backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, borderRadius: 22, padding: 16, gap: 14 }}>
        <Row style={{ gap: 12 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`View ${c.name}’s profile`} onPress={() => openProfile(c.id)} style={{ width: 52, height: 52, borderRadius: 16, overflow: 'hidden' }}>
            <Stripes hue={c.hue} />
          </Pressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt size={16} weight={700}>{c.name}</Txt>
            <Row style={{ gap: 5, marginTop: 2 }}>
              <Icon name={AM[b.act].icon} size={14} color={colors.gray600} />
              <Txt size={13} color={colors.gray600} numberOfLines={1}>{AM[b.act].label}</Txt>
            </Row>
          </View>
          <Pill label={b.reviewed ? 'Reviewed' : st.l} bg={st.bg} fg={st.fg} dot={st.dot} />
        </Row>

        <View style={{ paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.sun, gap: 10 }}>
          <Row style={{ gap: 7 }}>
            <Icon name="calendar" size={15} color={colors.gray600} />
            <Txt size={13} numberOfLines={1}>{b.day} · {b.time} · {hours(b.dur)}</Txt>
          </Row>
          <Row style={{ gap: 7 }}>
            <Icon name="map-pin" size={15} color={colors.gray600} />
            <Txt size={13} numberOfLines={1} style={{ flex: 1 }}>{b.place}</Txt>
          </Row>
          <Row style={{ gap: 7 }}>
            <Icon name="receipt" size={15} color={colors.gray600} />
            <Txt size={13} weight={600} numberOfLines={1}>{price} <Txt size={13} color={colors.gray600}>incl. service fee</Txt></Txt>
          </Row>
        </View>

        <Row style={{ gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, borderWidth: 2, borderColor: colors.ink, backgroundColor: pay.bg }}>
          <Icon name={pay.icon} size={18} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt size={13} weight={700}>{pay.text}</Txt>
            <Txt size={12} color={colors.gray800}>{pay.sub}</Txt>
          </View>
        </Row>

        {b.note ? <Txt size={13} color={colors.gray600} style={{ marginTop: -4 }}>{b.note}</Txt> : null}

        <Row style={{ gap: 8 }}>
          {actions.map((a) => (
            <Pressable
              key={a.label}
              accessibilityRole="button"
              onPress={a.fn}
              style={({ pressed }) => ({ flex: 1, height: 42, borderRadius: 12, borderWidth: 1, borderColor: colors.ink, backgroundColor: a.primary ? colors.ink : colors.white, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.97 : 1 }] })}
            >
              <Txt size={13.5} weight={600} color={a.primary ? colors.white : colors.ink} numberOfLines={1}>{a.label}</Txt>
            </Pressable>
          ))}
        </Row>
      </Box>
    </Enter>
  );
}
