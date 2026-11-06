import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { colors } from '../theme';
import { AM, BTAB, eur, hours, isVideo, placeFor, ST, whenShort, type BTab } from '../data';
import { untilLabel } from '../lib/dates';
import { FREE_CANCEL_HOURS, priceOf, useStore, type Booking } from '../store';
import { bookAgain, joinVideoDate, openBookingChat, openProfile, openReschedule } from '../nav';
import { Icon } from '../ui/Icon';
import { Box, Enter, H, Row, Stripes, Txt, Photo } from '../ui/primitives';
import { EmptyState, Pill, PrimaryButton, StatusCover, TextButton, usePullRefresh, useTopPad } from '../ui/common';
import { useNavBottom } from '../ui/chrome';
import { useAppWidth } from '../ui/layout';
import { ReschedBox } from '../ui/ReschedBox';

const TABS: BTab[] = ['upcoming', 'pending', 'completed', 'cancelled'];
// Short labels, so all four fit on small phones in English and German ("Abgeschlossen" didn't).
const TAB_LABEL: Record<BTab, string> = { upcoming: 'Upcoming', pending: 'Pending', completed: 'Past', cancelled: 'Cancelled' };
const EMPTY: Record<BTab, [string, string]> = {
  upcoming: ['No upcoming plans', 'Video dates show here as soon as they’re booked, in-person dates once the companion accepts.'],
  pending: ['No pending requests', 'Requests wait here until the companion responds.'],
  completed: ['Nothing completed yet', 'Past bookings and reviews will collect here.'],
  cancelled: ['No cancellations', 'Good news: nothing has been cancelled.'],
};

