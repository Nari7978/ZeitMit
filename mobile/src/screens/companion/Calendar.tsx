import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { colors } from '../../theme';
import { AM, CALL_OPENS_EARLY_S, hours, isVideo, kindsOf, placeFor, WEEK, whenShort } from '../../data';
import { CODE_OPENS_HOURS, hueOf, useStore } from '../../store';
import { addDays, dateLabel, localAt, localToday, rangesText } from '../../lib/dates';
import { cityOf, offsetMin, TZ } from '../../lib/tz';
import { Icon } from '../../ui/Icon';
import { Box, PressBox, Row, Txt } from '../../ui/primitives';
import { CompShell, Initial } from './Shell';
import { PastRow } from './History';
import { t } from '../../i18n';
import { joinVideoDate, openBookingChat, openCustomer, openReschedule } from '../../nav';
import { SecondaryButton, TextButton } from '../../ui/common';
import { ReschedBox } from '../../ui/ReschedBox';

export default function Calendar() {
  // One calendar for in-person and video dates: each range of hours is open for both, or one of them.
  const both = kindsOf(useStore((s) => s.comp.acts)).length > 1;
  const cal = useStore((s) => s.comp.hours);
  const up = useStore((s) => s.comp.upcoming);
  const history = useStore((s) => s.comp.history);
  const done = useStore((s) => s.comp.done);
  const { openSheet, setCompanionTz } = useStore.getState();
  const tz = cal?.tz ?? TZ;
  const today = localToday(tz);
  const dates = (cal?.days ?? []).filter((d) => d.date >= today); // a date that just passed, with the app left open
  const blocks = (cal?.blocks ?? []).filter((x) => x.endsAt > Date.now() / 1000);
  // This phone is in another zone than the hours (travelling, or set up elsewhere): offer to use the phone's.
  const otherTz = tz !== TZ && offsetMin(Date.now() / 1000, tz) !== offsetMin(Date.now() / 1000, TZ);
  const editDay = (day: number) => openSheet('hours', { hoursEdit: { day, date: null, off: false, busy: false, ranges: (cal?.week ?? []).filter((r) => r.day === day).map(({ from, to, kind }) => ({ from, to, kind })) } });
  // On a date that has hours, those; a new one starts tomorrow with that weekday's weekly hours.
  const editDate = (date?: string) => {
    const d = date ?? addDays(today, 1);
    const ex = dates.find((x) => x.date === d);
    const weekly = (cal?.week ?? []).filter((r) => r.day === (new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7).map(({ from, to, kind }) => ({ from, to, kind }));
    openSheet('hours', { hoursEdit: { day: null, date: d, busy: false, off: ex ? !ex.ranges.length : false, ranges: ex?.ranges.length ? ex.ranges : weekly.length ? weekly : [{ from: '18:00', to: '22:00', kind: 'both' }] } });
  };
  // A new block starts at the next full hour, for an hour.
  const editBlock = (id?: string) => {
    const x = blocks.find((b) => b.id === id);
    if (x) {
      const s0 = localAt(x.startsAt, tz), e0 = localAt(x.endsAt, tz);
      return openSheet('block', { blockEdit: { id: x.id, date: s0.date, from: s0.time, until: e0.date, to: e0.time, note: x.note, busy: false } });
    }
    const start = Math.ceil(Date.now() / 3600000) * 3600;
    const s0 = localAt(start, tz), e0 = localAt(start + 3600, tz);
    openSheet('block', { blockEdit: { id: null, date: s0.date, from: s0.time, until: e0.date, to: e0.time, note: '', busy: false } });
  };
  const blockText = (x: { startsAt: number; endsAt: number }) => {
    const s0 = localAt(x.startsAt, tz), e0 = localAt(x.endsAt, tz);
    return s0.date === e0.date ? `${dateLabel(s0.date)} · ${s0.time}–${e0.time}` : `${dateLabel(s0.date)} ${s0.time} – ${dateLabel(e0.date)} ${e0.time}`;
  };
  return (
    <CompShell title="Calendar">
      <Row style={{ gap: 10, padding: 12, borderRadius: 16, backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.ink, alignItems: 'flex-start' }}>
        <Icon name="globe" size={17} style={{ marginTop: 1 }} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Txt size={13.5} weight={600}>{`Your hours are in ${cityOf(tz)} time`}</Txt>
          <Txt size={12} lh={1.45} color={colors.gray600}>Customers see them in their own time. Bookings start 3½ hours ahead at the earliest, and you accept requests within 24 hours, at least 3 hours before the start.</Txt>
          {otherTz ? <TextButton label={`Use this phone’s time zone (${cityOf(TZ)})`} size={13} weight={700} onPress={() => void setCompanionTz(TZ)} style={{ alignSelf: 'flex-start', paddingVertical: 4 }} /> : null}
        </View>
      </Row>

      <Box shadow={4} style={{ padding: 16, borderRadius: 22, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 4 }}>
          <Txt size={15} weight={700}>Weekly hours</Txt>
          <Txt size={12} color={colors.gray600}>Tap a day to change it</Txt>
        </Row>
        <Txt size={12.5} lh={1.45} color={colors.gray600} style={{ marginBottom: 8 }}>
          {both ? 'Any times, in 15-minute steps, past midnight too. Each range is for in-person and video dates, or just one of them.' : 'Any times, in 15-minute steps, past midnight too.'}
        </Txt>
        {WEEK.map((d, i) => {
          const ranges = (cal?.week ?? []).filter((r) => r.day === i);
          return (
            <Pressable key={d} accessibilityRole="button" accessibilityLabel={`${t(d)}: ${rangesText(ranges, both)}`} onPress={() => editDay(i)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.hairline }}>
              <Txt size={14} weight={700} style={{ width: 40 }}>{d}</Txt>
              <Txt size={13.5} color={ranges.length ? colors.ink : colors.gray500} style={{ flex: 1 }}>{ranges.length ? rangesText(ranges, both) : 'Closed'}</Txt>
              <Icon name="pencil" size={15} color={colors.gray600} />
            </Pressable>
          );
        })}
      </Box>

      {/* Own hours for specific dates, or days off */}
      <Box shadow={4} style={{ padding: 16, borderRadius: 22, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, gap: 10 }}>
        <Txt size={15} weight={700}>Specific dates</Txt>
        <Txt size={12.5} lh={1.45} color={colors.gray600}>Set your own hours for a date, or take a day off. They replace your weekly hours that day. Customers can book up to 7 days ahead.</Txt>
        {dates.map((d) => (
          <Pressable key={d.date} accessibilityRole="button" accessibilityLabel={`${dateLabel(d.date)}, ${rangesText(d.ranges, both)}`} onPress={() => editDate(d.date)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.hairline }}>
            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: d.ranges.length ? colors.mintSoft : colors.redSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={d.ranges.length ? 'clock' : 'calendar-x'} size={17} color={d.ranges.length ? colors.greenDeep : colors.redDeep} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt size={14} weight={600}>{dateLabel(d.date)}</Txt>
              <Txt size={13} color={colors.gray600} numberOfLines={2}>{rangesText(d.ranges, both)}</Txt>
            </View>
            <Icon name="pencil" size={15} color={colors.gray600} />
          </Pressable>
        ))}
        <SecondaryButton label="Add a date" icon="calendar-plus" height={44} radius={12} onPress={() => editDate()} />
      </Box>

      {/* Blocked time: closed whatever the hours say, until removed (never reopens by itself) */}
      <Box shadow={4} style={{ padding: 16, borderRadius: 22, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, gap: 10 }}>
        <Txt size={15} weight={700}>Blocked time</Txt>
        <Txt size={12.5} lh={1.45} color={colors.gray600}>A break, a night off or days away. Customers can’t book it until you remove it, and it never opens again by itself.</Txt>
        {blocks.map((x) => (
          <Pressable key={x.id} accessibilityRole="button" accessibilityLabel={`${blockText(x)}${x.note ? `, ${x.note}` : ''}`} onPress={() => editBlock(x.id)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.hairline }}>
            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.butter, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="ban" size={17} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt size={14} weight={600} numberOfLines={2}>{blockText(x)}</Txt>
              {x.note ? <Txt raw size={13} color={colors.gray600} numberOfLines={1}>{x.note}</Txt> : null}
            </View>
            <Icon name="pencil" size={15} color={colors.gray600} />
          </Pressable>
        ))}
        <SecondaryButton label="Block time" icon="calendar-x" height={44} radius={12} onPress={() => editBlock()} />
      </Box>

      <Txt size={15} weight={700} style={{ marginTop: 6 }}>Upcoming</Txt>
      {up.map((u) => (
        <Box key={u.id} shadow={4} style={{ padding: 14, borderRadius: 18, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, gap: 12 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t(`View ${u.who}’s profile`)} onPress={() => openCustomer(u.customerId)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Initial who={u.who} hue={hueOf(u.customerId)} url={u.avatarUrl} size={44} radius={14} fontSize={15} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt size={15} weight={600}>{u.who} · {AM[u.act].label}</Txt>
              <Txt size={13} color={colors.gray600}>{u.day} · {u.time}–{u.end} · {hours(u.dur)}</Txt>
              <Txt size={12} color={colors.gray600} numberOfLines={1}>{placeFor(u.act, u.place)}</Txt>
            </View>
            <Icon name="chevron-right" size={16} color={colors.gray400} />
          </Pressable>
          {u.resched ? <ReschedBox bookingId={u.id} resched={u.resched} mine={u.resched.by === 'companion'} other={u.who.split(' ')[0]} current={`${u.day} · ${u.time}–${u.end}`} /> : null}
          <Row style={{ gap: 8 }}>
            {([
              ['message-circle', 'Message', () => void openBookingChat(u.id)],
              // Check-ins are for meet-ups in person.
              ...(isVideo(u.act) ? [] : [['shield-check', 'Check-in', () => openSheet('safety', { safety: { ...useStore.getState().safety, bid: u.id, name: u.who } })] as const]),
              ['calendar-x', 'Cancel…', () => openSheet('cancel', { cancel: { bid: u.id, side: 'companion', reason: null, busy: false } })],
            ] as const).map(([, label, fn]) => (
              <Pressable key={label} accessibilityRole="button" accessibilityLabel={t(label)} onPress={fn} style={{ flex: 1, minWidth: 0, height: 40, paddingHorizontal: 4, borderRadius: 12, borderWidth: 1, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
                <Txt size={13} weight={600} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Txt>
              </Pressable>
            ))}
          </Row>
          {isVideo(u.act) ? (
            Date.now() / 1000 >= u.startsAt - CALL_OPENS_EARLY_S ? (
              <PressBox shadow={3} shadowColor={colors.mint} fx="scale" onPress={() => joinVideoDate(u.id, u.startsAt)} accessibilityLabel="Join video date"
                style={{ height: 44, borderRadius: 12, backgroundColor: colors.ink, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                <Icon name="video" size={15} color={colors.white} />
                <Txt size={14} weight={700} color={colors.white}>Join video date</Txt>
              </PressBox>
            ) : (
              // The call opens 10 minutes before the start.
              <Row style={{ height: 44, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.gray400, justifyContent: 'center', gap: 7 }}>
                <Icon name="video" size={15} color={colors.gray600} />
                <Txt size={13} weight={600} color={colors.gray600}>Video call opens {whenShort(u.startsAt - CALL_OPENS_EARLY_S)}</Txt>
              </Row>
            )
          ) : Date.now() / 1000 >= u.startsAt - CODE_OPENS_HOURS * 3600 ? (
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
