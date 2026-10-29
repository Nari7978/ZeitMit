import { Pressable, View } from 'react-native';
import { colors } from '../../theme';
import { AM, eur, memberSince } from '../../data';
import { hueOf, useStore } from '../../store';
import { Icon } from '../../ui/Icon';
import { Box, Enter, Row, Txt } from '../../ui/primitives';
import { Pill, PrimaryButton, SecondaryButton, TextButton } from '../../ui/common';
import { ReschedBox } from '../../ui/ReschedBox';
import { actLine, CompShell, Initial } from './Shell';
import { openBookingChat, openCustomer, openReschedule } from '../../nav';
import { t } from '../../i18n';

export default function Requests() {
  const requests = useStore((s) => s.comp.requests);
  const { acceptRequest, declineRequest } = useStore.getState();
  return (
    <CompShell title="Requests">
      {requests.map((r) => (
        <Enter key={r.id}>
          <Box shadow={4} style={{ padding: 16, borderRadius: 22, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, gap: 12 }}>
            <Row style={{ gap: 12 }}>
              <Pressable accessibilityRole="button" accessibilityLabel={t(`View ${r.who}’s profile`)} onPress={() => openCustomer(r.customerId)} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Initial who={r.who} hue={hueOf(r.customerId)} url={r.avatarUrl} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Row style={{ gap: 6 }}>
                    <Txt size={16} weight={700} numberOfLines={1} style={{ flexShrink: 1 }}>{r.who}</Txt>
                    {r.customer?.verified ? <Icon name="badge-check" size={16} color={colors.green} /> : null}
                  </Row>
                  <Row style={{ gap: 5 }}>
                    <Icon name={AM[r.act].icon} size={14} color={colors.gray600} />
                    <Txt size={13} color={colors.gray600}>{actLine(r.act, r.dur)}</Txt>
                  </Row>
                </View>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={t(`Message ${r.who}`)} onPress={() => void openBookingChat(r.id)} style={{ width: 38, height: 38, borderRadius: 12, borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="message-circle" size={17} />
              </Pressable>
              <Pill label="New" bg={colors.blush} fg={colors.ink} height={24} />
            </Row>
            {r.customer ? (
              <View style={{ gap: 4 }}>
                <Txt size={12} color={colors.gray600}>
                  {r.customer.verified ? 'ID verified' : 'ID not verified'}{r.customer.since ? ' · ' + memberSince(r.customer.since) : ''}
                </Txt>
                {r.customer.bio ? <Txt size={13} lh={1.45} color={colors.gray800} numberOfLines={4}>{r.customer.bio}</Txt> : null}
                <TextButton label="View full profile" icon="user-round" size={13} weight={700} onPress={() => openCustomer(r.customerId)} style={{ alignSelf: 'flex-start', paddingVertical: 4 }} />
              </View>
            ) : null}
            <Row style={{ gap: 16 }}>
              <Row style={{ gap: 6 }}><Icon name="calendar" size={15} color={colors.gray600} /><Txt size={13}>{r.day}</Txt></Row>
              <Row style={{ gap: 6 }}><Icon name="clock" size={15} color={colors.gray600} /><Txt size={13}>{r.time}</Txt></Row>
            </Row>
            <Row style={{ gap: 6 }}><Icon name="map-pin" size={15} color={colors.gray600} /><Txt size={13} numberOfLines={1} style={{ flex: 1 }}>{r.place}</Txt></Row>
            {r.note ? (
              <View style={{ paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.sun }}>
                <Txt size={14} lh={1.45} color={colors.gray800}>“{r.note}”</Txt>
              </View>
            ) : null}
            <Txt size={12} color={colors.gray600}>{eur(r.payout / 100)} already paid and held by ZeitMit · released when you enter their meet code</Txt>
            {r.resched ? <ReschedBox bookingId={r.id} resched={r.resched} mine={r.resched.by === 'companion'} other={r.who.split(' ')[0]} current={`${r.day} · ${r.time}`} /> : null}
            <Row style={{ gap: 8 }}>
              <SecondaryButton label="Decline" height={44} radius={12} style={{ flex: 1 }} onPress={() => void declineRequest(r.id)} />
              <PrimaryButton label="Accept" height={44} radius={12} size={14} shadowColor="transparent" style={{ flex: 1 }} onPress={() => void acceptRequest(r.id)} />
            </Row>
            {!r.resched && (r.reschedLeft ?? 1) > 0 ? (
              <TextButton label="Suggest another time" icon="calendar-clock" size={13} weight={700} onPress={() => openReschedule(r.id)} style={{ alignSelf: 'center', marginTop: -4 }} />
            ) : null}
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
