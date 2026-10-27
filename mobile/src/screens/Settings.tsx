import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { eur, PREF } from '../data';
import { api } from '../api';
import { useStore, type Lang } from '../store';
import { Icon } from '../ui/Icon';
import { Box, Chip, H, Row, Toggle, Txt } from '../ui/primitives';
import { CircleButton, PrimaryButton, SecondaryButton, StatusCover } from '../ui/common';

export type SettingsPage =
  | 'payments' | 'notifications' | 'discovery' | 'language' | 'privacy' | 'blocked' | 'security' | 'verification'
  | 'help' | 'guidelines' | 'terms';

export const openSettings = (page: SettingsPage) => router.push({ pathname: '/settings/[page]', params: { page } });

const SUPPORT_EMAIL = 'support@zeitmit.app';

const TITLES: Record<SettingsPage, string> = {
  payments: 'Payments & credit', notifications: 'Notifications', discovery: 'Discovery preferences', language: 'Language',
  privacy: 'Privacy controls', blocked: 'Blocked accounts', security: 'Account security', verification: 'Verification',
  help: 'Help centre', guidelines: 'Community guidelines', terms: 'Terms & privacy',
};

export default function Settings() {
  const { page } = useLocalSearchParams<{ page: SettingsPage }>();
  const insets = useSafeAreaInsets();
  const Body = BODIES[page] ?? Help;
  return (
    <View style={{ flex: 1, backgroundColor: colors.sun }}>
      <StatusCover color={colors.sun} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: insets.top + 4, paddingBottom: 40 + insets.bottom }}>
        <Row style={{ paddingTop: 4, paddingHorizontal: 12 }}>
          <CircleButton icon="chevron-left" label="Back" size={40} iconSize={24} border={0} bg="transparent" onPress={() => router.back()} />
        </Row>
        <H size={30} ls={-0.035} style={{ marginTop: 6, marginHorizontal: 20, marginBottom: 16 }}>{TITLES[page] ?? 'Settings'}</H>
        <View style={{ paddingHorizontal: 20, gap: 14 }}>
          <Body />
        </View>
      </ScrollView>
    </View>
  );
}

// ---------- building blocks ----------

const Card = ({ children }: { children: ReactNode }) => (
  <Box shadow={4} style={{ backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, borderRadius: 20, overflow: 'hidden' }}>{children}</Box>
);

function ToggleRow({ title, sub, on, onPress, last }: { title: string; sub?: string; on: boolean; onPress: () => void; last?: boolean }) {
  return (
    <Row style={{ gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.hairline }}>
      <View style={{ flex: 1 }}>
        <Txt size={15} weight={600}>{title}</Txt>
        {sub ? <Txt size={12} lh={1.4} color={colors.gray600} style={{ marginTop: 2 }}>{sub}</Txt> : null}
      </View>
      <Toggle on={on} label={title} onPress={onPress} />
    </Row>
  );
}

function RadioRow({ title, sub, on, onPress, last }: { title: string; sub?: string; on: boolean; onPress: () => void; last?: boolean }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.hairline }}>
      <View style={{ flex: 1 }}>
        <Txt size={15} weight={600}>{title}</Txt>
        {sub ? <Txt size={12} color={colors.gray600} style={{ marginTop: 2 }}>{sub}</Txt> : null}
      </View>
      <Icon name={on ? 'circle-check' : 'circle'} size={22} color={on ? colors.ink : colors.gray400} />
    </Pressable>
  );
}

const Para = ({ children }: { children: ReactNode }) => <Txt size={14} lh={1.6} color={colors.gray800}>{children}</Txt>;
const Head = ({ children }: { children: string }) => <Txt size={16} weight={700} style={{ marginTop: 6 }}>{children}</Txt>;

function Note({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <Row style={{ gap: 10, padding: 14, borderRadius: 16, backgroundColor: colors.lilac, alignItems: 'flex-start' }}>
      <Icon name={icon} size={16} style={{ marginTop: 2 }} />
      <Txt size={13} lh={1.5} color={colors.gray800} style={{ flex: 1 }}>{children}</Txt>
    </Row>
  );
}

// ---------- pages ----------

