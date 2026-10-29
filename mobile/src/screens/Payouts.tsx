// Companion payouts: balance, the bank account payouts go to, requesting a payout, and history.
// ZeitMit sends each payout by bank transfer and marks it as paid; see backend/src/routes/payouts.ts.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font } from '../theme';
import { eur, whenShort } from '../data';
import { api } from '../api';
import { useStore } from '../store';
import { groupIban, ibanProblem, normalIban, validIban } from '../lib/iban';
import { t } from '../i18n';
import { Icon } from '../ui/Icon';
import { Box, H, Row, Txt } from '../ui/primitives';
import { CircleButton, Pill, PrimaryButton, SecondaryButton, StatusCover, TextButton, usePullRefresh } from '../ui/common';

type Payout = { id: string; amount: number; status: 'requested' | 'paid' | 'rejected'; ibanMasked: string; reference: string | null; note: string | null; createdAt: number; decidedAt: number | null };
type Data = {
  balance: { available: number; pending: number; requested: number; paid: number; nextAvailableAt: number | null };
  account: { holderName: string; ibanMasked: string } | null;
  payouts: Payout[];
  rules: { holdDays: number; min: number };
};

const euros = (cents: number) => eur(cents / 100);

export default function Payouts() {
  const insets = useSafeAreaInsets();
  const [d, setD] = useState<Data | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'save' | 'request' | null>(null);
  const { showToast } = useStore.getState();

  const load = useCallback(async () => {
    try {
      setD(await api<Data>('GET', '/companion/payouts'));
    } catch (e) {
      showToast((e as Error).message);
    }
  }, [showToast]);
  useEffect(() => { void load(); }, [load]);
  const refresh = usePullRefresh(load);

  const request = async () => {
    if (!d || busy) return;
    setBusy('request');
    try {
      const r = await api<{ amount: number; ibanMasked: string }>('POST', '/companion/payouts');
      showToast(`Payout of ${euros(r.amount)} requested. We’ll let you know when it’s sent.`);
      await load();
      void useStore.getState().loadCompanionSide();
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!d) {
    return <View style={{ flex: 1, backgroundColor: colors.sun, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.ink} /></View>;
  }
  const { balance: b, rules } = d;
  const open = b.requested > 0;
  const why = !d.account
    ? 'Add the bank account your payouts go to first.'
    : open
      ? `${euros(b.requested)} is on its way. You can request again once it’s sent.`
      : b.available < rules.min
        ? `You can request a payout from ${euros(rules.min)}.`
        : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.sun }}>
      <StatusCover color={colors.sun} />
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" refreshControl={refresh} contentContainerStyle={{ paddingTop: insets.top + 4, paddingBottom: 40 + insets.bottom }}>
        <Row style={{ paddingTop: 4, paddingHorizontal: 12 }}>
          <CircleButton icon="chevron-left" label="Back" size={40} iconSize={24} border={0} bg="transparent" onPress={() => router.back()} />
        </Row>
        <H size={30} ls={-0.035} style={{ marginTop: 6, marginHorizontal: 20, marginBottom: 16 }}>Payouts</H>
        <View style={{ paddingHorizontal: 20, gap: 14 }}>
          {/* Balance */}
          <Card>
            <View style={{ padding: 18, gap: 4 }}>
              <Txt size={13} weight={600} color={colors.gray600}>Available to withdraw</Txt>
              <H size={40} ls={-0.03}>{euros(Math.max(0, b.available))}</H>
              {b.available < 0 ? (
                <Txt size={13} lh={1.45} color="#B37112">A refund left {euros(-b.available)} to make up. It comes off your next earnings.</Txt>
              ) : null}
            </View>
            <Line label="Pending" value={euros(b.pending)} sub={b.pending > 0 && b.nextAvailableAt ? `Available from ${whenShort(b.nextAvailableAt)}` : `Earnings wait ${rules.holdDays} days after the meet-up`} />
            {open ? <Line label="On its way" value={euros(b.requested)} sub="Requested, being sent by ZeitMit" /> : null}
            <Line label="Paid out so far" value={euros(b.paid)} last />
          </Card>

          <PrimaryButton label={busy === 'request' ? 'Requesting…' : b.available > 0 ? `Request payout of ${euros(b.available)}` : 'Request payout'} dim={!!why || !!busy} onPress={() => void request()} />
          {why ? <Txt size={13} lh={1.45} color={colors.gray600} align="center" style={{ marginTop: -6 }}>{why}</Txt> : null}

          {/* Bank account */}
          <Card>
            <View style={{ padding: 16, gap: 10 }}>
              <Row style={{ gap: 10 }}>
                <Icon name="landmark" size={18} />
                <Txt size={15} weight={700} style={{ flex: 1 }}>Bank account</Txt>
                {d.account && !editing && !open ? <TextButton label="Change" size={14} onPress={() => setEditing(true)} /> : null}
              </Row>
              {d.account && !editing ? (
                <View style={{ gap: 2 }}>
                  <Txt size={15}>{d.account.holderName}</Txt>
                  <Txt kind="mono" size={14} color={colors.gray600}>{d.account.ibanMasked}</Txt>
                  {open ? <Txt size={12} color={colors.gray600} style={{ marginTop: 4 }}>You can change it once your payout is sent.</Txt> : null}
                </View>
              ) : (
                <AccountForm
                  busy={busy === 'save'}
                  onCancel={d.account ? () => setEditing(false) : undefined}
                  onSave={async (holderName, iban) => {
                    setBusy('save');
                    try {
                      await api('PUT', '/companion/payouts/account', { holderName, iban });
                      showToast('Bank account saved');
                      setEditing(false);
                      await load();
                    } catch (e) {
                      showToast((e as Error).message);
                    } finally {
                      setBusy(null);
                    }
                  }}
                />
              )}
            </View>
          </Card>

          {/* History */}
          {d.payouts.length ? (
            <Card>
              <Txt size={15} weight={700} style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 }}>Payout history</Txt>
              {d.payouts.map((p, i) => <PayoutRow key={p.id} p={p} last={i === d.payouts.length - 1} />)}
            </Card>
          ) : null}

          <Row style={{ gap: 10, alignItems: 'flex-start', paddingHorizontal: 4 }}>
            <Icon name="info" size={16} color={colors.gray600} />
            <Txt size={12} lh={1.5} color={colors.gray600} style={{ flex: 1 }}>
              The ZeitMit team sends payouts by bank transfer. You’ll get a notification when yours is on its way; transfers usually arrive within 1–2 working days.
            </Txt>
          </Row>
        </View>
      </ScrollView>
    </View>
  );
}

