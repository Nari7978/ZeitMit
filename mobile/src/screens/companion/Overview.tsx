import { router } from 'expo-router';
import { View } from 'react-native';
import { colors } from '../../theme';
import { AM, eur, hours, isVideo } from '../../data';
import { joinVideoDate } from '../../nav';
import { CODE_OPENS_HOURS, GALLERY_MIN, hueOf, useStore } from '../../store';
import { Icon } from '../../ui/Icon';
import { Box, H, PressBox, Row, Txt } from '../../ui/primitives';
import { PrimaryButton } from '../../ui/common';
import { initials } from '../Account';
import { CompShell, Initial } from './Shell';
import { historyLine } from './History';
import { t } from '../../i18n';
import { feedbackDue, useFeedbackPopup } from '../../lib/feedbackPrompt';

export default function Overview() {
  // Only what this screen shows (the whole store would redraw it on every change anywhere in the app).
  const comp = useStore((s) => s.comp);
  const status = useStore((s) => s.companionStatus);
  const first = useStore((s) => s.user?.first ?? '');
  const name = useStore((s) => s.user?.name ?? '');
  const { openSheet, openFeedback } = useStore.getState();
  const { requests, upcoming, earnings, rate, acts, gallery } = comp;
  const next = upcoming[0];
  const held = earnings.held / 100;
  const live = status === 'approved';
  // Meet-ups happening now (the code can be entered from 2 hours before): enter the customer's code right here.
  const nowS = Date.now() / 1000;
  const { done } = comp;
  // A video date stays here while its booked time runs, even once the call confirmed it, so you can get back in.
  const meeting = [
    ...upcoming.filter((b) => b.startsAt - nowS <= CODE_OPENS_HOURS * 3600),
    ...done.filter((b) => isVideo(b.act) && b.startsAt <= nowS && nowS < b.endsAt),
  ];
  // The latest meet-up that ended in the past week without the private “How did it go?” answered; it also pops up
  // once by itself.
  const ask = feedbackDue(comp.done);
  useFeedbackPopup('companion');

  return (
    <CompShell title={'Hi, ' + first}>
      {!live ? (
        <Row style={{ gap: 12, padding: 16, borderRadius: 20, backgroundColor: colors.amberSoft, alignItems: 'flex-start' }}>
          <Icon name="hourglass" size={20} color="#B37112" style={{ marginTop: 1 }} />
          <View style={{ flex: 1, gap: 4 }}>
            <Txt size={14} weight={700} color="#5E3D08">{status === 'rejected' ? 'Profile not approved' : 'Profile under review'}</Txt>
            <Txt size={13} lh={1.45} color="#7A5413">{status === 'rejected' ? 'You can update your answers and apply again.' : 'Usually 1–3 working days. Your profile isn’t public yet, so requests start once it’s approved.'}</Txt>
          </View>
        </Row>
      ) : null}
      {meeting.map((b) => {
        const first = b.who.split(' ')[0];
        // A video date is joined in the app; the call itself confirms it (no meet code).
        const video = isVideo(b.act);
        return (
          <Box key={b.id} shadow={4} shadowColor={colors.greenDeep} style={[card, { backgroundColor: colors.mintSoft }]}>
            <Row style={{ gap: 12 }}>
              <Initial who={b.who} hue={hueOf(b.customerId)} url={b.avatarUrl} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt size={16} weight={700}>
                  {video ? (b.startsAt <= nowS ? `Video date with ${first} now` : `Video date with ${first} at ${b.time}`) : b.startsAt <= nowS ? `Meeting ${first} now` : `Meeting ${first} at ${b.time}`}
                </Txt>
                <Txt size={13} lh={1.45} color={colors.gray800}>
                  {video ? 'Join from 10 minutes before the start. After 10 minutes on the call together, you get paid.' : 'Ask for their 4-digit meet code and enter it to get paid.'}
                </Txt>
              </View>
            </Row>
            {video ? (
              <PrimaryButton label="Join video date" icon="video" height={46} radius={12} size={14} shadowColor="transparent" onPress={() => joinVideoDate(b.id, b.startsAt)} />
            ) : (
              <PrimaryButton
                label="Enter meet code" icon="key-round" height={46} radius={12} size={14} shadowColor="transparent"
                onPress={() => openSheet('otpin', { otpIn: { uid: b.id, val: '', err: false, done: false, busy: false } })}
              />
            )}
          </Box>
        );
      })}
      {ask ? (
        <PressBox shadow={4} fx="push" onPress={() => openFeedback(ask.id)} accessibilityLabel={t(`How did it go with ${ask.who.split(' ')[0]}?`)} style={[card, { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.lilac }]}>
          <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="shield-check" size={22} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt size={15} weight={700}>{`How did it go with ${ask.who.split(' ')[0]}?`}</Txt>
            <Txt size={13} lh={1.4} color={colors.gray800}>Tell us privately whether you felt safe. Only the safety team sees it.</Txt>
          </View>
          <Icon name="chevron-right" size={18} color={colors.gray600} />
        </PressBox>
      ) : null}
      {status !== 'rejected' && gallery !== null && gallery < GALLERY_MIN ? (
        <PressBox shadow={4} fx="push" onPress={() => router.navigate('/companion/listing')} accessibilityLabel={t('Add more photos')} style={[card, { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.blush }]}>
          <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="images" size={22} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt size={15} weight={700}>Add more photos</Txt>
            <Txt size={13} lh={1.4} color={colors.gray800}>Show at least 3 besides your profile photo. Customers swipe through them.</Txt>
          </View>
          <Icon name="chevron-right" size={18} color={colors.gray600} />
        </PressBox>
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
              <Txt size={13} color={colors.gray600}>{next.day} · {next.time}–{next.end} · {hours(next.dur)}</Txt>
            </View>
            <Icon name="chevron-right" size={18} color={colors.gray400} />
          </Row>
        </PressBox>
      ) : null}
      <PressBox shadow={4} fx="push" onPress={() => router.navigate('/companion/listing')} accessibilityLabel="Your listing" style={[card, { flexDirection: 'row', alignItems: 'center', gap: 14 }]}>
        <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: colors.blush, alignItems: 'center', justifyContent: 'center' }}>
          <Txt size={15} weight={800}>{initials(name)}</Txt>
        </View>
        <View style={{ flex: 1 }}>
          <Txt size={15} weight={700}>Your listing</Txt>
          <Txt size={13} color={colors.gray600}>{`${eur(rate)}/h · ${acts.length} ${acts.length === 1 ? 'activity' : 'activities'}`}</Txt>
        </View>
        <Icon name="chevron-right" size={18} color={colors.gray400} />
      </PressBox>
      <PressBox shadow={4} fx="push" onPress={() => router.push('/history')} accessibilityLabel="Booking history" style={[card, { flexDirection: 'row', alignItems: 'center', gap: 14 }]}>
        <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: colors.butter, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="history" size={22} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt size={15} weight={700}>Booking history</Txt>
          <Txt size={13} color={colors.gray600}>{comp.history.length ? historyLine(comp.history) : 'Past bookings will show here.'}</Txt>
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
          <Money icon="circle-check" label="Available" value={eur(Math.max(0, earnings.available) / 100)} sub={earnings.pending > 0 ? `+ ${eur(earnings.pending / 100)} pending` : 'Ready to withdraw'} bg={colors.mintSoft} />
        </Row>
        <Txt size={12} lh={1.5} color={colors.gray600}>You earn a booking’s money when you enter the customer’s 4-digit code at the meet-up. It can be withdrawn 2 days later, from €20.</Txt>
        <PrimaryButton label="Withdraw" icon="wallet" height={44} radius={12} size={14} weight={700} onPress={() => router.push('/payouts')} />
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