export default function Bookings() {
  const top = useTopPad();
  const refresh = usePullRefresh();
  const bottom = useNavBottom() + 90;
  const btab = useStore((s) => s.btab);
  const narrow = useAppWidth() < 360;
  const bookings = useStore((s) => s.bookings);
  const list = bookings.filter((b) => b.status === BTAB[btab]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.sun }}>
      <StatusCover color={colors.sun} />
      <ScrollView showsVerticalScrollIndicator={false} refreshControl={refresh} contentContainerStyle={{ paddingTop: top, paddingBottom: bottom }}>
        <Enter>
          <View style={{ paddingTop: 8, paddingHorizontal: 20 }}><H size={30} ls={-0.035}>Bookings</H></View>
          <View accessibilityRole="tablist" style={{ marginTop: 16, marginHorizontal: narrow ? 14 : 20, marginBottom: 18, padding: 4, borderRadius: 14, backgroundColor: 'rgba(17,17,17,.1)', flexDirection: 'row', gap: narrow ? 0 : 2 }}>
            {TABS.map((k) => {
              const n = bookings.filter((b) => b.status === BTAB[k]).length;
              const on = btab === k;
              return (
                <Pressable
                  key={k}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  onPress={() => useStore.setState({ btab: k })}
                  style={{ flex: 1, height: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: narrow ? 2 : 4, paddingHorizontal: 2 }}
                >
                  {/* Shown or hidden, never recoloured, so Android keeps the rounded corners (as in the tab bar). */}
                  <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 11, backgroundColor: colors.white, opacity: on ? 1 : 0, shadowColor: 'rgb(23,21,43)', shadowOpacity: 0.1, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } }} />
                  {/* Small phones: a smaller label that also shrinks to fit, so it isn't cut off ("Upcomi…"). */}
                  <Txt size={narrow ? 11 : 12.5} weight={600} color={on ? colors.ink : colors.gray600} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ flexShrink: 1 }}>{TAB_LABEL[k]}</Txt>
                  {n ? <Txt size={narrow ? 10 : 11} weight={600} color={on ? colors.ink : colors.gray600} style={{ opacity: 0.6 }}>{n}</Txt> : null}
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
  const c = { id: b.cid, name: b.companionName, hue: b.hue, photoUrl: b.photoUrl };
  const st = ST[b.status];
  const price = eur(priceOf(b));
  const { openSheet, safety } = useStore.getState();
  const msg = () => {
    router.navigate('/messages');
    void openBookingChat(b.id);
  };
  const cancel = () => openSheet('cancel', { cancel: { bid: b.id, side: 'customer', reason: null, busy: false } });
  // Free cancellation until FREE_CANCEL_HOURS before the start (shown on confirmed bookings); a video date, confirmed
  // the moment it's booked, also in its first minutes. The server says until when.
  const freeUntil = b.freeUntil ?? b.startsAt - FREE_CANCEL_HOURS * 3600;
  const freeNow = Date.now() / 1000 < freeUntil;
  const moveUntil = b.startsAt - FREE_CANCEL_HOURS * 3600;
  // Moving to another time: up to 24 h before a confirmed booking (a request can move any time), never while
  // the companion's own suggestion waits for an answer, and at most a few times per booking.
  const open = b.status === 'pending' || b.status === 'confirmed';
  const canMove = open && (b.reschedLeft ?? 1) > 0 && b.resched?.by !== 'companion';
  const move = () => (b.status === 'confirmed' && Date.now() / 1000 >= moveUntil
    ? useStore.getState().showToast(`You can change the time up to ${FREE_CANCEL_HOURS} hours before. Send ${c.name} a message instead.`)
    : openReschedule(b.id));

  const video = isVideo(b.act);
  type Act = { label: string; fn: () => void; primary?: boolean };
  const again: Act = { label: 'Book again', fn: () => bookAgain(c.id) };
  const actions: Act[] = {
    // A video date happens in the app: no check-in or meet code, the call itself confirms it.
    confirmed: video
      ? [{ label: 'Message', fn: msg }, { label: 'Join video date', fn: () => joinVideoDate(b.id, b.startsAt), primary: true }]
      : [
        { label: 'Message', fn: msg },
        { label: 'Check-in', fn: () => openSheet('safety', { safety: { ...safety, bid: b.id, name: b.companionName } }) },
        { label: 'Meet code', fn: () => openSheet('otp', { otpFor: b.id }), primary: true },
      ],
    pending: [
      { label: 'Message', fn: msg },
      { label: 'Cancel request', fn: cancel },
    ],
    // First the private “How did it go?” for the safety team, then the public review. A video date confirmed by the
    // call keeps its call open until the booked end, so you can get back in.
    completed: video && Date.now() / 1000 < b.startsAt + b.dur * 3600
      ? [{ label: 'Message', fn: msg }, { label: 'Rejoin video date', fn: () => joinVideoDate(b.id, b.startsAt), primary: true }]
      : !b.feedback
      ? [again, { label: 'How did it go?', fn: () => useStore.getState().openFeedback(b.id), primary: true }]
      : b.reviewed
        ? [{ ...again, primary: true }]
        : [again, { label: 'Leave a review', fn: () => openSheet('review', { review: { bid: b.id, stars: 5, text: '' } }), primary: true }],
    cancelled: [again],
  }[b.status];

  const pay = {
    held: {
      icon: 'lock', text: price + ' held by ZeitMit', bg: colors.lilac,
      sub: b.status === 'pending'
        ? (b.replyBy ? `${c.name} replies by ${untilLabel(b.replyBy)}, or it’s refunded in full` : 'Refunded in full if ' + c.name + ' declines')
        : video ? 'Released after 10 minutes on the call together' : 'Released when ' + c.name + ' enters your meet code',
    },
    released: b.status === 'cancelled'
      ? { icon: 'circle-check', text: price + ' paid to ' + c.name, sub: video && b.cancelledBy === 'customer' && b.note?.startsWith('You didn’t join') ? 'Not refunded' : `Cancelled less than ${FREE_CANCEL_HOURS} hours before`, bg: colors.butter }
      : { icon: 'circle-check', text: price + ' released to ' + c.name, sub: video ? 'Confirmed by your video call' : 'Confirmed with meet code', bg: colors.mintSoft },
    refunded: { icon: 'rotate-ccw', text: price + ' refunded to you', sub: 'Back on your card in 3–5 days', bg: colors.butter },
  }[b.pay];

  return (
    <Enter>
      <Box shadow={4} style={{ backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, borderRadius: 22, padding: 16, gap: 14 }}>
        <Row style={{ gap: 12 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`View ${c.name}’s profile`} onPress={() => openProfile(c.id)} style={{ width: 52, height: 52, borderRadius: 16, overflow: 'hidden' }}>
            <Photo hue={c.hue} url={c.photoUrl} />
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
            <Icon name={video ? 'video' : 'map-pin'} size={15} color={colors.gray600} />
            <Txt size={13} numberOfLines={1} style={{ flex: 1 }} color={b.place || video ? colors.ink : colors.gray600}>{placeFor(b.act, b.place)}</Txt>
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

        {open && b.resched ? <ReschedBox bookingId={b.id} resched={b.resched} mine={b.resched.by === 'customer'} other={c.name} current={`${b.day} · ${b.time}`} /> : null}

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
        {b.status === 'confirmed' ? (
          <Txt size={12} color={colors.gray600} style={{ marginTop: -4 }}>
            {freeNow ? `Free cancellation until ${whenShort(freeUntil)}` : 'No refund if you cancel now'}
          </Txt>
        ) : null}
        {open && (canMove || b.status === 'confirmed') ? (
          <Row style={{ justifyContent: 'space-between', gap: 10, marginTop: -8 }}>
            {canMove ? <TextButton label="Change time" icon="calendar-clock" size={13} weight={700} onPress={move} style={{ paddingVertical: 6 }} /> : <View />}
            {b.status === 'confirmed' ? <TextButton label="Cancel booking" size={13} weight={700} color={colors.roseDeep} onPress={cancel} style={{ paddingVertical: 6 }} /> : null}
          </Row>
        ) : null}
      </Box>
    </Enter>
  );
}