function Payments() {
  const credit = useStore((s) => s.user?.credit ?? 0);
  const bookings = useStore((s) => s.bookings);
  const paid = bookings.filter((b) => b.pay !== 'refunded');
  return (
    <>
      <Card>
        <View style={{ padding: 18, gap: 6 }}>
          <Txt size={13} weight={600} color={colors.gray600}>Gift credit</Txt>
          <H size={34} ls={-0.03}>{eur(credit / 100)}</H>
          <Txt size={13} lh={1.5} color={colors.gray600}>Used automatically on your next booking before your card is charged.</Txt>
          <SecondaryButton label="Redeem a gift code" icon="ticket" height={44} style={{ marginTop: 8 }} onPress={() => useStore.getState().openSheet('redeem')} />
        </View>
      </Card>
      <Note icon="lock">Card payments are handled securely by our payment partner at checkout. ZeitMit never stores your card number. Money is held until you share your meet code, and refunded in full if a request is declined or cancelled 24+ hours before.</Note>
      <Head>Recent payments</Head>
      <Card>
        {paid.length ? paid.slice(0, 20).map((b, i) => (
          <Row key={b.id} style={{ gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: i < Math.min(paid.length, 20) - 1 ? 1 : 0, borderBottomColor: colors.hairline }}>
            <View style={{ flex: 1 }}>
              <Txt size={14} weight={600}>{b.companionName}</Txt>
              <Txt size={12} color={colors.gray600}>{b.day} · {b.pay === 'held' ? 'Held by ZeitMit' : 'Released'}</Txt>
            </View>
            <Txt size={14} weight={700}>{eur(b.total / 100)}</Txt>
          </Row>
        )) : <Txt size={14} color={colors.gray600} style={{ padding: 16 }}>No payments yet.</Txt>}
      </Card>
    </>
  );
}

function Notifications() {
  const p = useStore((s) => s.user!.prefs);
  const save = useStore((s) => s.savePrefs);
  return (
    <>
      <Card>
        <ToggleRow title="Messages" sub="New messages from companions or customers." on={p.pushMessages} onPress={() => save({ pushMessages: !p.pushMessages })} />
        <ToggleRow title="Bookings" sub="Requests, confirmations, payments and reminders." on={p.pushBookings} onPress={() => save({ pushBookings: !p.pushBookings })} />
        <ToggleRow title="Email updates" sub="Booking receipts and account emails." on={p.emailUpdates} onPress={() => save({ emailUpdates: !p.emailUpdates })} />
        <ToggleRow title="News and offers" sub="Occasional updates from ZeitMit. Off by default." on={p.marketing} onPress={() => save({ marketing: !p.marketing })} last />
      </Card>
      <Note icon="shield-check">Safety alerts, like missed check-ins, are always sent.</Note>
    </>
  );
}

function Discovery() {
  const p = useStore((s) => s.user!.prefs);
  const save = useStore((s) => s.savePrefs);
  const [max, setMax] = useState(p.discoveryMaxRate);
  const apply = (patch: Partial<typeof p>) => {
    save(patch);
    // Also apply to the current search so the change is visible straight away.
    useStore.getState().setF({ ...(patch.discoveryPref ? { pref: patch.discoveryPref } : {}), ...(patch.discoveryMaxRate ? { max: patch.discoveryMaxRate } : {}) });
  };
  return (
    <>
      <Para>Private to you. Used only to filter your results, never shown on your profile.</Para>
      <Card>
        <View style={{ padding: 16, gap: 12 }}>
          <Txt size={15} weight={700}>Show me</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(Object.keys(PREF) as (keyof typeof PREF)[]).map((k) => (
              <Chip key={k} label={PREF[k]} on={p.discoveryPref === k} height={40} radius={12} weight={600} style={{ width: '47%', flexGrow: 1 }} onPress={() => apply({ discoveryPref: k })} />
            ))}
          </View>
          <Row style={{ justifyContent: 'space-between', marginTop: 8 }}>
            <Txt size={15} weight={700}>Hourly rate</Txt>
            <Txt size={13} weight={600}>{max >= 60 ? 'Any price' : 'Up to ' + eur(max) + ' / hour'}</Txt>
          </Row>
          <Slider minimumValue={15} maximumValue={60} step={1} value={max} onValueChange={(v) => setMax(Math.round(v))} onSlidingComplete={(v) => apply({ discoveryMaxRate: Math.round(v) })} minimumTrackTintColor={colors.ink} maximumTrackTintColor={colors.gray300} thumbTintColor={colors.ink} accessibilityLabel="Maximum hourly rate" />
        </View>
      </Card>
    </>
  );
}

