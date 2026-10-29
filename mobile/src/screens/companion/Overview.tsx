import { router } from 'expo-router';
import { View } from 'react-native';
import { colors } from '../../theme';
import { AM, eur, hours } from '../../data';
import { hueOf, useStore } from '../../store';
import { Icon } from '../../ui/Icon';
import { Box, H, PressBox, Row, Txt } from '../../ui/primitives';
import { PrimaryButton } from '../../ui/common';
import { initials } from '../Account';
import { CompShell, Initial } from './Shell';
import { t } from '../../i18n';

export default function Overview() {
  const s = useStore();
  const { requests, upcoming, earnings, rate, acts } = s.comp;
  const next = upcoming[0];
  const held = earnings.held / 100;
  const released = earnings.released / 100;
  const live = s.companionStatus === 'approved';

  return (
    <CompShell title={'Hi, ' + (s.user?.first ?? '')}>
      {!live ? (
        <Row style={{ gap: 12, padding: 16, borderRadius: 20, backgroundColor: colors.amberSoft, alignItems: 'flex-start' }}>
          <Icon name="hourglass" size={20} color="#B37112" style={{ marginTop: 1 }} />
          <View style={{ flex: 1, gap: 4 }}>
            <Txt size={14} weight={700} color="#5E3D08">{s.companionStatus === 'rejected' ? 'Profile not approved' : 'Profile under review'}</Txt>
            <Txt size={13} lh={1.45} color="#7A5413">{s.companionStatus === 'rejected' ? 'You can update your answers and apply again.' : 'Usually 1–3 working days. Your profile isn’t public yet, so requests start once it’s approved.'}</Txt>
          </View>
        </Row>
      ) : null}
      <Row style={{ gap: 12 }}>
        <StatTile n={requests.length} label="New requests" onPress={() => router.navigate('/companion/requests')} />
        <StatTile n={upcoming.length} label="Upcoming" onPress={() => router.navigate('/companion/calendar')} />
      </Row>
      {next ? (
        <PressBox shadow={4} fx="push" onPress={() => router.navigate('/companion/calendar')} accessibilityLabel={t('Next up')} style={card}>
          <Txt size={13} weight={600} color={colors.gray600}>Next up</Txt>
          <Row style={{ gap: 12 }}>
            <Initial who={next.who} hue={hueOf(next.customerId)} url={next.avatarUrl} />
            <View style={{ flex: 1 }}>
              <Txt size={16} weight={700}>{next.who} · {AM[next.act].label}</Txt>
              <Txt size={13} color={colors.gray600}>{next.day} · {next.time} · {hours(next.dur)}</Txt>
            </View>
            <Icon name="chevron-right" size={18} color={colors.gray400} />
          </Row>
        </PressBox>
      ) : null}
      <PressBox shadow={4} fx="push" onPress={() => router.navigate('/companion/listing')} accessibilityLabel="Your listing" style={[card, { flexDirection: 'row', alignItems: 'center', gap: 14 }]}>
        <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: colors.blush, alignItems: 'center', justifyContent: 'center' }}>
          <Txt size={15} weight={800}>{initials(s.user?.name ?? '')}</Txt>
        </View>
        <View style={{ flex: 1 }}>
          <Txt size={15} weight={700}>Your listing</Txt>
          <Txt size={13} color={colors.gray600}>{eur(rate)}/h · {acts.length} activities</Txt>
        </View>
        <Icon name="chevron-right" size={18} color={colors.gray400} />
      </PressBox>
      <Box shadow={4} style={[card, { borderWidth: 2.5, padding: 18 }]}>
        <Row style={{ gap: 8 }}>
          <Icon name="wallet" size={18} />
          <Txt size={15} weight={700}>Earnings</Txt>
        </Row>
        <Row style={{ gap: 10, alignItems: 'stretch' }}>
          <Money icon="lock" label="Held" value={eur(held)} sub="Paid, waiting for meet code" bg={colors.lilac} />
          <Money icon="circle-check" label="Released" value={eur(released)} sub={`${earnings.releasedCount} confirmed with code`} bg={colors.mintSoft} />
        </Row>
        <Txt size={12} lh={1.5} color={colors.gray600}>Money moves to you the moment you enter the customer’s 4-digit code at the meet-up. Payouts to your bank go out weekly.</Txt>
        <PrimaryButton label="Enter a meet code" icon="key-round" height={44} radius={12} size={14} weight={700} onPress={() => router.navigate('/companion/calendar')} />
      </Box>
    </CompShell>
  );
}

const card = { padding: 16, borderRadius: 20, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, gap: 12 };

function StatTile({ n, label, onPress }: { n: number; label: string; onPress: () => void }) {
  return (
    <PressBox shadow={4} fx="push" onPress={onPress} accessibilityLabel={`${n} ${label}`} style={{ flex: 1, gap: 4, padding: 16, borderRadius: 20, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.white }}>
      <H size={30}>{String(n)}</H>
      <Txt size={13} color={colors.gray600}>{label}</Txt>
    </PressBox>
  );
}

function Money({ icon, label, value, sub, bg }: { icon: string; label: string; value: string; sub: string; bg: string }) {
  return (
    <View style={{ flex: 1, padding: 12, borderRadius: 14, borderWidth: 2, borderColor: colors.ink, backgroundColor: bg }}>
      <Row style={{ gap: 5 }}>
        <Icon name={icon} size={13} />
        <Txt size={12} weight={700}>{label}</Txt>
      </Row>
      <H size={26} ls={-0.03} style={{ marginTop: 2 }}>{value}</H>
      <Txt size={11} color={colors.gray800}>{sub}</Txt>
    </View>
  );
}
