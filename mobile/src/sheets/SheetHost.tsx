// Bottom sheets (filters, sort, gift, safety, meet code, …) rendered above every screen.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, BackHandler, Easing, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, TextInput, useWindowDimensions, View, type TextInputInstance } from 'react-native';
import Slider from '@react-native-community/slider';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font } from '../theme';
import { A, AM, ageStr, eur, LANGS, PREF, SORT, WHEN } from '../data';
import { filtered, FREE_CANCEL_HOURS, priceOf, toggleIn, useStore, type SheetKind } from '../store';
import { openProfile } from '../nav';
import { Icon } from '../ui/Icon';
import { Box, Chip, Confetti, Enter, H, PressBox, Row, Stripes, Toggle, Txt, Photo } from '../ui/primitives';
import { CircleButton, PrimaryButton, SecondaryButton, TextButton } from '../ui/common';
import { t } from '../i18n';
import { sendSms, sendWhatsApp } from '../lib/whatsapp';
import { shareMessage, sosMessage } from '../lib/checkinText';

export function SheetHost() {
  const sheet = useStore((s) => s.sheet);
  const close = useStore((s) => s.closeSheet);
  const { height } = useWindowDimensions();
  const y = useRef(new Animated.Value(height)).current;

  useEffect(() => {
    if (!sheet) return;
    y.setValue(height);
    Animated.timing(y, { toValue: 0, duration: 320, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: true }).start();
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => sub.remove();
  }, [sheet, y, height, close]);

  if (!sheet) return null;
  const tall = sheet === 'filter';
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 80 }}>
      <Enter style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} duration={200}>
        <Pressable accessibilityLabel="Close sheet" onPress={close} style={{ flex: 1, backgroundColor: colors.scrim }} />
      </Enter>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, justifyContent: 'flex-end' }} pointerEvents="box-none">
        <Animated.View
          accessibilityViewIsModal
          style={{
            height: tall ? '92%' : undefined, maxHeight: '92%', backgroundColor: colors.white, borderTopLeftRadius: 28, borderTopRightRadius: 28,
            transform: [{ translateY: y }], shadowColor: 'rgb(18,14,38)', shadowOpacity: 0.15, shadowRadius: 20, shadowOffset: { width: 0, height: -10 }, elevation: 20,
          }}
        >
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
            <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: colors.gray300 }} />
          </View>
          <SheetBody kind={sheet} />
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

function SheetBody({ kind }: { kind: SheetKind }) {
  switch (kind) {
    case 'filter': return <FilterSheet />;
    case 'sort': return <SortSheet />;
    case 'city': return <CitySheet />;
    case 'chatmenu': return <ChatMenuSheet />;
    case 'report': return <ReportSheet />;
    case 'review': return <ReviewSheet />;
    case 'edit': return <EditSheet />;
    case 'saved': return <SavedSheet />;
    case 'gift': return <GiftSheet />;
    case 'safety': return <SafetySheet />;
    case 'sos': return <SosSheet />;
    case 'checkinShare': return <CheckinShareSheet />;
    case 'cancel': return <CancelSheet />;
    case 'otp': return <OtpSheet />;
    case 'otpin': return <OtpInSheet />;
    case 'delete': return <DeleteSheet />;
    case 'redeem': return <RedeemSheet />;
  }
}

function Pad({ children, scroll }: { children: ReactNode; scroll?: boolean }) {
  const insets = useSafeAreaInsets();
  const style = { paddingTop: 8, paddingHorizontal: 20, paddingBottom: Math.max(30, insets.bottom + 8) };
  if (scroll) return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={style}>{children}</ScrollView>;
  return <View style={style}>{children}</View>;
}

const SheetTitle = ({ children, style }: { children: ReactNode; style?: object }) => <Txt size={17} weight={700} style={[{ marginTop: 6, marginBottom: 10 }, style]}>{children}</Txt>;
const BigTitle = ({ children }: { children: ReactNode }) => <H size={24} ls={-0.03} style={{ marginTop: 6, marginBottom: 4 }}>{children}</H>;

function OptionRow({ label, on, onPress, color = colors.ink, note, last, height = 54, size = 15 }: { label: string; on: boolean; onPress: () => void; color?: string; note?: string; last?: boolean; height?: number; size?: number }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, height, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.hairline }}>
      <Txt size={size} color={color} style={{ flex: 1 }}>{label}</Txt>
      {note ? <Txt size={12} color={colors.gray600}>{note}</Txt> : null}
      <Icon name={on ? 'circle-check' : 'circle'} size={20} color={on ? colors.ink : colors.gray400} />
    </Pressable>
  );
}

const input = { borderRadius: 14, borderWidth: 2, borderColor: colors.ink, paddingHorizontal: 14, fontSize: 16, color: colors.ink, backgroundColor: colors.white, outlineStyle: 'none' } as object;

// ---------- Search ----------

