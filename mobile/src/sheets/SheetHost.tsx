// Bottom sheets (filters, sort, gift, safety, meet code, …) rendered above every screen.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, BackHandler, Easing, KeyboardAvoidingView, Linking, Pressable, ScrollView, TextInput, useWindowDimensions, View, type ScrollViewInstance, type TextInputInstance } from 'react-native';
import Slider from '@react-native-community/slider';

import { useShallow } from 'zustand/react/shallow';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font } from '../theme';
import { A, AM, ageStr, eur, FEEDBACK_CONCERNS, FEEDBACK_GOOD, INTERESTS, kindsOf, LANGS, PREF, SORT, WHEN } from '../data';
import { addDays, clock, dateLabel, KIND_SHORT, localToday, localUnix, MAX_RANGES, minutes, nextRange, PLAN_DAYS, rangeProblem, span, weekdayOf, type HourKind, type Range } from '../lib/dates';
import { TZ } from '../lib/tz';
import { locale } from '../i18n';
import { GENDERS } from '../screens/Become';
import { filtered, FREE_CANCEL_HOURS, priceOf, toggleIn, useStore, type SheetKind } from '../store';
import { goBack, openProfile } from '../nav';
import { Icon } from '../ui/Icon';
import { Box, Chip, Confetti, Enter, H, PressBox, Row, Stripes, Toggle, Txt, Photo } from '../ui/primitives';
import { CircleButton, PrimaryButton, SecondaryButton, TextButton, useKeyboardShown, useKeyboardTop } from '../ui/common';
import { t } from '../i18n';
import { sendSms, sendWhatsApp } from '../lib/whatsapp';
import { shareMessage, sosMessage } from '../lib/checkinText';

export function SheetHost() {
  const sheet = useStore((s) => s.sheet);
  const close = useStore((s) => s.closeSheet);
  const { height } = useWindowDimensions();
  const y = useRef(new Animated.Value(height)).current;
  // With the keyboard up, the sheet sits on top of it and must fit in the space above (it scrolls inside).
  const keyboardTop = useKeyboardTop();
  const insets = useSafeAreaInsets();
  const room = keyboardTop !== null ? Math.max(220, keyboardTop - insets.top - 8) : null;

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
      <KeyboardAvoidingView behavior="padding" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, justifyContent: 'flex-end' }} pointerEvents="box-none">
        <Animated.View
          accessibilityViewIsModal
          style={{
            height: tall ? room ?? '92%' : undefined, maxHeight: room ?? '92%', backgroundColor: colors.white, borderTopLeftRadius: 28, borderTopRightRadius: 28,
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
    case 'feedback': return <FeedbackSheet />;
    case 'hours': return <HoursSheet />;
    case 'block': return <BlockSheet />;
  }
}

