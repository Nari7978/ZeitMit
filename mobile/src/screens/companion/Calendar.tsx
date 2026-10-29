import { Pressable, View } from 'react-native';
import { colors } from '../../theme';
import { AM, hours, WEEK, WIN } from '../../data';
import { hueOf, useStore } from '../../store';
import { Icon } from '../../ui/Icon';
import { Box, PressBox, Row, Txt } from '../../ui/primitives';
import { CompShell, Initial } from './Shell';
import { t } from '../../i18n';
import { openBookingChat, openCustomer, openReschedule } from '../../nav';
import { TextButton } from '../../ui/common';
import { ReschedBox } from '../../ui/ReschedBox';

export default function Calendar() {
  const avail = useStore((s) => s.comp.avail);
  const up = useStore((s) => s.comp.upcoming);
  const { openSheet, setAvail } = useStore.getState();
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
      <Txt size={15} weight={700} style={{ marginTop: 6 }}>Upcoming</Txt>
      {up.map((u) => (
        <Box key={u.id} shadow={4} style={{ padding: 14, borderRadius: 18, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, gap: 12 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t(`View ${u.who}’s profile`)} onPress={() => openCustomer(u.customerId)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Initial who={u.who} hue={hueOf(u.customerId)} url={u.avatarUrl} size={44} radius={14} fontSize={15} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt size={15} weight={600}>{u.who} · {AM[u.act].label}</Txt>
              <Txt size={13} color={colors.gray600}>{u.day} · {u.time} · {hours(u.dur)}</Txt>
              <Txt size={12} color={colors.gray600} numberOfLines={1}>{u.place}</Txt>
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
                <Txt size={13} weight={600} numberOfLines={1}>{label}</Txt>
              </Pressable>
            ))}
          </Row>
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
          {u.resched?.by !== 'customer' && (u.reschedLeft ?? 1) > 0 ? (
            <TextButton label="Suggest another time" icon="calendar-clock" size={13} weight={700} onPress={() => openReschedule(u.id)} style={{ alignSelf: 'center', marginTop: -4 }} />
          ) : null}
        </Box>
      ))}
      {!up.length ? <Txt size={14} color={colors.gray600}>No upcoming bookings yet.</Txt> : null}
    </CompShell>
  );
}