function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <>
      <Row style={{ justifyContent: 'space-between', marginTop: 24, marginBottom: 10 }}>
        <Txt size={15} weight={700}>{title}</Txt>
        {right}
      </Row>
      {children}
    </>
  );
}
const Grid = ({ children, cols = 2 }: { children: ReactNode; cols?: number }) => (
  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{Array.isArray(children) ? children.map((c, i) => <View key={i} style={{ width: cols === 2 ? '48.5%' : '31.5%', flexGrow: 1 }}>{c}</View>) : children}</View>
);
const Opt = ({ label, on, onPress, h = 42 }: { label: string; on: boolean; onPress: () => void; h?: number }) => <Chip label={label} on={on} onPress={onPress} height={h} radius={12} weight={600} />;

function FilterSheet() {
  const { f, setF, clearAll, query, sort, closeSheet, companions } = useStore();
  const n = filtered(companions, query, f, sort).length;
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1 }}>
      <Row style={{ justifyContent: 'space-between', paddingTop: 6, paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: colors.ink }}>
        <CircleButton icon="x" label="Close" size={36} iconSize={17} border={0} bg={colors.butter} onPress={closeSheet} />
        <Txt size={16} weight={700}>Filters</Txt>
        <TextButton label="Clear all" onPress={clearAll} />
      </Row>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 6 - 8, paddingHorizontal: 20, paddingBottom: 20 }}>
        <Section title="Type of company">
          <Grid>{[['all', 'Everyone'], ['date', 'Date-style only']].map(([k, l]) => <Opt key={k} label={l} on={f.type === k} onPress={() => setF({ type: k as 'all' | 'date' })} />)}</Grid>
        </Section>
        <Section title="Activity">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {A.map((a) => <Chip key={a.id} label={a.label} icon={a.icon} padL={11} padR={13} on={f.acts.includes(a.id)} onPress={() => setF({ acts: toggleIn(useStore.getState().f.acts, a.id) })} />)}
          </View>
        </Section>
        <Section title="When">
          <Grid>{(Object.keys(WHEN) as (keyof typeof WHEN)[]).map((k) => <Opt key={k} label={WHEN[k]} on={f.when === k} onPress={() => setF({ when: k })} />)}</Grid>
        </Section>
        <Section title="Hourly rate" right={<Txt size={13} weight={600}>{f.max >= 60 ? 'Any price' : 'Up to ' + eur(f.max) + ' / hour'}</Txt>}>
          <Slider
            accessibilityLabel="Maximum hourly rate"
            minimumValue={15}
            maximumValue={60}
            step={1}
            value={f.max}
            onValueChange={(v) => setF({ max: Math.round(v) })}
            minimumTrackTintColor={colors.ink}
            maximumTrackTintColor={colors.gray300}
            thumbTintColor={colors.ink}
          />
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt size={12} color={colors.gray600}>€15</Txt>
            <Txt size={12} color={colors.gray600}>€60+</Txt>
          </Row>
        </Section>
        <Section title="Languages">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {LANGS.map((l) => <Chip key={l} label={l} on={f.langs.includes(l)} onPress={() => setF({ langs: toggleIn(useStore.getState().f.langs, l) })} />)}
          </View>
        </Section>
        <Section title="Rating">
          <Grid cols={3}>{([[0, 'Any'], [4.5, '4.5+'], [4.8, '4.8+']] as const).map(([v, l]) => <Opt key={l} label={l} on={f.rating === v} onPress={() => setF({ rating: v })} />)}</Grid>
        </Section>
        <View style={{ marginTop: 28, padding: 16, borderRadius: 18, backgroundColor: colors.sun, borderWidth: 2, borderColor: colors.ink }}>
          <Row style={{ gap: 8 }}>
            <Icon name="lock" size={15} color={colors.gray600} />
            <Txt size={15} weight={700}>Companion preferences <Txt size={13} color={colors.gray600}>optional</Txt></Txt>
          </Row>
          <Txt size={12} lh={1.5} color={colors.gray600} style={{ marginTop: 6, marginBottom: 12 }}>Private to you. Used only to filter your results, never shown on your profile.</Txt>
          <Grid>{(Object.keys(PREF) as (keyof typeof PREF)[]).map((k) => <Opt key={k} h={40} label={PREF[k]} on={f.pref === k} onPress={() => setF({ pref: k })} />)}</Grid>
          <Row style={{ gap: 12, marginTop: 16, paddingTop: 14, borderTopWidth: 2, borderTopColor: colors.ink }}>
            <View style={{ flex: 1 }}>
              <Txt size={14} weight={600}>LGBTQ+-friendly only</Txt>
              <Txt size={12} lh={1.4} color={colors.gray600} style={{ marginTop: 2 }}>Shows companions who opted in to this label themselves.</Txt>
            </View>
            <Toggle on={f.lgbtq} label="LGBTQ+-friendly only" onPress={() => setF({ lgbtq: !f.lgbtq })} />
          </Row>
        </View>
      </ScrollView>
      <View style={{ paddingTop: 12, paddingHorizontal: 20, paddingBottom: Math.max(30, insets.bottom + 8), borderTopWidth: 2, borderTopColor: colors.ink }}>
        <PrimaryButton label={'Show ' + n + (n === 1 ? ' companion' : ' companions')} onPress={closeSheet} />
      </View>
    </View>
  );
}