function Pad({ children, scroll }: { children: ReactNode; scroll?: boolean }) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardShown();
  const style = { paddingTop: 8, paddingHorizontal: 20, paddingBottom: keyboard ? 16 : Math.max(30, insets.bottom + 8) };
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
  const { f, query, sort, companions } = useStore(useShallow((s) => ({ f: s.f, query: s.query, sort: s.sort, companions: s.companions })));
  const { setF, clearAll, closeSheet } = useStore.getState();
  const n = useMemo(() => filtered(companions, query, f, sort).length, [companions, query, f, sort]);
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
          goBack();
          openProfile(cust.cid);
        }} />
      ) : null}
      <MenuRow icon="flag" label="Report" onPress={() => openSheet('report', { reportReason: null, reportTarget: other ?? null })} />
      <MenuRow icon="ban" label="Block" color={colors.red} last onPress={() => {
        if (!other) return;
        void block(other).then((ok) => { if (ok) { closeSheet(); goBack(); } });
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

// ---------- After a meet-up ----------

const SAFE: { k: 'yes' | 'unsure' | 'no'; label: string; icon: string; bg: string; fg: string }[] = [
  { k: 'yes', label: 'Yes', icon: 'shield-check', bg: colors.greenSoft, fg: colors.greenDeep },
  { k: 'unsure', label: 'Not sure', icon: 'circle-alert', bg: colors.amberSoft, fg: '#7A5413' },
  { k: 'no', label: 'No', icon: 'shield-alert', bg: colors.redSoft, fg: colors.redDeep },
];

/** Private answers for the safety team: did they feel safe, how respectful the other person was, what stood out. */
function FeedbackSheet() {
  const f = useStore((s) => s.feedback);
  const reviewed = useStore((s) => s.bookings.find((b) => b.id === s.feedback.bid)?.reviewed ?? true);
  const { openSheet, closeSheet, submitFeedback } = useStore.getState();
  const set = (o: Partial<typeof f>) => useStore.setState((s) => ({ feedback: { ...s.feedback, ...o } }));
  const review = () => openSheet('review', { review: { bid: f.bid, stars: Math.max(f.stars, 1), text: '' } });

  if (f.sent) {
    const canReview = f.side === 'customer' && !reviewed;
    const worry = f.sent.concern;
    return (
      <Pad>
        <View style={{ alignItems: 'center', gap: 8, paddingTop: 6 }}>
          <View style={{ width: 64, height: 64, borderRadius: 22, borderWidth: 2, borderColor: colors.ink, backgroundColor: worry ? colors.redSoft : colors.mintSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={worry ? 'shield-alert' : 'shield-check'} size={30} />
          </View>
          <BigTitle>Thanks for telling us</BigTitle>
          <Txt size={14} lh={1.5} color={colors.gray800} align="center">
            {worry ? `Our safety team will look into it and may contact you. ${f.name} won’t see what you wrote.` : 'It helps keep ZeitMit safe for everyone.'}
          </Txt>
        </View>
        {worry ? (
          <View style={{ marginTop: 16, gap: 10 }}>
            <Row style={{ gap: 10, padding: 14, borderRadius: 14, backgroundColor: colors.redSoft, alignItems: 'flex-start' }}>
              <Icon name="phone" size={17} color={colors.redDeep} style={{ marginTop: 1 }} />
              <Txt size={13} lh={1.5} style={{ flex: 1 }}>If you’re in danger right now, call 112.</Txt>
            </Row>
            <SecondaryButton label={`Report ${f.name}`} icon="flag" height={48} onPress={() => openSheet('report', { reportReason: null, reportTarget: f.about })} />
          </View>
        ) : null}
        <View style={{ marginTop: 14, gap: 2, alignItems: 'stretch' }}>
          {canReview && !worry ? <PrimaryButton label={`Review ${f.name} publicly`} onPress={review} /> : <PrimaryButton label="Done" onPress={closeSheet} />}
          {canReview && worry ? <TextButton label="Leave a public review" size={14} onPress={review} style={{ alignSelf: 'center', paddingVertical: 10 }} /> : null}
        </View>
      </Pad>
    );
  }

  const ready = !!f.safe && f.stars > 0;
  return (
    <Pad scroll>
      <SheetTitle style={{ marginBottom: 4 }}>How did it go with {f.name}?</SheetTitle>
      <Row style={{ gap: 6, marginBottom: 16 }}>
        <Icon name="lock" size={13} color={colors.gray600} />
        <Txt size={12} color={colors.gray600} style={{ flex: 1 }}>Private. Only the ZeitMit safety team sees this, never {f.name}.</Txt>
      </Row>
      <Txt size={14} weight={700} style={{ marginBottom: 8 }}>Did you feel safe?</Txt>
      <Row style={{ gap: 8 }}>
        {SAFE.map((o) => {
          const on = f.safe === o.k;
          return (
            <Pressable
              key={o.k} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={t(o.label)} onPress={() => set({ safe: o.k })}
              style={{ flex: 1, height: 64, borderRadius: 16, borderWidth: 2, borderColor: on ? colors.ink : colors.hairline, backgroundColor: on ? o.bg : colors.white, alignItems: 'center', justifyContent: 'center', gap: 4 }}
            >
              <Icon name={o.icon} size={19} color={on ? o.fg : colors.gray600} />
              <Txt size={13} weight={700} color={on ? o.fg : colors.ink}>{o.label}</Txt>
            </Pressable>
          );
        })}
      </Row>
      <Txt size={14} weight={700} style={{ marginTop: 18, marginBottom: 2 }}>How respectful was {f.name}?</Txt>
      <Row style={{ gap: 4 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} accessibilityRole="button" accessibilityLabel={t(n === 1 ? '1 star' : `${n} stars`)} hitSlop={4} onPress={() => set({ stars: n })} style={{ padding: 2 }}>
            <Txt size={34} lh={38} color={n <= f.stars ? colors.amber : colors.gray300}>★</Txt>
          </Pressable>
        ))}
      </Row>
      <Txt size={14} weight={700} style={{ marginTop: 16, marginBottom: 8 }}>What stood out? <Txt size={13} color={colors.gray600}>(optional)</Txt></Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {FEEDBACK_GOOD.map((x) => <FeedbackTag key={x} label={x} good on={f.tags.includes(x)} onPress={() => set({ tags: toggleIn(f.tags, x) })} />)}
        {FEEDBACK_CONCERNS.map((x) => <FeedbackTag key={x} label={x} on={f.tags.includes(x)} onPress={() => set({ tags: toggleIn(f.tags, x) })} />)}
      </View>
      <TextInput
        value={f.note} onChangeText={(v) => set({ note: v.slice(0, 600) })} accessibilityLabel="Note for the safety team"
        placeholder={t('Anything the team should know? (optional)')} placeholderTextColor={colors.gray400} multiline textAlignVertical="top"
        style={[font('body'), { marginTop: 14, height: 96, padding: 14, borderRadius: 14, borderWidth: 2, borderColor: colors.ink, fontSize: 15, color: colors.ink, outlineStyle: 'none' } as object]}
      />
      <PrimaryButton label={f.busy ? 'Sending…' : 'Send to the safety team'} dim={!ready || f.busy} style={{ marginTop: 14 }} onPress={() => void submitFeedback()} />
      {!ready ? <Txt size={12} color={colors.gray600} align="center" style={{ marginTop: 8 }}>Answer both questions to send it.</Txt> : null}
    </Pad>
  );
}

const FeedbackTag = ({ label, good, on, onPress }: { label: string; good?: boolean; on: boolean; onPress: () => void }) => (
  <Pressable
    accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress}
    style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 34, paddingHorizontal: 12, borderRadius: 999, borderWidth: 2, borderColor: colors.ink, backgroundColor: on ? (good ? colors.mintSoft : colors.redSoft) : colors.white }}
  >
    {on ? <Icon name="check" size={13} color={good ? colors.greenDeep : colors.redDeep} /> : null}
    <Txt size={13} weight={on ? 700 : 500}>{label}</Txt>
  </Pressable>
);

