import { View } from 'react-native';
import { colors } from '../../theme';
import { AM, eur } from '../../data';
import { useStore } from '../../store';
import { Icon } from '../../ui/Icon';
import { Box, Enter, Row, Txt } from '../../ui/primitives';
import { Pill, PrimaryButton, SecondaryButton } from '../../ui/common';
import { actLine, CompShell, Initial } from './Shell';

export default function Requests() {
  const requests = useStore((s) => s.requests);
  const cRate = useStore((s) => s.cRate);
  const { acceptRequest, declineRequest } = useStore.getState();
  return (
    <CompShell title="Requests">
      {requests.map((r) => (
        <Enter key={r.id}>
          <Box shadow={4} style={{ padding: 16, borderRadius: 22, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, gap: 12 }}>
            <Row style={{ gap: 12 }}>
              <Initial who={r.who} hue={r.hue} />
              <View style={{ flex: 1 }}>
                <Txt size={16} weight={700}>{r.who}</Txt>
                <Row style={{ gap: 5 }}>
                  <Icon name={AM[r.act].icon} size={14} color={colors.gray600} />
                  <Txt size={13} color={colors.gray600}>{actLine(r.act, r.dur)}</Txt>
                </Row>
              </View>
              <Pill label="Sample" bg={colors.blush} fg={colors.ink} height={24} />
            </Row>
            <Row style={{ gap: 16 }}>
              <Row style={{ gap: 6 }}><Icon name="calendar" size={15} color={colors.gray600} /><Txt size={13}>{r.day}</Txt></Row>
              <Row style={{ gap: 6 }}><Icon name="clock" size={15} color={colors.gray600} /><Txt size={13}>{r.time}</Txt></Row>
            </Row>
            <View style={{ paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.sun }}>
              <Txt size={14} lh={1.45} color={colors.gray800}>“{r.note}”</Txt>
            </View>
            <Txt size={12} color={colors.gray600}>{eur(cRate * r.dur)} already paid and held by ZeitMit · released when you enter their meet code</Txt>
            <Row style={{ gap: 8 }}>
              <SecondaryButton label="Decline" height={44} radius={12} style={{ flex: 1 }} onPress={() => declineRequest(r.id)} />
              <PrimaryButton label="Accept" height={44} radius={12} size={14} shadowColor="transparent" style={{ flex: 1 }} onPress={() => acceptRequest(r.id)} />
            </Row>
          </Box>
        </Enter>
      ))}
      {!requests.length ? (
        <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 8 }}>
          <Icon name="inbox" size={34} color={colors.gray400} />
          <Txt size={17} weight={700}>You’re all caught up</Txt>
          <Txt size={14} color={colors.gray600}>New booking requests will appear here.</Txt>
        </View>
      ) : null}
    </CompShell>
  );
}