function Language() {
  const lang = useStore((s) => s.user!.language);
  const set = useStore((s) => s.setLanguage);
  const opts: [Lang, string, string][] = [['auto', 'Phone setting', 'Follows your phone’s language'], ['en', 'English', ''], ['de', 'Deutsch', '']];
  return (
    <Card>
      {opts.map(([k, t, sub], i) => <RadioRow key={k} title={t} sub={sub || undefined} on={lang === k} onPress={() => set(k)} last={i === opts.length - 1} />)}
    </Card>
  );
}

function Privacy() {
  const email = useStore((s) => s.user!.email);
  return (
    <>
      <Head>Your data</Head>
      <Para>We only show companions your first name and photo. Your email, date of birth and booking history stay private. Exact meeting places are shared only with the person you booked.</Para>
      <SecondaryButton label="Request a copy of my data" icon="mail" height={46} onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Data%20request&body=Please%20send%20me%20a%20copy%20of%20my%20data.%20Account:%20${encodeURIComponent(email)}`)} />
      <SecondaryButton label="Delete my account" icon="trash-2" height={46} onPress={() => useStore.getState().openSheet('delete')} />
    </>
  );
}

function Blocked() {
  const [list, setList] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => {
    api<{ id: string; name: string }[]>('GET', '/me/blocks').then(setList).catch((e) => { setList([]); useStore.getState().showToast(e.message); });
  }, []);
  const unblock = async (id: string, name: string) => {
    try {
      await api('DELETE', `/me/blocks/${id}`);
      setList((l) => (l ?? []).filter((x) => x.id !== id));
      useStore.getState().showToast(`${name} is unblocked.`);
    } catch (e) {
      useStore.getState().showToast((e as Error).message);
    }
  };
  if (!list) return <Txt size={14} color={colors.gray600}>Loading…</Txt>;
  return (
    <>
      <Para>Blocked people can’t message you, book you or see your profile.</Para>
      <Card>
        {list.length ? list.map((x, i) => (
          <Row key={x.id} style={{ gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: i < list.length - 1 ? 1 : 0, borderBottomColor: colors.hairline }}>
            <Txt size={15} weight={600} style={{ flex: 1 }}>{x.name}</Txt>
            <SecondaryButton label="Unblock" height={36} radius={10} size={13} shadow={0} style={{ paddingHorizontal: 14 }} onPress={() => void unblock(x.id, x.name)} />
          </Row>
        )) : <Txt size={14} color={colors.gray600} style={{ padding: 16 }}>You haven’t blocked anyone.</Txt>}
      </Card>
    </>
  );
}

function Security() {
  const email = useStore((s) => s.user!.email);
  return (
    <>
      <Card>
        <View style={{ padding: 16, gap: 4 }}>
          <Txt size={13} weight={600} color={colors.gray600}>Login email</Txt>
          <Txt size={16} weight={700}>{email}</Txt>
        </View>
      </Card>
      <Note icon="key-round">ZeitMit has no passwords. Each login needs a one-time 6-digit code sent to your email, so nobody can get in without access to your inbox. Codes expire after 10 minutes and lock after 5 wrong tries.</Note>
      <Para>To change your login email, contact support from the email you use now.</Para>
      <SecondaryButton label="Contact support" icon="mail" height={46} onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Change%20login%20email`)} />
      <PrimaryButton label="Log out" icon="log-out" height={48} onPress={() => void useStore.getState().logout()} />
    </>
  );
}

function Verification() {
  const user = useStore((s) => s.user!);
  const comp = useStore((s) => s.companionStatus);
  return (
    <Card>
      <Row style={{ gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: colors.hairline }}>
        <Icon name="shield-check" size={20} color={user.ageConfirmed ? colors.green : colors.gray400} />
        <View style={{ flex: 1 }}>
          <Txt size={15} weight={600}>Age 18+</Txt>
          <Txt size={12} color={colors.gray600}>{user.ageConfirmed ? 'Confirmed when you signed up.' : 'Not confirmed yet.'}</Txt>
        </View>
      </Row>
      <Row style={{ gap: 12, padding: 16 }}>
        <Icon name="id-card" size={20} color={comp === 'approved' ? colors.green : colors.gray400} />
        <View style={{ flex: 1 }}>
          <Txt size={15} weight={600}>Companion ID check</Txt>
          <Txt size={12} color={colors.gray600}>
            {comp === 'approved' ? 'Verified. Your ID photo was deleted after the check.' : comp === 'pending' ? 'Under review, usually 1–3 working days.' : comp === 'rejected' ? 'Not approved. Check your email for details.' : 'Only needed if you become a companion.'}
          </Txt>
        </View>
      </Row>
    </Card>
  );
}