// ---------- Companion: hours (one weekday's weekly hours, or one date's own) and blocked time ----------

const WEEKDAYS = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
const NEW_RANGE: Range = { from: '18:00', to: '22:00', kind: 'both' };
/** "02:00 +1" for minutes past midnight (an end on the next day). */
const clockText = (m: number) => (m > 1440 ? `${clock(m)} +1` : clock(m));
/** Minutes of a range's end from its day's midnight (past 1440: the next day). */
const endOf = (r: Range) => minutes(r.from) + span(r);
/** The "to" of a range ending `e` minutes after its day's midnight. */
const toOf = (e: number) => (e > 1440 ? clock(e - 1440) : clock(e));

/** One weekday's weekly hours or a date's own hours: ranges in 15-minute steps (past midnight too), each for both kinds or one. */
function HoursSheet() {
  const h = useStore((s) => s.hoursEdit);
  const cal = useStore((s) => s.comp.hours);
  const both = useStore((s) => kindsOf(s.comp.acts).length > 1);
  const { saveWeekDay, saveDay, removeDay, closeSheet, showToast } = useStore.getState();
  const [open, setOpen] = useState<string | null>(null);
  const set = (o: Partial<typeof h>) => useStore.setState((s) => ({ hoursEdit: { ...s.hoursEdit, ...o } }));
  const tz = cal?.tz ?? TZ;
  const weekly = h.day !== null;
  const existing = h.date ? cal?.days.find((d) => d.date === h.date) : undefined;
  // Start from what's set for that date, or that weekday's weekly hours.
  const pick = useCallback((date: string) => {
    const c = useStore.getState().comp.hours;
    const ex = c?.days.find((d) => d.date === date);
    const wk = (c?.week ?? []).filter((r) => r.day === weekdayOf(date)).map(({ from, to, kind }) => ({ from, to, kind }));
    setOpen(null);
    useStore.setState((s) => ({ hoursEdit: { ...s.hoursEdit, date, off: ex ? !ex.ranges.length : false, ranges: ex?.ranges.length ? ex.ranges : wk.length ? wk : [NEW_RANGE] } }));
  }, []);
  const setRange = (i: number, r: Range) => set({ ranges: h.ranges.map((x, k) => (k === i ? r : x)) });
  const more = nextRange(h.ranges);
  const problem = h.off ? null : !h.ranges.length ? 'Add some hours, or choose Day off.' : rangeProblem(h.ranges);
  const save = async () => {
    if (problem || h.busy || (!weekly && !h.date)) return;
    set({ busy: true });
    const ranges = h.off ? [] : [...h.ranges].sort((x, y) => minutes(x.from) - minutes(y.from));
    const ok = weekly ? await saveWeekDay(h.day!, ranges) : await saveDay(h.date!, ranges);
    set({ busy: false });
    if (ok) closeSheet();
  };
  const reset = async () => {
    if (!h.date || h.busy) return;
    set({ busy: true });
    const ok = await removeDay(h.date);
    set({ busy: false });
    if (ok) { closeSheet(); showToast('Back to your weekly hours for that day.'); }
  };

  return (
    <Pad scroll>
      <SheetTitle style={{ marginBottom: 2 }}>{weekly ? WEEKDAYS[h.day!] : 'Hours for a date'}</SheetTitle>
      <Txt size={13} lh={1.45} color={colors.gray600} style={{ marginBottom: 12 }}>
        {weekly ? 'Every week on this day, in 15-minute steps. An end before the start runs past midnight. Bookings you already have stay.' : 'They replace your weekly hours on that day. Bookings you already have stay.'}
      </Txt>
      {!weekly ? <DateStrip today={localToday(tz)} selected={h.date} marked={(cal?.days ?? []).map((d) => d.date).join()} onPick={pick} /> : null}
      {weekly || h.date ? (
        <>
          {h.date ? <Txt size={15} weight={700} style={{ marginTop: 16 }}>{dateLabel(h.date)}</Txt> : null}
          <Row style={{ gap: 8, marginTop: 10 }}>
            <Chip label={weekly ? 'Open' : 'Available'} icon="clock" on={!h.off} onPress={() => set({ off: false, ranges: h.ranges.length ? h.ranges : [NEW_RANGE] })} height={42} radius={12} weight={600} style={{ flex: 1 }} />
            <Chip label={weekly ? 'Closed' : 'Day off'} icon="calendar-x" on={h.off} onPress={() => set({ off: true })} height={42} radius={12} weight={600} style={{ flex: 1 }} />
          </Row>
          {h.off ? (
            <Txt size={13} lh={1.45} color={colors.gray600} style={{ marginTop: 12 }}>{weekly ? 'Customers can’t book you on this day of the week, except on dates with their own hours.' : 'Customers can’t book you that day.'}</Txt>
          ) : (
            <View style={{ gap: 12, marginTop: 14 }}>
              {h.ranges.map((r, i) => {
                const from = minutes(r.from), end = endOf(r);
                return (
                  <View key={i} style={{ gap: 10, padding: 10, borderRadius: 16, backgroundColor: colors.sun }}>
                    <Row style={{ gap: 8 }}>
                      <ClockField label="From" value={from} open={open === `${i}f`} onToggle={() => setOpen(open === `${i}f` ? null : `${i}f`)} />
                      <ClockField label="To" value={end} open={open === `${i}t`} onToggle={() => setOpen(open === `${i}t` ? null : `${i}t`)} />
                      {h.ranges.length > 1 ? <CircleButton icon="x" label="Remove these hours" size={34} iconSize={16} bg={colors.butter} border={0} onPress={() => { setOpen(null); set({ ranges: h.ranges.filter((_, k) => k !== i) }); }} /> : null}
                    </Row>
                    {open === `${i}f` ? (
                      // A new start keeps the end where it was if that still works, else keeps the length.
                      <ClockGrid value={from} min={0} max={1425} onChange={(m) => setRange(i, { ...r, from: clock(m), to: toOf(end - m >= 30 && end - m <= 1440 ? end : m + span(r)) })} />
                    ) : null}
                    {open === `${i}t` ? <ClockGrid value={end} min={from + 30} max={from + 1440} onChange={(m) => setRange(i, { ...r, to: toOf(m) })} /> : null}
                    {both ? (
                      <Row style={{ gap: 6 }}>
                        {(['both', 'meet', 'video'] as HourKind[]).map((k) => (
                          <Chip key={k} label={KIND_SHORT[k]} on={r.kind === k} onPress={() => setRange(i, { ...r, kind: k })} height={32} size={11.5} padL={6} padR={6} style={{ flex: 1 }} />
                        ))}
                      </Row>
                    ) : null}
                  </View>
                );
              })}
              {h.ranges.length < MAX_RANGES && more ? (
                <TextButton label="Add more hours" icon="plus" size={14} onPress={() => { setOpen(null); set({ ranges: [...h.ranges, more] }); }} style={{ alignSelf: 'flex-start' }} />
              ) : null}
            </View>
          )}
          {problem ? <Txt size={13} color={colors.redDeep} style={{ marginTop: 10 }}>{problem}</Txt> : null}
          <PrimaryButton label={h.busy ? 'Saving…' : 'Save'} dim={!!problem || h.busy} style={{ marginTop: 16 }} onPress={() => void save()} />
          {existing ? <TextButton label="Use my weekly hours again" size={14} onPress={() => void reset()} style={{ alignSelf: 'center', paddingVertical: 10 }} /> : null}
        </>
      ) : (
        <Txt size={14} color={colors.gray600} style={{ marginTop: 16 }}>Pick a date.</Txt>
      )}
    </Pad>
  );
}

