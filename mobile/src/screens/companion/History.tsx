// A companion's booking history: past meet-ups and cancellations, newest first, with the private "How did it go?" on
// meet-ups that haven't been answered. The Calendar shows the latest few; this screen shows them all.
import { useState } from 'react';
import { ScrollView, View, Pressable, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../theme';
import { AM, eur, hours, ST } from '../../data';
import { hueOf, useStore, type CompBooking } from '../../store';
import { goBack, openCustomer } from '../../nav';
import { Icon } from '../../ui/Icon';
import { Box, Chip, H, PressBox, Row, Txt } from '../../ui/primitives';
import { CircleButton, EmptyState, Pill, StatusCover, usePullRefresh } from '../../ui/common';
import { t } from '../../i18n';
import { Initial } from './Shell';

export default function CompanionHistory() {
  const insets = useSafeAreaInsets();
  const history = useStore((s) => s.comp.history);
  const refresh = usePullRefresh();
  const [only, setOnly] = useState<Only>('all');
  const list = only === 'all' ? history : history.filter((b) => (b.status === 'completed') === (only === 'met'));
  // Rows mount in pages as the list scrolls, so a long history opens as fast as a short one.
  const [shown, setShown] = useState(PAGE);
  const onScroll = ({ nativeEvent: e }: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (shown < list.length && e.contentOffset.y + e.layoutMeasurement.height > e.contentSize.height - 800) setShown((n) => n + PAGE);
  };
  const pick = (o: Only) => { setOnly(o); setShown(PAGE); };
  const met = history.filter((b) => b.status === 'completed').length;
  return (
    <View style={{ flex: 1, backgroundColor: colors.sun }}>
      <StatusCover color={colors.sun} />
      <ScrollView showsVerticalScrollIndicator={false} refreshControl={refresh} onScroll={onScroll} scrollEventThrottle={100} contentContainerStyle={{ paddingTop: insets.top + 4, paddingBottom: 40 + insets.bottom }}>
        <Row style={{ paddingTop: 4, paddingHorizontal: 12 }}>
          <CircleButton icon="chevron-left" label="Back" size={40} iconSize={24} border={0} bg="transparent" onPress={goBack} />
        </Row>
        <H size={30} ls={-0.035} style={{ marginTop: 6, marginHorizontal: 20 }}>Booking history</H>
        <Txt size={14} color={colors.gray600} style={{ marginTop: 4, marginHorizontal: 20, marginBottom: 14 }}>
          {history.length ? historyLine(history) : ' '}
        </Txt>
        {met && met < history.length ? (
          <Row style={{ gap: 8, marginHorizontal: 20, marginBottom: 14 }}>
            {(['all', 'met', 'cancelled'] as const).map((o) => (
              <Chip key={o} label={ONLY[o]} on={only === o} onPress={() => pick(o)} height={34} weight={600} />
            ))}
          </Row>
        ) : null}
        {list.length ? (
          <Box shadow={4} style={{ marginHorizontal: 20, paddingHorizontal: 14, paddingVertical: 4, borderRadius: 18, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink }}>
            {list.slice(0, shown).map((b, i) => <PastRow key={b.id} b={b} first={i === 0} />)}
          </Box>
        ) : (
          <EmptyState icon="history" tilt={-3} title="No past bookings yet" body="Your meet-ups and cancellations will collect here." />
        )}
      </ScrollView>
    </View>
  );
}

type Only = 'all' | 'met' | 'cancelled';
const ONLY: Record<Only, string> = { all: 'All', met: 'Met', cancelled: 'Cancelled' };
const PAGE = 40;

/** "25 meet-ups · 3 cancelled" */
export function historyLine(history: CompBooking[]) {
  const met = history.filter((b) => b.status === 'completed').length;
  const gone = history.length - met;
  const a = met === 1 ? '1 meet-up' : `${met} meet-ups`;
  return gone ? `${a} · ${gone} cancelled` : a;
}

/** What happened, from the companion's side: met and earned, declined, cancelled by whom, or expired. */
function outcome(b: CompBooking): string {
  const first = b.who.split(' ')[0];
  const pay = eur(b.payout / 100);
  if (b.status === 'completed') return b.pay === 'released' ? `Met · ${pay} earned` : 'Met';
  if (b.cancelledBy === 'companion') return b.cancelNote?.startsWith('Declined') ? 'You declined' : 'You cancelled';
  if (b.cancelledBy === 'customer') return b.pay === 'released' ? `${first} cancelled late · ${pay} earned` : `${first} cancelled`;
  if (b.cancelledBy === 'support') return 'Cancelled by ZeitMit support';
  return 'No reply in time';
}

export function PastRow({ b, first }: { b: CompBooking; first: boolean }) {
  const st = ST[b.status];
  // The private "How did it go?" stays open for completed meet-ups until it's answered.
  const ask = b.status === 'completed' && !b.feedback && b.startsAt + b.dur * 3600 <= Date.now() / 1000;
  return (
    <View style={{ paddingVertical: 12, gap: 10, borderTopWidth: first ? 0 : 1, borderTopColor: colors.hairline }}>
      <Row style={{ gap: 12 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t(`View ${b.who}’s profile`)} onPress={() => openCustomer(b.customerId)}>
          <Initial who={b.who} hue={hueOf(b.customerId)} url={b.avatarUrl} size={40} radius={13} fontSize={14} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={14} weight={600} numberOfLines={1}>{b.who} · {AM[b.act].label}</Txt>
          <Txt size={12} color={colors.gray600}>{b.day} · {b.time} · {hours(b.dur)}</Txt>
          <Txt size={12} color={colors.gray600} numberOfLines={2}>{outcome(b)}</Txt>
        </View>
        <Pill label={st.l} bg={st.bg} fg={st.fg} height={24} />
      </Row>
      {ask ? (
        <PressBox shadow={3} fx="push" onPress={() => useStore.getState().openFeedback(b.id)} accessibilityLabel={t(`How did it go with ${b.who.split(' ')[0]}?`)}
          style={{ height: 40, borderRadius: 12, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.lilac, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
          <Icon name="shield-check" size={15} />
          <Txt size={13} weight={700}>How did it go?</Txt>
        </PressBox>
      ) : null}
    </View>
  );
}