const Card = ({ children }: { children: ReactNode }) => (
  <Box shadow={4} style={{ backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, borderRadius: 20, overflow: 'hidden' }}>{children}</Box>
);

function Line({ label, value, sub, last }: { label: string; value: string; sub?: string; last?: boolean }) {
  return (
    <Row style={{ gap: 12, paddingVertical: 12, paddingHorizontal: 18, borderTopWidth: 1, borderTopColor: colors.hairline, ...(last ? {} : {}) }}>
      <View style={{ flex: 1 }}>
        <Txt size={14} weight={600}>{label}</Txt>
        {sub ? <Txt size={12} color={colors.gray600}>{sub}</Txt> : null}
      </View>
      <Txt size={15} weight={700} style={{ fontVariant: ['tabular-nums'] }}>{value}</Txt>
    </Row>
  );
}

function AccountForm({ busy, onSave, onCancel }: { busy: boolean; onSave: (holderName: string, iban: string) => void; onCancel?: () => void }) {
  const name0 = useStore((s) => s.user?.name ?? '');
  const [name, setName] = useState(name0);
  const [iban, setIban] = useState('');
  const problem = ibanProblem(iban);
  const ready = name.trim().length >= 2 && validIban(iban);
  const input = [font('body'), { height: 48, paddingHorizontal: 14, borderRadius: 12, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.white, fontSize: 15, color: colors.ink, outlineStyle: 'none' }] as object;
  return (
    <View style={{ gap: 8 }}>
      <Txt size={12} weight={600} color={colors.gray600}>Account holder</Txt>
      <TextInput value={name} onChangeText={setName} accessibilityLabel="Account holder" autoComplete="name" style={input} />
      <Txt size={12} weight={600} color={colors.gray600} style={{ marginTop: 4 }}>IBAN</Txt>
      <TextInput
        value={groupIban(iban)}
        onChangeText={(v) => setIban(normalIban(v).slice(0, 34))}
        accessibilityLabel="IBAN"
        placeholder="DE00 0000 0000 0000 0000 00"
        placeholderTextColor={colors.gray400}
        autoCapitalize="characters"
        autoCorrect={false}
        style={[input, font('mono', 500)]}
      />
      {problem ? <Txt size={12} color={colors.red}>{t(problem)}</Txt> : <Txt size={12} color={colors.gray600}>Use an account in your own name. We check it against your ID.</Txt>}
      <Row style={{ gap: 10, marginTop: 6 }}>
        {onCancel ? <SecondaryButton label="Cancel" height={46} radius={12} size={14} onPress={onCancel} style={{ flex: 1 }} /> : null}
        <PrimaryButton label={busy ? 'Saving…' : 'Save bank account'} height={46} radius={12} size={14} dim={!ready || busy} shadowColor="transparent" onPress={() => onSave(name.trim(), normalIban(iban))} style={{ flex: 2 }} />
      </Row>
    </View>
  );
}

function PayoutRow({ p, last }: { p: Payout; last: boolean }) {
  const st = {
    requested: { label: 'On its way', bg: '#FDF3E2', fg: '#B37112' },
    paid: { label: 'Paid', bg: colors.mintSoft, fg: colors.greenDeep },
    rejected: { label: 'Not sent', bg: '#FCEBEE', fg: '#D9435F' },
  }[p.status];
  return (
    <View style={{ paddingVertical: 12, paddingHorizontal: 16, gap: 4, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.hairline }}>
      <Row style={{ gap: 10 }}>
        <Txt size={15} weight={700} style={{ flex: 1, fontVariant: ['tabular-nums'] }}>{euros(p.amount)}</Txt>
        <Pill label={st.label} bg={st.bg} fg={st.fg} height={24} />
      </Row>
      <Txt size={12} color={colors.gray600}>
        {p.status === 'paid' && p.decidedAt ? `Sent ${whenShort(p.decidedAt)} to ${p.ibanMasked}` : `Requested ${whenShort(p.createdAt)} · ${p.ibanMasked}`}
      </Txt>
      {p.reference ? <Txt size={12} color={colors.gray600}>Reference: {p.reference}</Txt> : null}
      {p.note ? <Txt size={12} lh={1.45} color="#D9435F">{p.note}</Txt> : null}
    </View>
  );
}