function Help() {
  const faqs: [string, string][] = [
    ['How does payment work?', 'You pay when you send a request. ZeitMit holds the money and releases it to the companion only when you share your 4-digit meet code in person. If they decline, or you cancel 24+ hours before, you get a full refund.'],
    ['Where can we meet?', 'Always in a public place: a café, park entrance, museum or venue. Home addresses, hotels and private locations are never allowed.'],
    ['What isn’t allowed?', 'Anything sexual, kissing or intimacy, overnight plans, and paying or meeting outside ZeitMit. Report anyone who asks.'],
    ['How do I stay safe?', 'Start a safety check-in from a confirmed booking. We’ll check on you and alert your trusted contact if you don’t answer. In an emergency, call 112.'],
    ['How do gift codes work?', 'Redeem the code in Profile → Redeem a gift code. The credit is used automatically on your next booking.'],
    ['How do I become a companion?', 'Go to Profile → Become a Companion. We review every profile and check your ID before it goes live.'],
  ];
  return (
    <>
      {faqs.map(([q, a]) => (
        <Card key={q}>
          <View style={{ padding: 16, gap: 6 }}>
            <Txt size={15} weight={700}>{q}</Txt>
            <Txt size={14} lh={1.55} color={colors.gray800}>{a}</Txt>
          </View>
        </Card>
      ))}
      <SecondaryButton label="Email support" icon="mail" height={46} onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} />
    </>
  );
}

function Guidelines() {
  const rules: [string, string][] = [
    ['Non-sexual, always', 'ZeitMit is for company: friendship, dates in public, plus-ones. Sexual services, kissing and intimacy are never part of a booking.'],
    ['Public places only', 'Meet at cafés, parks, museums and venues. Never at home, in hotels or private locations.'],
    ['Respect boundaries', 'Every companion lists what they’re comfortable with. Agree to them before booking and stick to them.'],
    ['Stay on ZeitMit', 'Chat, book and pay only in the app. Asking to move off the platform or pay in cash breaks the rules.'],
    ['Be kind and honest', 'No harassment, hate or fake profiles. Show up on time and cancel early if plans change.'],
    ['18+ only', 'Everyone on ZeitMit must be an adult. Companions are ID-checked.'],
  ];
  return (
    <>
      {rules.map(([t, d], i) => (
        <Row key={t} style={{ gap: 12, alignItems: 'flex-start' }}>
          <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
            <Txt size={14} weight={700} color={colors.sun}>{String(i + 1)}</Txt>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt size={15} weight={700}>{t}</Txt>
            <Txt size={14} lh={1.5} color={colors.gray800}>{d}</Txt>
          </View>
        </Row>
      ))}
      <Note icon="flag">Breaking these rules can lead to suspension. Report problems from any profile or chat.</Note>
    </>
  );
}

function Terms() {
  return (
    <>
      <Note icon="info">Summary for users. The full legal terms and privacy policy will be published here before launch.</Note>
      <Head>Terms of use</Head>
      <Para>ZeitMit connects adults who want company with companions who offer their time for public, non-sexual activities. Companions are independent and set their own rates, activities and boundaries. Bookings are paid through ZeitMit, which holds payments until the meet code is shared. ZeitMit charges a 10% service fee on each booking.</Para>
      <Head>Privacy</Head>
      <Para>We store your email, name, profile, bookings and messages to run the service, on servers in the EU. ID photos for companion checks are deleted as soon as the check is done. We never sell your data. You can request a copy of your data or delete your account at any time in Privacy controls.</Para>
      <Head>Contact</Head>
      <Para>{SUPPORT_EMAIL}</Para>
    </>
  );
}

const BODIES: Record<SettingsPage, () => ReactNode> = {
  payments: Payments, notifications: Notifications, discovery: Discovery, language: Language, privacy: Privacy,
  blocked: Blocked, security: Security, verification: Verification, help: Help, guidelines: Guidelines, terms: Terms,
};