/** Blocked time: from a date and time until a date and time (a break, a night off, days away). Closed until removed. */
function BlockSheet() {
  const e = useStore((s) => s.blockEdit);
  const tz = useStore((s) => s.comp.hours?.tz ?? TZ);
  const { saveBlock, removeBlock, closeSheet } = useStore.getState();
  const [open, setOpen] = useState<'from' | 'to' | null>(null);
  const set = (o: Partial<typeof e>) => useStore.setState((s) => ({ blockEdit: { ...s.blockEdit, ...o } }));
  const today = localToday(tz);
  const start = e.date ? localUnix(e.date, e.from, tz) : null;
  const end = e.until ? localUnix(e.until, e.to, tz) : null;
  const problem = start === null || end === null ? 'Pick when it starts and ends.'
    : end <= start ? 'The end has to be after the start.'
      : end <= Date.now() / 1000 ? 'That time is already over.' : null;
  const save = async () => {
    if (problem || e.busy) return;
    set({ busy: true });
    const ok = await saveBlock({ id: e.id, startsAt: start!, endsAt: end!, note: e.note.trim() });
    set({ busy: false });
    if (ok) closeSheet();
  };
  const remove = async () => {
    if (!e.id || e.busy) return;
    set({ busy: true });
    const ok = await removeBlock(e.id);
    set({ busy: false });
    if (ok) closeSheet();
  };
  return (
    <Pad scroll>
      <SheetTitle style={{ marginBottom: 2 }}>{e.id ? 'Blocked time' : 'Block time'}</SheetTitle>
      <Txt size={13} lh={1.45} color={colors.gray600} style={{ marginBottom: 12 }}>A break, a night off or days away: customers can’t book it, whatever your hours say, until you remove it. Bookings already in it stay.</Txt>
      <Txt size={14} weight={700} style={{ marginBottom: 8 }}>From</Txt>
      <DateStrip today={today} selected={e.date} marked="" onPick={(d) => set({ date: d, until: !e.until || e.until < d ? d : e.until })} />
      <View style={{ marginTop: 10, gap: 10 }}>
        <ClockField label="Start" value={minutes(e.from)} open={open === 'from'} onToggle={() => setOpen(open === 'from' ? null : 'from')} />
        {open === 'from' ? <ClockGrid value={minutes(e.from)} min={0} max={1425} onChange={(m) => set({ from: clock(m) })} /> : null}
      </View>
      <Txt size={14} weight={700} style={{ marginTop: 16, marginBottom: 8 }}>Until</Txt>
      <DateStrip today={e.date ?? today} selected={e.until} marked="" onPick={(d) => set({ until: d })} />
      <View style={{ marginTop: 10, gap: 10 }}>
        <ClockField label="End" value={minutes(e.to)} open={open === 'to'} onToggle={() => setOpen(open === 'to' ? null : 'to')} />
        {open === 'to' ? <ClockGrid value={minutes(e.to)} min={0} max={1425} onChange={(m) => set({ to: clock(m) })} /> : null}
      </View>
      <Txt size={14} weight={700} style={{ marginTop: 16, marginBottom: 8 }}>Note for yourself <Txt size={13} color={colors.gray600}>optional</Txt></Txt>
      <TextInput
        value={e.note} onChangeText={(v) => set({ note: v.slice(0, 60) })} accessibilityLabel={t('Note for yourself')} placeholder={t('e.g. Lunch, Holiday')} placeholderTextColor={colors.gray400}
        style={[font('body'), { height: 48, paddingHorizontal: 14, borderRadius: 14, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.white, fontSize: 15, color: colors.ink, outlineStyle: 'none' } as object]}
      />
      {problem && e.date && e.until ? <Txt size={13} color={colors.redDeep} style={{ marginTop: 10 }}>{problem}</Txt> : null}
      <PrimaryButton label={e.busy ? 'Saving…' : e.id ? 'Save' : 'Block this time'} dim={!!problem || e.busy} style={{ marginTop: 16 }} onPress={() => void save()} />
      {e.id ? <TextButton label="Remove and open this time again" size={14} color={colors.roseDeep} onPress={() => void remove()} style={{ alignSelf: 'center', paddingVertical: 10 }} /> : null}
    </Pad>
  );
}

