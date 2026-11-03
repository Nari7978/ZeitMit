// First launch on a phone: three short screens about ZeitMit before the login (shown once). Swipe or tap Next;
// Skip and Get started go to the login.
import { useRef, useState, type ReactNode } from 'react';
import { ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { AM, eur } from '../data';
import { useStore } from '../store';
import { Icon } from '../ui/Icon';
import { H, Row, Txt } from '../ui/primitives';
import { PrimaryButton, TextButton } from '../ui/common';
import { Sticker, WordSwap } from '../ui/playful';
import { useAppWidth } from '../ui/layout';
import { HERO_WORDS, Logo, STICKERS } from './Discover';

const PAGES = 3;

const SAFE: [string, string, string][] = [
  ['badge-check', 'ID-checked companions', 'Every companion shows us their ID before their profile goes live.'],
  ['map-pin', 'Public places only', 'Cafés, parks, museums and venues. Never at someone’s home.'],
  ['lock', 'Paid safely in the app', 'ZeitMit holds the money until you meet and share your meet code.'],
  ['shield-check', 'Check-ins and SOS', 'Someone you trust can follow your meet-up live.'],
];

const EARN: [string, string, string][] = [
  ['calendar-days', 'Your hours', 'Open only the times that suit you.'],
  ['list-checks', 'Your rules', 'Pick activities and boundaries. Accept only what feels right.'],
  ['wallet', 'Your money', 'Withdraw to your bank account from €20.'],
];

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const width = useAppWidth();
  const pager = useRef<ScrollViewInstance>(null);
  const [page, setPage] = useState(0);
  const finish = () => useStore.getState().finishWelcome();
  const last = page === PAGES - 1;
  const next = () => {
    if (last) return finish();
    pager.current?.scrollTo({ x: (page + 1) * width, animated: true });
    setPage(page + 1);
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.min(PAGES - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.x / width)));
    if (i !== page) setPage(i);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.sun, paddingTop: insets.top + 8 }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center', height: 44, paddingHorizontal: 20 }}>
        <Logo size={24} />
        {!last ? <TextButton label="Skip" size={15} onPress={finish} style={{ paddingHorizontal: 4 }} /> : null}
      </Row>

      <ScrollView ref={pager} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={onScroll} scrollEventThrottle={32} style={{ flex: 1 }}>
        {/* 1) What it is */}
        <Page width={width}>
          <H size={52} lh={52} ls={-0.055}>Rent</H>
          <WordSwap words={HERO_WORDS} running={page === 0} size={38} />
          <Txt size={15} lh={1.5} color={colors.gray800} style={{ marginTop: 16 }}>
            Real people in Berlin for coffee, city walks, culture, dinner and plus-ones. Always in public, always paid through ZeitMit.
          </Txt>
          <View style={{ gap: 10, marginTop: 22 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {[STICKERS.slice(0, 3), STICKERS.slice(3)].map((row, r) => (
              <Row key={r} style={{ gap: 10, alignItems: 'stretch' }}>
                {row.map((st) => (
                  <View key={st.id} style={{ flex: 1, aspectRatio: 1 / 0.8, borderRadius: 18, borderWidth: 2.5, borderColor: colors.ink, backgroundColor: st.bg, padding: 10, justifyContent: 'space-between', transform: [{ rotate: st.tilt }] }}>
                    <Icon name={AM[st.id].icon} size={22} color={st.fg} />
                    <Txt kind="display" weight={800} size={14} lh={15} ls={-0.02} color={st.fg} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8}>{st.label}</Txt>
                  </View>
                ))}
              </Row>
            ))}
          </View>
        </Page>

        {/* 2) How it keeps you safe */}
        <Page width={width}>
          <H size={38} lh={40} ls={-0.045}>Safe by design</H>
          <Txt size={15} lh={1.5} color={colors.gray800} style={{ marginTop: 10, marginBottom: 18 }}>Built so every meet-up is easy to trust, on both sides.</Txt>
          <View style={{ gap: 14 }}>
            {SAFE.map(([icon, title, body]) => <Point key={title} icon={icon} title={title} body={body} />)}
          </View>
        </Page>

        {/* 3) Becoming a companion */}
        <Page width={width}>
          <H size={38} lh={40} ls={-0.045}>Share your time, too</H>
          <Txt size={15} lh={1.5} color={colors.gray800} style={{ marginTop: 10 }}>Become a companion and get paid for coffee, walks and plus-ones.</Txt>
          <View style={{ marginTop: 18, marginBottom: 20 }}>
            <Sticker shadow={5} radius={20} style={{ backgroundColor: colors.mint, paddingHorizontal: 18, paddingVertical: 14, transform: [{ rotate: '-2deg' }] }}>
              <Row style={{ alignItems: 'flex-end', gap: 4 }}>
                <H size={34} lh={36} ls={-0.04}>{eur(25)}</H>
                <Txt size={15} weight={700} style={{ marginBottom: 4 }}>/h</Txt>
              </Row>
              <Txt size={13} weight={600}>You set your rate · Paid after each meet-up</Txt>
            </Sticker>
          </View>
          <View style={{ gap: 14 }}>
            {EARN.map(([icon, title, body]) => <Point key={title} icon={icon} title={title} body={body} />)}
          </View>
        </Page>
      </ScrollView>

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: insets.bottom + 18, gap: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {Array.from({ length: PAGES }, (_, i) => (
            <View key={i} style={{ width: i === page ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: i === page ? colors.ink : 'rgba(17,17,17,.25)' }} />
          ))}
        </View>
        <PrimaryButton label={last ? 'Get started' : 'Next'} icon={last ? 'arrow-right' : undefined} onPress={next} />
      </View>
    </View>
  );
}

/** One page of the intro; scrolls on its own if a small phone can't fit it. */
function Page({ width, children }: { width: number; children: ReactNode }) {
  return (
    <ScrollView style={{ width }} showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 22, paddingVertical: 12 }}>
      {children}
    </ScrollView>
  );
}

function Point({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <Row style={{ gap: 14, alignItems: 'flex-start' }}>
      <View style={{ width: 44, height: 44, borderRadius: 14, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={20} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt size={15} weight={700}>{title}</Txt>
        <Txt size={13.5} lh={1.45} color={colors.gray800}>{body}</Txt>
      </View>
    </Row>
  );
}