function SortSheet() {
  const sort = useStore((s) => s.sort);
  return (
    <Pad>
      <SheetTitle>Sort by</SheetTitle>
      {(Object.keys(SORT) as (keyof typeof SORT)[]).map((k, i, arr) => (
        <OptionRow key={k} label={SORT[k]} on={sort === k} last={i === arr.length - 1} onPress={() => useStore.setState({ sort: k, sheet: null })} />
      ))}
    </Pad>
  );
}

function CitySheet() {
  const city = useStore((s) => s.city);
  return (
    <Pad>
      <SheetTitle>City</SheetTitle>
      {([['Berlin', true], ['Hamburg', false], ['Munich', false], ['Cologne', false]] as const).map(([n, live]) => (
        <OptionRow
          key={n}
          label={n}
          note={live ? 'Live' : 'Coming soon'}
          color={live ? colors.ink : colors.gray400}
          on={n === city}
          onPress={() => (live ? useStore.setState({ city: n, sheet: null }) : useStore.getState().showToast(n + ' is coming soon'))}
        />
      ))}
      <Txt size={12} color={colors.gray600} style={{ marginTop: 12 }}>We show approximate areas only, never exact locations.</Txt>
    </Pad>
  );
}

// ---------- Chat & safety reporting ----------

function MenuRow({ icon, label, onPress, color = colors.ink, last }: { icon: string; label: string; onPress: () => void; color?: string; last?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, height: 56, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.hairline }}>
      <Icon name={icon} size={19} color={color} />
      <Txt size={15} color={color}>{label}</Txt>
    </Pressable>
  );
}

function ChatMenuSheet() {
  const key = useStore((s) => s.sheetChat);
  const cust = useStore((s) => s.convos.find((c) => c.id === key));
  const comp = useStore((s) => s.compConvos.find((c) => c.id === key));
  const { closeSheet, openSheet, block } = useStore.getState();
  // From the customer side the other person is the companion; from companion mode, the customer.
  const other = cust ? cust.cid : comp?.customerId;
  return (
    <Pad>
      {cust ? (
        <MenuRow icon="user-round" label="View profile" onPress={() => {
          closeSheet();
          router.back();
          openProfile(cust.cid);
        }} />
      ) : null}
      <MenuRow icon="flag" label="Report" onPress={() => openSheet('report', { reportReason: null, reportTarget: other ?? null })} />
      <MenuRow icon="ban" label="Block" color={colors.red} last onPress={() => {
        if (!other) return;
        void block(other).then((ok) => { if (ok) { closeSheet(); router.back(); } });
      }} />
    </Pad>
  );
}

const REASONS = ['Asked for something sexual', 'Asked to pay or talk off ZeitMit', 'Harassment or hate', 'Fake profile or impersonation', 'Something else'];

function ReportSheet() {
  const reason = useStore((s) => s.reportReason);
  return (
    <Pad>
      <SheetTitle style={{ marginBottom: 4 }}>What’s wrong?</SheetTitle>
      <Txt size={13} color={colors.gray600} style={{ marginBottom: 8 }}>Reports are confidential. The other person isn’t told who reported them.</Txt>
      {REASONS.map((r) => <OptionRow key={r} label={r} size={14.5} height={52} on={reason === r} onPress={() => useStore.setState({ reportReason: r })} />)}
      <PrimaryButton
        label="Send report"
        bg={colors.red}
        shadowColor="transparent"
        dim={!reason}
        style={{ marginTop: 16 }}
        onPress={() => void useStore.getState().report()}
      />
    </Pad>
  );
}

// ---------- Account ----------

function ReviewSheet() {
  const review = useStore((s) => s.review);
  const name = useStore((s) => {
    const b = s.bookings.find((x) => x.id === s.review.bid);
    return b ? b.companionName : '';
  });
  const set = (o: Partial<typeof review>) => useStore.setState({ review: { ...review, ...o } });
  return (
    <Pad>
      <SheetTitle style={{ marginBottom: 4 }}>How was your time with {name}?</SheetTitle>
      <Txt size={13} color={colors.gray600} style={{ marginBottom: 14 }}>Reviews are public and linked to a completed booking.</Txt>
      <Row style={{ gap: 6, justifyContent: 'center', marginBottom: 16 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} accessibilityRole="button" accessibilityLabel={`${n} stars`} onPress={() => set({ stars: n })} style={{ padding: 2 }}>
            <Txt size={36} lh={40} color={n <= review.stars ? colors.amber : colors.gray300}>★</Txt>
          </Pressable>
        ))}
      </Row>
      <TextInput value={review.text} onChangeText={(t) => set({ text: t.slice(0, 300) })} accessibilityLabel="Review" placeholder={t("What made it a good time?")} placeholderTextColor={colors.gray400} multiline textAlignVertical="top" style={[font('body'), input, { height: 110, padding: 14, fontSize: 15, lineHeight: 22 }]} />
      <PrimaryButton label="Post review" style={{ marginTop: 14 }} onPress={() => void useStore.getState().submitReview()} />
    </Pad>
  );
}