/**
 * The next PLAN_DAYS days from `today` (the companion's date) as tiles, a dot on `marked` dates, scrolled to the
 * picked one. Labels are made once and the strip only redraws when the pick or the dots change.
 */
const DateStrip = memo(function DateStrip({ today, selected, marked, onPick }: { today: string; selected: string | null; marked: string; onPick: (date: string) => void }) {
  const days = useMemo(() => {
    const wd = new Intl.DateTimeFormat(locale(), { weekday: 'short', timeZone: 'UTC' });
    const mo = new Intl.DateTimeFormat(locale(), { month: 'short', timeZone: 'UTC' });
    return Array.from({ length: PLAN_DAYS + 1 }, (_, i) => {
      const d = addDays(today, i);
      const day = new Date(d + 'T12:00:00Z');
      // The month on the first tile and on each 1st, the weekday otherwise.
      return { d, top: i === 0 || day.getUTCDate() === 1 ? mo.format(day) : wd.format(day), num: String(day.getUTCDate()), label: dateLabel(d) };
    });
  }, [today]);
  const has = useMemo(() => new Set(marked.split(',')), [marked]);
  const ref = useRef<ScrollViewInstance>(null);
  const scrolled = useRef(false);
  const TILE = 60; // 54 wide + 6 gap
  return (
    <ScrollView
      ref={ref} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2, paddingRight: 4 }}
      onContentSizeChange={(w) => {
        if (scrolled.current || !w) return;
        scrolled.current = true;
        const i = days.findIndex((x) => x.d === selected);
        if (i > 2) ref.current?.scrollTo({ x: (i - 2) * TILE, animated: false });
      }}
    >
      {days.map(({ d, top, num, label }) => {
        const on = selected === d;
        return (
          <Pressable
            key={d} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }} onPress={() => onPick(d)}
            style={{ width: 54, height: 72, borderRadius: 14, borderWidth: 2, borderColor: on ? colors.ink : colors.hairline, backgroundColor: on ? colors.ink : colors.white, alignItems: 'center', justifyContent: 'center', gap: 1 }}
          >
            <Txt size={10.5} weight={600} color={on ? colors.sun : colors.gray600} numberOfLines={1}>{top}</Txt>
            <Txt size={18} weight={700} color={on ? colors.white : colors.ink}>{num}</Txt>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: has.has(d) ? colors.pink : 'transparent' }} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
});

