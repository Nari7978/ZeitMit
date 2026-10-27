import { Pressable, View } from 'react-native';
import { colors } from '../../theme';
import { AM, hours, WEEK, WIN } from '../../data';
import { useStore } from '../../store';
import { Icon } from '../../ui/Icon';
import { Box, PressBox, Row, Txt } from '../../ui/primitives';
import { CompShell, Initial } from './Shell';

export default function Calendar() {
  const avail = useStore((s) => s.avail);
  const up = useStore((s) => s.cUpcoming);
  const { openSheet } = useStore.getState();
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
              const on = !!avail[d + '-' + k];
              return (
                <Pressable
                  key={k}
                  accessibilityRole="switch"
                  accessibilityLabel={`${d} ${l}`}
                  accessibilityState={{ checked: on }}
                  onPress={() => useStore.setState((s) => ({ avail: { ...s.avail, [d + '-' + k]: !on } }))}
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
        <Box key={u.id} shadow={4} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink }}>
          <Initial who={u.who} hue={u.hue} size={44} radius={14} fontSize={15} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt size={15} weight={600}>{u.who} · {AM[u.act].label}</Txt>
            <Txt size={13} color={colors.gray600}>{u.day} · {u.time} · {hours(u.dur)}</Txt>
          </View>
          <PressBox
            shadow={3}
            shadowColor={colors.mint}
            fx="scale"
            onPress={() => openSheet('otpin', { otpIn: { uid: u.id, val: '', err: false, done: false } })}
            accessibilityLabel={`Enter ${u.who}’s code`}
            style={{ height: 38, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.ink, flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Icon name="key-round" size={14} color={colors.white} />
            <Txt size={13} weight={700} color={colors.white}>Enter code</Txt>
          </PressBox>
        </Box>
      ))}
      {!up.length ? <Txt size={14} color={colors.gray600}>No upcoming bookings yet.</Txt> : null}
    </CompShell>
  );
}