function EditSheet() {
  const edit = useStore((s) => s.edit ?? { name: s.user?.name ?? '', bio: s.user?.bio ?? '' });
  const set = (o: Partial<typeof edit>) => useStore.setState({ edit: { ...edit, ...o } });
  const save = () => void useStore.getState().saveEdit();
  return (
    <Pad>
      <SheetTitle style={{ marginBottom: 14 }}>Personal details</SheetTitle>
      <Txt size={13} weight={600} style={{ marginBottom: 6 }}>Name</Txt>
      <TextInput value={edit.name} onChangeText={(t) => set({ name: t })} accessibilityLabel="Name" style={[font('body'), input, { height: 50 }]} />
      <Txt size={13} weight={600} style={{ marginTop: 14, marginBottom: 6 }}>About</Txt>
      <TextInput value={edit.bio} onChangeText={(t) => set({ bio: t })} accessibilityLabel="About" multiline textAlignVertical="top" style={[font('body'), input, { height: 96, padding: 14, fontSize: 15, lineHeight: 22 }]} />
      <Txt size={12} color={colors.gray600} style={{ marginTop: 8 }}>Email, phone and date of birth are private and never shown to companions.</Txt>
      <PrimaryButton label="Save" style={{ marginTop: 14 }} onPress={save} />
    </Pad>
  );
}

function SavedSheet() {
  const saved = useStore((s) => s.saved);
  const byId = useStore((s) => s.byId);
  return (
    <Pad scroll>
      <SheetTitle>Saved companions</SheetTitle>
      {saved.map((k) => {
        const c = byId[k];
        if (!c) return null;
        return (
          <Pressable key={k} accessibilityRole="button" onPress={() => openProfile(k)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.hairline }}>
            <View style={{ width: 48, height: 48, borderRadius: 14, overflow: 'hidden' }}><Photo hue={c.hue} url={c.photoUrl} /></View>
            <View style={{ flex: 1 }}>
              <Txt size={15} weight={600}>{c.name}{ageStr(c)}</Txt>
              <Txt size={13} color={colors.gray600}>{c.area} · {eur(c.rate)}/h</Txt>
            </View>
            <Icon name="chevron-right" size={18} color={colors.gray400} />
          </Pressable>
        );
      })}
      {!saved.length ? <Txt size={14} color={colors.gray600}>Tap the heart on any profile to save it here.</Txt> : null}
    </Pad>
  );
}

function DeleteSheet() {
  const { closeSheet } = useStore.getState();
  return (
    <Pad>
      <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: colors.redSoft, alignItems: 'center', justifyContent: 'center', marginTop: 8, marginBottom: 14 }}>
        <Icon name="triangle-alert" size={22} color={colors.red} />
      </View>
      <Txt size={19} weight={700} style={{ marginBottom: 6 }}>Delete your account?</Txt>
      <Txt size={14} lh={1.55} color={colors.gray800}>Your profile, messages and booking history are permanently removed after 30 days. Active bookings need to be completed or cancelled first.</Txt>
      <Row style={{ gap: 8, marginTop: 20 }}>
        <SecondaryButton label="Keep account" height={50} size={15} style={{ flex: 1 }} onPress={closeSheet} />
        <PrimaryButton label="Delete" height={50} radius={14} bg={colors.red} shadowColor="transparent" style={{ flex: 1 }} onPress={() => void useStore.getState().deleteAccount()} />
      </Row>
    </Pad>
  );
}

// ---------- Gift a date ----------

function RedeemSheet() {
  const credit = useStore((s) => s.user?.credit ?? 0);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const redeem = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    const ok = await useStore.getState().redeemGift(code);
    setBusy(false);
    if (ok) useStore.getState().closeSheet();
  };
  return (
    <Pad>
      <BigTitle>Redeem a gift code</BigTitle>
      <Txt size={14} lh={1.5} color={colors.gray600} style={{ marginBottom: 16 }}>
        Enter the code from your gift. The credit is used automatically on your next booking.{credit ? ` You have ${eur(credit / 100)} now.` : ''}
      </Txt>
      <TextInput value={code} onChangeText={(t) => setCode(t.toUpperCase())} autoCapitalize="characters" autoCorrect={false} accessibilityLabel="Gift code" placeholder={t("ZM-1234-5678")} placeholderTextColor={colors.gray400} style={[font('mono', 600), input, { height: 54, fontSize: 18, letterSpacing: 1.5 }]} />
      <PrimaryButton label={busy ? 'Checking…' : 'Redeem'} weight={700} dim={!code.trim() || busy} style={{ marginTop: 14 }} onPress={() => void redeem()} />
    </Pad>
  );
}

