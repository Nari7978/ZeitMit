// A suggested new time on a booking card: the other side accepts or declines it, the side that suggested it can withdraw.
import { useState } from 'react';
import { View } from 'react-native';
import { colors } from '../theme';
import { useStore, type Resched } from '../store';
import { Icon } from './Icon';
import { Row, Txt } from './primitives';
import { PrimaryButton, SecondaryButton, TextButton } from './common';

export function ReschedBox({ bookingId, resched, mine, other, current }: {
  bookingId: string; resched: Resched; mine: boolean; other: string; current: string;
}) {
  const [busy, setBusy] = useState<'accept' | 'decline' | 'withdraw' | null>(null);
  const answer = async (a: 'accept' | 'decline' | 'withdraw') => {
    if (busy) return;
    setBusy(a);
    await useStore.getState().answerReschedule(bookingId, a);
    setBusy(null);
  };
  const when = `${resched.day} · ${resched.time}`;
  return (
    <View style={{ padding: 12, borderRadius: 14, backgroundColor: colors.lilac, gap: 10 }}>
      <Row style={{ gap: 10, alignItems: 'flex-start' }}>
        <Icon name="calendar-clock" size={18} style={{ marginTop: 1 }} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Txt size={14} weight={700}>{mine ? `You suggested ${when}` : `${other} suggests ${when}`}</Txt>
          <Txt size={12} lh={1.45} color={colors.gray800}>{mine ? `Waiting for ${other}. Until then it stays on ${current}.` : `Instead of ${current}.`}</Txt>
        </View>
      </Row>
      {mine ? (
        <TextButton label={busy ? 'Withdrawing…' : 'Withdraw suggestion'} size={13} weight={700} onPress={() => void answer('withdraw')} style={{ alignSelf: 'flex-start', paddingVertical: 2 }} />
      ) : (
        <Row style={{ gap: 8 }}>
          <SecondaryButton label={busy === 'decline' ? 'Declining…' : 'Decline'} height={40} radius={12} size={13} style={{ flex: 1 }} onPress={() => void answer('decline')} />
          <PrimaryButton label={busy === 'accept' ? 'Accepting…' : 'Accept'} height={40} radius={12} size={13} shadowColor="transparent" style={{ flex: 1 }} onPress={() => void answer('accept')} />
        </Row>
      )}
    </View>
  );
}
