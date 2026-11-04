import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { colors } from '../../theme';
import { AM, hours, placeOr, WEEK, WIN, whenShort } from '../../data';
import { CODE_OPENS_HOURS, hueOf, useStore } from '../../store';
import { addDays, berlinToday, dateLabel, rangesText, weekdayOf, weeklyRanges } from '../../lib/dates';
import { Icon } from '../../ui/Icon';
import { Box, PressBox, Row, Txt } from '../../ui/primitives';
import { CompShell, Initial } from './Shell';
import { PastRow } from './History';
import { t } from '../../i18n';
import { openBookingChat, openCustomer, openReschedule } from '../../nav';
import { SecondaryButton, TextButton } from '../../ui/common';
import { ReschedBox } from '../../ui/ReschedBox';

export default function Calendar() {
  const avail = useStore((s) => s.comp.avail);
  const up = useStore((s) => s.comp.upcoming);
  const all = useStore((s) => s.comp.dates);
  const today = berlinToday();
  const dates = all.filter((d) => d.date >= today); // a date that just passed, with the app left open
  const history = useStore((s) => s.comp.history);
  const done = useStore((s) => s.comp.done);
  const { openSheet, setAvail } = useStore.getState();
  // Opens the date sheet: on a date that has hours, those; a new one starts tomorrow with that weekday's weekly times.
  const editDate = (date?: string) => {
    const d = date ?? addDays(today, 1);
    const ex = dates.find((x) => x.date === d);
    const weekly = weeklyRanges(avail, WEEK[weekdayOf(d)]);
    openSheet('customDate', { customDate: { date: d, off: ex ? !ex.ranges.length : false, ranges: ex?.ranges.length ? ex.ranges : weekly.length ? weekly : [['18:00', '22:00']], busy: false } });
  };
  return (
    <CompShell title="Calendar">
      <Box shadow={4} style={{ padding: 16, borderRadius: 22, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
          <Txt size={15} weight={700}>Weekly availability</Txt>
          <Txt size={12} color={colors.gray600}>Tap to toggle</Txt>
        </Row>
        <Row style={{ gap: 6, marginBottom: 6 }}>
          <View style={{ width: 44 }} />
          {WIN.map(([k, l]) => <Txt key={k} size={11} color={colors.gray600} align="center" style={{ flex: 1 }}>{l}</Txt>)}
        </Row>
        {WEEK.map((d) => (
          <Row key={d} style={{ gap: 6, marginBottom: 6 }}>
            <Txt size={13} weight={600} style={{ width: 44 }}>{d}</Txt>
            {WIN.map(([k, l]) => {
              const on = avail.includes(d + '-' + k);
              return (
                <Pressable
                  key={k}
                  accessibilityRole="switch"
                  accessibilityLabel={`${d} ${l}`}
                  accessibilityState={{ checked: on }}
                  onPress={() => setAvail(d, k, !on)}
                  style={{ flex: 1, height: 38, borderRadius: 10, backgroundColor: on ? colors.ink : colors.butter, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Icon name={on ? 'check' : 'plus'} size={15} color={on ? colors.white : colors.gray500} />
                </Pressable>
              );
            })}
          </Row>
        ))}
      </Box>

      {/* Own hours for specific dates, or days off */}
      <Box shadow={4} style={{ padding: 16, borderRadius: 22, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, gap: 10 }}>
        <Txt size={15} weight={700}>Specific dates</Txt>
        <Txt size={12.5} lh={1.45} color={colors.gray600}>Set your own hours for a date, or take a day off. They replace your weekly times on that day. Customers can book up to 7 days ahead.</Txt>
        {dates.map((d) => (
          <Pressable key={d.date} accessibilityRole="button" accessibilityLabel={`${dateLabel(d.date)}, ${rangesText(d.ranges)}`} onPress={() => editDate(d.date)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.hairline }}>
            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: d.ranges.length ? colors.mintSoft : colors.redSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={d.ranges.length ? 'clock' : 'calendar-x'} size={17} color={d.ranges.length ? colors.greenDeep : colors.redDeep} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt size={14} weight={600}>{dateLabel(d.date)}</Txt>
              <Txt size={13} color={colors.gray600} numberOfLines={1}>{rangesText(d.ranges)}</Txt>
            </View>
            <Icon name="pencil" size={15} color={colors.gray600} />
          </Pressable>
        ))}
        <SecondaryButton label="Add a date" icon="calendar-plus" height={44} radius={12} onPress={() => editDate()} />
      </Box>

      <Txt size={15} weight={700} style={{ marginTop: 6 }}>Upcoming</Txt>
      {up.map((u) => (
        <Box key={u.id} shadow={4} style={{ padding: 14, borderRadius: 18, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, gap: 12 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t(`View ${u.who}’s profile`)} onPress={() => openCustomer(u.customerId)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Initial who={u.who} hue={hueOf(u.customerId)} url={u.avatarUrl} size={44} radius={14} fontSize={15} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt size={15} weight={600}>{u.who} · {AM[u.act].label}</Txt>
              <Txt size={13} color={colors.gray600}>{u.day} · {u.time} · {hours(u.dur)}</Txt>
              <Txt size={12} color={colors.gray600} numberOfLines={1}>{placeOr(u.place)}</Txt>
            </View>
            <Icon name="chevron-right" size={16} color={colors.gray400} />
          </Pressable>
          {u.resched ? <ReschedBox bookingId={u.id} resched={u.resched} mine={u.resched.by === 'companion'} other={u.who.split(' ')[0]} current={`${u.day} · ${u.time}`} /> : null}
          <Row style={{ gap: 8 }}>
            {([
              ['message-circle', 'Message', () => void openBookingChat(u.id)],
              ['shield-check', 'Check-in', () => openSheet('safety', { safety: { ...useStore.getState().safety, bid: u.id, name: u.who } })],
              ['calendar-x', 'Cancel…', () => openSheet('cancel', { cancel: { bid: u.id, side: 'companion', reason: null, busy: false } })],
            ] as const).map(([, label, fn]) => (
              <Pressable key={label} accessibilityRole="button" accessibilityLabel={t(label)} onPress={fn} style={{ flex: 1, minWidth: 0, height: 40, paddingHorizontal: 4, borderRadius: 12, borderWidth: 1, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
                <Txt size={13} weight={600} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Txt>
              </Pressable>
            ))}
          </Row>
          {Date.now() / 1000 >= u.startsAt - CODE_OPENS_HOURS * 3600 ? (
            <PressBox
              shadow={3}
              shadowColor={colors.mint}
              fx="scale"
              onPress={() => openSheet('otpin', { otpIn: { uid: u.id, val: '', err: false, done: false, busy: false } })}
              accessibilityLabel={`Enter ${u.who}’s code`}
              style={{ height: 44, borderRadius: 12, backgroundColor: colors.ink, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }}
            >
              <Icon name="key-round" size={15} color={colors.white} />
              <Txt size={14} weight={700} color={colors.white}>Enter meet code</Txt>
            </PressBox>
          ) : (
            // The code can only be entered at the meet-up, so it opens 2 hours before.
            <Row style={{ height: 44, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.gray400, justifyContent: 'center', gap: 7 }}>
              <Icon name="key-round" size={15} color={colors.gray600} />
              <Txt size={13} weight={600} color={colors.gray600}>Meet code opens {whenShort(u.startsAt - CODE_OPENS_HOURS * 3600)}</Txt>
            </Row>
          )}
          {u.resched?.by !== 'customer' && (u.reschedLeft ?? 1) > 0 ? (
            <TextButton label="Suggest another time" icon="calendar-clock" size={13} weight={700} onPress={() => openReschedule(u.id)} style={{ alignSelf: 'center', marginTop: -4 }} />
          ) : null}
        </Box>
      ))}
      {!up.length ? <Txt size={14} color={colors.gray600}>No upcoming bookings yet.</Txt> : null}

      {/* Booking history: past meet-ups and cancellations, newest first */}
      <Txt size={15} weight={700} style={{ marginTop: 6 }}>Booking history</Txt>
      {history.length ? (
        <Box shadow={4} style={{ paddingHorizontal: 14, paddingVertical: 4, borderRadius: 18, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink }}>
          {/* The latest meet-ups (where "How did it go?" matters); See all has the cancellations too. */}
          {(done.length ? done : history).slice(0, 3).map((b, i) => <PastRow key={b.id} b={b} first={i === 0} />)}
        </Box>
      ) : <Txt size={14} color={colors.gray600}>Past bookings will show here.</Txt>}
      {history.length > 3 ? (
        <TextButton label={`See all ${history.length}`} size={14} weight={700} onPress={() => router.push('/history')} style={{ alignSelf: 'center' }} />
      ) : null}
    </CompShell>
  );
}