function GiftSheet() {
  const gift = useStore((s) => s.gift);
  const set = (o: Partial<typeof gift>) => useStore.setState({ gift: { ...gift, ...o } });
  const to = gift.to.trim() || 'a friend';
  const amt = eur(gift.amt);
  if (gift.done) {
    return (
      <Pad>
        <View style={{ alignItems: 'center', gap: 10, paddingTop: 16, paddingBottom: 4 }}>
          <View style={{ width: 84, height: 84, alignItems: 'center', justifyContent: 'center' }}>
            <Confetti spread={140} />
            <Enter kind="pop">
              <Box shadow={4} style={{ width: 84, height: 84, borderRadius: 26, borderWidth: 2.5, borderColor: colors.ink, backgroundColor: colors.violet, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="gift" size={36} color={colors.white} />
              </Box>
            </Enter>
          </View>
          <H size={26} ls={-0.03} align="center">Gift sent to {to}</H>
          <Txt size={14} color={colors.gray600} align="center">Share this gift code with {to}. It’s valid for 12 months on any booking.</Txt>
          <Box shadow={3} style={{ marginTop: 4, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 14, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.butter }}>
            <Txt kind="mono" size={20} weight={700} ls={0.08} selectable>{gift.code}</Txt>
          </Box>
          <PrimaryButton label="Done" weight={700} style={{ marginTop: 10, alignSelf: 'stretch' }} onPress={() => useStore.getState().closeSheet()} />
        </View>
      </Pad>
    );
  }
  return (
    <Pad scroll>
      <BigTitle>Gift a date</BigTitle>
      <Txt size={14} lh={1.5} color={colors.gray600} style={{ marginBottom: 16 }}>Send credit a friend can spend on any booking. Valid for 12 months.</Txt>
      <Box shadow={4} style={{ height: 150, borderRadius: 24, borderWidth: 2.5, borderColor: colors.ink, backgroundColor: colors.pink, padding: 18, justifyContent: 'space-between', transform: [{ rotate: '-1.5deg' }] }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <H size={20} ls={-0.03} color={colors.white}>zeitmit<H size={20} color={colors.sun}>!</H> gift</H>
          <Icon name="gift" size={24} color={colors.white} />
        </Row>
        <View>
          <H size={44} lh={44} ls={-0.04} color={colors.white}>{amt}</H>
          <Txt size={13} weight={600} color={colors.white} style={{ marginTop: 4 }}>For {to}</Txt>
        </View>
      </Box>
      <Row style={{ gap: 8, marginTop: 20 }}>
        {[50, 100, 150].map((a) => <Chip key={a} label={eur(a)} on={gift.amt === a} height={46} radius={14} size={15} weight={700} style={{ flex: 1, borderWidth: 2 }} onPress={() => set({ amt: a })} />)}
      </Row>
      <TextInput value={gift.to} onChangeText={(t) => set({ to: t })} accessibilityLabel="Recipient" placeholder={t("Friend’s name or email")} placeholderTextColor={colors.gray400} style={[font('body'), input, { height: 50, marginTop: 12 }]} />
      <TextInput value={gift.msg} onChangeText={(t) => set({ msg: t.slice(0, 140) })} accessibilityLabel="Message" placeholder={t("Add a message (optional)")} placeholderTextColor={colors.gray400} multiline textAlignVertical="top" style={[font('body'), input, { height: 76, marginTop: 10, paddingTop: 12, fontSize: 15 }]} />
      <PrimaryButton label={'Send gift · ' + amt} weight={700} dim={!gift.to.trim()} style={{ marginTop: 14 }} onPress={() => void useStore.getState().sendGift()} />
    </Pad>
  );
}

// ---------- Safety check-in ----------

function SafetySheet() {
  const safety = useStore((s) => s.safety);
  const name = useStore((s) => s.safety.name ?? s.bookings.find((x) => x.id === s.safety.bid)?.companionName ?? 'them');
  const set = (o: Partial<typeof safety>) => useStore.setState({ safety: { ...safety, ...o } });
  return (
    <Pad scroll>
      <Row style={{ gap: 10, marginTop: 6, marginBottom: 4 }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="shield-check" size={20} />
        </View>
        <H size={24} ls={-0.03}>Safety check-in</H>
      </Row>
      <Txt size={14} lh={1.5} color={colors.gray600} style={{ marginTop: 8, marginBottom: 16 }}>We’ll ask if you’re OK during your time with {name}. You send your trusted contact a private live link on WhatsApp, and SOS alerts them and the ZeitMit team.</Txt>
      <View style={{ gap: 10, padding: 14, borderRadius: 16, borderWidth: 2, borderColor: colors.ink }}>
        <Row style={{ gap: 12 }}>
          <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.blush, borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
            <Txt size={15} weight={800}>{(safety.contactName.trim()[0] ?? '?').toUpperCase()}</Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Txt size={15} weight={700}>Trusted contact</Txt>
            <Txt size={12} color={colors.gray600}>A friend who can check on you. Use their WhatsApp number.</Txt>
          </View>
        </Row>
        <TextInput value={safety.contactName} onChangeText={(t) => set({ contactName: t })} accessibilityLabel="Contact name" placeholder={t("Name, e.g. Anna (sister)")} placeholderTextColor={colors.gray400} style={[font('body'), input, { height: 46 }]} />
        <TextInput value={safety.contactPhone} onChangeText={(t) => set({ contactPhone: t })} accessibilityLabel="Contact phone" placeholder={t("Phone, e.g. +49 151 2345678")} placeholderTextColor={colors.gray400} keyboardType="phone-pad" style={[font('body'), input, { height: 46 }]} />
      </View>
      <Row style={{ gap: 12, marginTop: 10, padding: 14, borderRadius: 16, borderWidth: 2, borderColor: colors.ink }}>
        <View style={{ flex: 1 }}>
          <Txt size={15} weight={700}>Share live location</Txt>
          <Txt size={12} color={colors.gray600}>Only on {safety.contactName.trim() || 'your contact'}’s private link, only while the app is open during the booking.</Txt>
        </View>
        <Toggle bordered on={safety.share} label="Share live location" onPress={() => set({ share: !safety.share })} />
      </Row>
      <Txt size={14} weight={700} style={{ marginTop: 18, marginBottom: 8 }}>Check in</Txt>
      <Row style={{ gap: 8 }}>
        {([[30, 'Every 30 min'], [60, 'Every hour'], [0, 'Start & end']] as const).map(([v, l]) => (
          <Chip key={v} label={l} on={safety.every === v} height={44} radius={12} size={12.5} weight={700} padL={4} padR={4} style={{ flex: 1, borderWidth: 2 }} onPress={() => set({ every: v })} />
        ))}
      </Row>
      <PrimaryButton label="Start check-in" weight={700} shadowColor={colors.mint} dim={!safety.contactName.trim() || !safety.contactPhone.trim()} style={{ marginTop: 18 }} onPress={() => void useStore.getState().startCheckin()} />
      <Txt size={12} color={colors.gray600} align="center" style={{ marginTop: 12 }}>In an emergency, always call 112.</Txt>
    </Pad>
  );
}

// ---------- Cancel a paid booking (customer or companion) ----------

const CANCEL_REASONS = {
  customer: ['Plans changed', 'Booked by mistake', 'Feeling unwell', 'Something else'],
  companion: ['Feeling unwell', 'Emergency', 'Schedule conflict', 'Safety concern', 'Something else'],
} as const;

function CancelSheet() {
  const draft = useStore((s) => s.cancel);
  const mine = useStore((s) => s.bookings.find((x) => x.id === s.cancel.bid));
  const theirs = useStore((s) => [...s.comp.requests, ...s.comp.upcoming].find((x) => x.id === s.cancel.bid));
  const set = (o: Partial<typeof draft>) => useStore.setState({ cancel: { ...draft, ...o } });
  const close = () => useStore.getState().closeSheet();
  const companion = draft.side === 'companion';
  const b = companion ? theirs : mine;
  if (!b) return <Pad><View /></Pad>;
  const pending = b.status === 'pending';
  const other = companion ? (theirs?.who ?? 'Your customer') : (mine?.companionName ?? 'your companion');
  const late = !companion && b.status === 'confirmed' && b.startsAt - Date.now() / 1000 < FREE_CANCEL_HOURS * 3600;

  const policy = companion
    ? { icon: 'rotate-ccw', bg: colors.lilac, text: `${other} gets everything back. You won’t receive the ${eur((theirs?.payout ?? 0) / 100)}.` }
    : late
      ? { icon: 'circle-alert', bg: '#FDF3E2', text: `It’s less than ${FREE_CANCEL_HOURS} hours before, so there’s no refund. ${other} is paid for the time they reserved.` }
      : { icon: 'circle-check', bg: colors.mintSoft, text: `Free cancellation: you get ${eur((mine?.total ?? 0) / 100)} back in full.` };

  const confirm = () => {
    if (draft.busy) return;
    const st = useStore.getState();
    void (companion ? st.companionCancel(b.id, draft.reason) : st.cancelBooking(b.id, draft.reason));
  };

  return (
    <Pad>
      <View style={{ gap: 12 }}>
        <BigTitle>{pending ? 'Cancel this request?' : 'Cancel this booking?'}</BigTitle>
        <View style={{ padding: 14, borderRadius: 16, borderWidth: 2, borderColor: colors.ink, gap: 4 }}>
          <Txt size={15} weight={700}>{other} · {AM[b.act].label}</Txt>
          <Txt size={13} color={colors.gray600}>{b.day} · {b.time} · {b.place}</Txt>
        </View>
        <Row style={{ gap: 10, padding: 14, borderRadius: 16, borderWidth: 2, borderColor: colors.ink, backgroundColor: policy.bg, alignItems: 'flex-start' }}>
          <Icon name={policy.icon} size={18} />
          <Txt size={14} lh={1.45} style={{ flex: 1 }}>{policy.text}</Txt>
        </Row>
        <Txt size={14} weight={700} style={{ marginTop: 4 }}>Why are you cancelling? <Txt size={13} weight={400} color={colors.gray600}>Optional</Txt></Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {CANCEL_REASONS[draft.side].map((r) => (
            <Chip key={r} label={r} height={38} size={13} on={draft.reason === r} onPress={() => set({ reason: draft.reason === r ? null : r })} />
          ))}
        </View>
        {companion && draft.reason === 'Safety concern' ? (
          <Txt size={12} lh={1.45} color={colors.gray600}>Please also report them from the chat menu so our safety team can look into it.</Txt>
        ) : null}
        <PressBox shadow={4} fx="push" accessibilityLabel={t(pending ? 'Cancel request' : 'Cancel booking')} onPress={confirm} style={{ marginTop: 6, height: 54, borderRadius: 16, borderWidth: 2.5, borderColor: colors.ink, backgroundColor: colors.rose, alignItems: 'center', justifyContent: 'center', opacity: draft.busy ? 0.6 : 1 }}>
          <Txt size={16} weight={800} color={colors.white}>{draft.busy ? 'Cancelling…' : pending ? 'Cancel request' : 'Cancel booking'}</Txt>
        </PressBox>
        <TextButton label={pending ? 'Keep request' : 'Keep booking'} size={15} weight={700} onPress={close} style={{ alignSelf: 'center', paddingVertical: 10 }} />
      </View>
    </Pad>
  );
}

/** After starting a check-in: send the trusted contact the private live link. */
function CheckinShareSheet() {
  const ck = useStore((s) => s.checkin);
  const close = () => useStore.getState().closeSheet();
  if (!ck) return <Pad><View /></Pad>;
  const text = shareMessage(ck);
  const send = async (via: 'wa' | 'sms') => {
    const ok = via === 'wa' ? await sendWhatsApp(ck.contactPhone, text) : await sendSms(ck.contactPhone, text);
    if (!ok) useStore.getState().showToast(via === 'wa' ? 'WhatsApp couldn’t be opened. Try SMS.' : 'Couldn’t open your SMS app.');
  };
  return (
    <Pad>
      <View style={{ gap: 12 }}>
        <Row style={{ gap: 10, marginTop: 6 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="shield-check" size={20} />
          </View>
          <H size={24} ls={-0.03}>Check-in is on</H>
        </Row>
        <Txt size={14} lh={1.5} color={colors.gray800}>Send {ck.contactName} your private live link. They’ll see your check-ins{ck.share ? ' and location' : ''} until the booking ends. No app needed.</Txt>
        <View style={{ padding: 14, borderRadius: 16, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.butter }}>
          <Txt size={13} lh={1.45} color={colors.gray800} selectable>{text}</Txt>
        </View>
        <PressBox shadow={4} fx="push" accessibilityLabel="Send on WhatsApp" onPress={() => void send('wa')} style={{ height: 54, borderRadius: 16, borderWidth: 2.5, borderColor: colors.ink, backgroundColor: '#25D366', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Icon name="message-circle" size={19} color={colors.ink} />
          <Txt size={16} weight={800}>Send on WhatsApp</Txt>
        </PressBox>
        <Row style={{ justifyContent: 'space-between' }}>
          <TextButton label="Send by SMS instead" size={14} onPress={() => void send('sms')} style={{ paddingVertical: 10 }} />
          <TextButton label="Done" size={14} weight={700} onPress={close} style={{ paddingVertical: 10 }} />
        </Row>
      </View>
    </Pad>
  );
}

function SosSheet() {
  const ck = useStore((s) => s.checkin);
  const me = useStore((s) => s.user?.first ?? '');
  const [sent, setSent] = useState(false);
  const { sos, checkinOk, endCheckin } = useStore.getState();
  const contact = ck?.contactName || 'your contact';
  const alert = async (via: 'wa' | 'sms') => {
    if (!ck) return;
    void sos(); // tells the ZeitMit team; WhatsApp opens right away regardless
    const text = sosMessage(ck, me);
    const ok = via === 'wa' ? await sendWhatsApp(ck.contactPhone, text) : await sendSms(ck.contactPhone, text);
    if (!ok) useStore.getState().showToast(via === 'wa' ? 'WhatsApp couldn’t be opened. Try SMS.' : 'Couldn’t open your SMS app.');
    setSent(true);
  };
  return (
    <Pad>
      <View style={{ gap: 10 }}>
        <BigTitle>Need help?</BigTitle>
        <PressBox shadow={4} fx="push" accessibilityLabel="Call 112" onPress={() => Linking.openURL('tel:112')} style={{ height: 56, borderRadius: 16, borderWidth: 2.5, borderColor: colors.ink, backgroundColor: colors.rose, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Icon name="phone" size={18} color={colors.white} />
          <Txt size={16} weight={800} color={colors.white}>Call 112</Txt>
        </PressBox>
        <PressBox shadow={4} fx="push" accessibilityLabel={t(`SOS to ${contact} on WhatsApp`)} onPress={() => void alert('wa')} style={{ height: 54, borderRadius: 16, borderWidth: 2.5, borderColor: colors.ink, backgroundColor: '#25D366', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Icon name="message-circle" size={19} color={colors.ink} />
          <Txt size={16} weight={800}>SOS to {contact} on WhatsApp</Txt>
        </PressBox>
        <TextButton label="Send the SOS by SMS instead" size={14} onPress={() => void alert('sms')} style={{ alignSelf: 'center', paddingVertical: 6 }} />
        <Txt size={12} lh={1.45} color={colors.gray600} align="center">
          {sent ? 'The ZeitMit safety team has been alerted too.' : 'This also alerts the ZeitMit safety team with your booking and last location.'}
        </Txt>
        <View style={{ height: 2, backgroundColor: colors.hairline, marginVertical: 4 }} />
        <SecondaryButton label="I’m OK" height={48} radius={14} size={15} weight={700} onPress={() => void checkinOk()} />
        <View style={{ alignItems: 'center' }}>
          <TextButton label="End check-in" size={14} weight={600} style={{ paddingVertical: 10 }} onPress={() => void endCheckin()} />
        </View>
      </View>
    </Pad>
  );
}

// ---------- Meet code (escrow release) ----------

function OtpSheet() {
  const ob = useStore((s) => s.bookings.find((x) => x.id === s.otpFor));
  if (!ob) return <Pad><View /></Pad>;
  const c = { name: ob.companionName };
  const rel = ob.pay === 'released';
  const amt = eur(priceOf(ob));
  const steps: [string, string, boolean][] = [
    ['credit-card', 'You paid ' + amt, true],
    ['lock', 'ZeitMit holds the money', true],
    ['key-round', 'Meet ' + c.name + ' and share this code', rel],
    ['wallet', 'Money released to ' + c.name, rel],
  ];
  return (
    <Pad scroll>
      <BigTitle>Your meet code</BigTitle>
      <Txt size={14} lh={1.5} color={colors.gray600} style={{ marginBottom: 16 }}>Only share it with {c.name} in person, once you’ve met. Entering it releases the {amt} from ZeitMit to {c.name}.</Txt>
      <Row style={{ gap: 10 }} >
        {(ob.otp || '0000').split('').map((d, i) => (
          <Box key={i} shadow={4} style={{ flex: 1, height: 76, borderRadius: 18, borderWidth: 2.5, borderColor: colors.ink, backgroundColor: colors.sun, alignItems: 'center', justifyContent: 'center' }}>
            <H size={40}>{d}</H>
          </Box>
        ))}
      </Row>
      <View style={{ marginTop: 22 }}>
        {steps.map(([icon, t, done], i) => (
          <Row key={t} style={{ gap: 12, alignItems: 'flex-start' }}>
            <View style={{ alignItems: 'center' }}>
              <View style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: colors.ink, backgroundColor: done ? colors.mint : colors.white, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={icon} size={15} />
              </View>
              {i < 3 ? <View style={{ width: 2, height: 14, backgroundColor: colors.ink }} /> : null}
            </View>
            <Txt size={14} weight={600} style={{ paddingTop: 6, flex: 1 }}>{t}</Txt>
          </Row>
        ))}
      </View>
      <Row style={{ marginTop: 14, gap: 8, alignItems: 'flex-start' }}>
        <Icon name="shield-alert" size={15} color={colors.gray600} />
        <Txt size={12} lh={1.5} color={colors.gray600} style={{ flex: 1 }}>Never share the code before meeting, by chat or by phone. ZeitMit staff will never ask for it.</Txt>
      </Row>
    </Pad>
  );
}

function OtpInSheet() {
  const otpIn = useStore((s) => s.otpIn);
  const u = useStore((s) => s.comp.upcoming.find((x) => x.id === s.otpIn.uid) || s.comp.done.find((x) => x.id === s.otpIn.uid));
  const ref = useRef<TextInputInstance>(null);
  if (!u) return <Pad><View /></Pad>;
  const amt = eur(u.payout / 100);
  const v = otpIn.val;

  if (otpIn.done) {
    return (
      <Pad>
        <View style={{ alignItems: 'center', gap: 10, paddingTop: 16, paddingBottom: 4 }}>
          <Enter kind="pop">
            <Box shadow={4} style={{ width: 88, height: 88, borderRadius: 28, borderWidth: 2.5, borderColor: colors.ink, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="wallet" size={38} />
            </Box>
          </Enter>
          <H size={30} ls={-0.03}>{amt} released</H>
          <Txt size={14} lh={1.5} color={colors.gray600} align="center">Code confirmed. The money is in your ZeitMit balance and goes out with this week’s payout. Have a good time with {u.who}!</Txt>
          <PrimaryButton label="Done" weight={700} style={{ marginTop: 10, alignSelf: 'stretch' }} onPress={() => useStore.getState().closeSheet()} />
        </View>
      </Pad>
    );
  }
  return (
    <Pad>
      <BigTitle>Enter {u.who}’s code</BigTitle>
      <Txt size={14} lh={1.5} color={colors.gray600} style={{ marginBottom: 18 }}>Ask {u.who} for their 4-digit meet code when you meet. {amt} is released to you as soon as it matches.</Txt>
      <Pressable accessibilityLabel="Meet code" onPress={() => ref.current?.focus()}>
        <Row style={{ gap: 10 }}>
          {[0, 1, 2, 3].map((i) => (
            <Box key={i} shadow={4} style={{ flex: 1, height: 72, borderRadius: 18, borderWidth: 2.5, borderColor: otpIn.err ? colors.rose : i === v.length ? colors.violet : colors.ink, backgroundColor: v[i] ? colors.butter : colors.white, alignItems: 'center', justifyContent: 'center' }}>
              <H size={36}>{v[i] || ''}</H>
            </Box>
          ))}
        </Row>
        <TextInput
          ref={ref}
          value={v}
          onChangeText={(t) => useStore.setState({ otpIn: { ...otpIn, val: t.replace(/\D/g, '').slice(0, 4), err: false } })}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          autoFocus
          caretHidden
          accessibilityLabel="Meet code"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0, fontSize: 16 }}
        />
      </Pressable>
      {otpIn.err ? (
        <Row style={{ gap: 6, marginTop: 12 }}>
          <Icon name="circle-alert" size={15} color={colors.roseDeep} />
          <Txt size={13} weight={600} color={colors.roseDeep}>That code doesn’t match. Check with {u.who} and try again.</Txt>
        </Row>
      ) : null}
      <PrimaryButton label="Confirm & release payment" weight={700} shadowColor={colors.mint} dim={v.length < 4} style={{ marginTop: 16 }} onPress={() => useStore.getState().verifyOtp()} />
    </Pad>
  );
}