/** A clock time; tapping it opens the hour and minute picker below. */
function ClockField({ label, value, open, onToggle }: { label: string; value: number; open: boolean; onToggle: () => void }) {
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={`${t(label)} ${clockText(value)}`} accessibilityState={{ expanded: open }} onPress={onToggle}
      style={{ flex: 1, minWidth: 0, height: 56, borderRadius: 14, borderWidth: 2, borderColor: colors.ink, backgroundColor: open ? colors.butter : colors.white, alignItems: 'center', justifyContent: 'center' }}
    >
      <Txt size={11} color={colors.gray600}>{label}</Txt>
      <Row style={{ gap: 4 }}>
        <Txt size={17} weight={700}>{clock(value)}</Txt>
        {value > 1440 ? <Txt size={11} weight={700} color={colors.roseDeep}>next day</Txt> : null}
      </Row>
    </Pressable>
  );
}

/** Hours, then minutes in 15-minute steps, between `min` and `max` (minutes from midnight; past 1440 is the next day). */
function ClockGrid({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (m: number) => void }) {
  const hrs: number[] = [];
  for (let x = Math.floor(min / 60); x <= Math.floor(max / 60); x++) hrs.push(x);
  const hour = Math.floor(value / 60);
  const ok = (m: number) => m >= min && m <= max;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {hrs.map((x) => {
          const on = x === hour;
          const label = String(x % 24).padStart(2, '0');
          return (
            <Pressable
              key={x} accessibilityRole="button" accessibilityLabel={x >= 24 ? t(`${label}:00 next day`) : `${label}:00`} accessibilityState={{ selected: on }}
              onPress={() => { const m = x * 60 + (value % 60); onChange(ok(m) ? m : Math.min(max, Math.max(min, x * 60))); }}
              style={{ width: 46, height: 38, borderRadius: 10, borderWidth: on ? 2 : 1, borderColor: colors.ink, backgroundColor: on ? colors.ink : x >= 24 ? colors.lilac : colors.white, alignItems: 'center', justifyContent: 'center' }}
            >
              <Txt size={14} weight={700} color={on ? colors.white : colors.ink}>{label}</Txt>
            </Pressable>
          );
        })}
      </View>
      <Row style={{ gap: 6 }}>
        {[0, 15, 30, 45].map((q) => {
          const m = hour * 60 + q;
          const on = m === value;
          return (
            <Pressable
              key={q} accessibilityRole="button" accessibilityLabel={clockText(m)} accessibilityState={{ selected: on, disabled: !ok(m) }} disabled={!ok(m)} onPress={() => onChange(m)}
              style={{ flex: 1, height: 38, borderRadius: 10, borderWidth: 1, borderColor: ok(m) ? colors.ink : colors.butter, backgroundColor: on ? colors.ink : ok(m) ? colors.white : colors.butter, alignItems: 'center', justifyContent: 'center' }}
            >
              <Txt size={14} weight={600} color={on ? colors.white : ok(m) ? colors.ink : colors.gray350}>{`:${String(q).padStart(2, '0')}`}</Txt>
            </Pressable>
          );
        })}
      </Row>
    </View>
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
          <Pressable key={n} accessibilityRole="button" accessibilityLabel={t(n === 1 ? '1 star' : `${n} stars`)} onPress={() => set({ stars: n })} style={{ padding: 2 }}>
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
  const edit = useStore((s) => s.edit ?? {
    name: s.user?.name ?? '', bio: s.user?.bio ?? '', gender: s.user?.gender ?? null, age: s.user?.age ? String(s.user.age) : '',
    languages: s.user?.languages ?? [], interests: s.user?.interests ?? [],
  });
  const set = (o: Partial<typeof edit>) => useStore.setState({ edit: { ...edit, ...o } });
  const save = () => void useStore.getState().saveEdit();
  const label = (text: string, top = 14) => <Txt size={13} weight={600} style={{ marginTop: top, marginBottom: 6 }}>{text}</Txt>;
  return (
    <Pad scroll>
      <SheetTitle style={{ marginBottom: 4 }}>Personal details</SheetTitle>
      <Txt size={13} lh={1.45} color={colors.gray600} style={{ marginBottom: 6 }}>Companions you book see your profile, so they know who they’re meeting.</Txt>
      {label('Name')}
      <TextInput value={edit.name} onChangeText={(t) => set({ name: t })} accessibilityLabel="Name" style={[font('body'), input, { height: 50 }]} />
      {label('About')}
      <TextInput value={edit.bio} onChangeText={(t) => set({ bio: t })} accessibilityLabel="About" placeholder={t('A few words about you and what you enjoy')} placeholderTextColor={colors.gray400} multiline textAlignVertical="top" style={[font('body'), input, { height: 96, padding: 14, fontSize: 15, lineHeight: 22 }]} />
      <Row style={{ gap: 12, marginTop: 14, alignItems: 'flex-start' }}>
        <View style={{ width: 92 }}>
          <Txt size={13} weight={600} style={{ marginBottom: 6 }}>Age</Txt>
          <TextInput value={edit.age} onChangeText={(t) => set({ age: t.replace(/\D/g, '').slice(0, 2) })} accessibilityLabel="Age" keyboardType="number-pad" placeholder={t('Optional')} placeholderTextColor={colors.gray400} style={[font('body'), input, { height: 50 }]} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt size={13} weight={600} style={{ marginBottom: 6 }}>Gender</Txt>
          <Row style={{ gap: 6, flexWrap: 'wrap', minHeight: 50 }}>
            {GENDERS.map(([g, l]) => <Chip key={g} label={l} on={edit.gender === g} onPress={() => set({ gender: edit.gender === g ? null : g })} height={34} padL={12} padR={12} />)}
          </Row>
        </View>
      </Row>
      {label('Languages')}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {LANGS.map((l) => <Chip key={l} label={l} on={edit.languages.includes(l)} onPress={() => set({ languages: toggleIn(edit.languages, l) })} height={34} padL={12} padR={12} />)}
      </View>
      {label('Interests')}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {INTERESTS.map((i) => <Chip key={i} label={i} on={edit.interests.includes(i)} onPress={() => set({ interests: toggleIn(edit.interests, i) })} height={34} padL={12} padR={12} />)}
      </View>
      <Txt size={12} lh={1.45} color={colors.gray600} style={{ marginTop: 12 }}>Age, gender, languages and interests are optional. Your email, phone and ID documents are never shown.</Txt>
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
          <Box shadow={3} fit style={{ marginTop: 4, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 14, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.butter }}>
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
  const late = !companion && b.status === 'confirmed' && Date.now() / 1000 > (mine?.freeUntil ?? b.startsAt - FREE_CANCEL_HOURS * 3600);

  // Once accepted, ZeitMit's fee isn't refundable; a request is refunded in full.
  const fee = pending ? 0 : mine?.fee ?? 0;
  const policy = companion
    ? { icon: 'rotate-ccw', bg: colors.lilac, text: pending ? `${other} gets everything back. You won’t receive the ${eur((theirs?.payout ?? 0) / 100)}.` : `You won’t receive the ${eur((theirs?.payout ?? 0) / 100)}: ${other} gets it back. ZeitMit’s service fee isn’t refundable.` }
    : late
      ? { icon: 'circle-alert', bg: '#FDF3E2', text: `It’s less than ${FREE_CANCEL_HOURS} hours before, so there’s no refund. ${other} is paid for the time they reserved.` }
      : fee > 0
        ? { icon: 'circle-check', bg: colors.mintSoft, text: `You get ${eur(((mine?.total ?? 0) - fee) / 100)} back. The ${eur(fee / 100)} service fee isn’t refundable once ${other} has accepted.` }
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
          <Txt size={13} color={colors.gray600}>{b.day} · {b.time}{b.place ? ` · ${b.place}` : ''}</Txt>
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
