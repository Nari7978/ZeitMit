import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { AM, ageStr, boundariesOf, eur, kindsOf, LEVEL, ratingStr, reviewsStr, slotDay, type Companion, type Kind } from '../data';
import { api, ApiError } from '../api';
import { useStore } from '../store';
import { canMessage, goBack, messageCompanion, openBooking, openQuickBook } from '../nav';
import { daysOf, firstStart, timeOf, useAvailability, type Availability } from '../lib/avail';
import { whenAt } from '../lib/dates';
import { Icon } from '../ui/Icon';
import { Chip, H, PressBox, Row, Stripes, Txt, Photo } from '../ui/primitives';
import { CircleButton, SaveButton, SecondaryButton, Unavailable, usePullRefresh, useTopPad } from '../ui/common';
import { getLang, locale, t } from '../i18n';
import { useAppWidth } from '../ui/layout';

/** About 4:5 like the uploaded photos, but at most ~60% of the screen's height (tablets turned sideways). */
function usePhotoHeight() {
  const width = useAppWidth();
  const { height } = useWindowDimensions();
  return Math.round(Math.min(width * 1.2, height * 0.62));
}

/** Profile photo first, then the companion's other photos: swipe through them, the dots show where you are. */
function PhotoSlides({ c, height }: { c: Companion; height: number }) {
  const width = useAppWidth();
  const [at, setAt] = useState(0);
  const slides = [c.photoUrl, ...(c.gallery ?? [])].filter((u): u is string => !!u);
  const shade = (
    <LinearGradient pointerEvents="none" colors={['rgba(18,14,38,.45)', 'rgba(18,14,38,0)']} locations={[0, 0.28]} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
  );
  if (slides.length < 2) {
    return (
      <>
        <Photo hue={c.hue} url={c.photoUrl} />
        {shade}
        <Txt kind="mono" size={11} weight={500} color="rgba(23,21,43,.55)" style={{ position: 'absolute', left: 20, bottom: 60 }}>{c.photoUrl ? '' : c.photo}</Txt>
      </>
    );
  }
  return (
    <>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={32}
        onScroll={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / width);
          if (i !== at) setAt(i);
        }}
        accessibilityLabel={t(`${slides.length} photos`)}
      >
        {slides.map((u) => (
          <View key={u} style={{ width, height }}>
            <Photo hue={c.hue} url={u} />
          </View>
        ))}
      </ScrollView>
      {shade}
      <View testID="photo-dots" pointerEvents="none" style={{ position: 'absolute', bottom: 42, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        {slides.map((u, i) => (
          <View key={u} style={{ width: i === at ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: i === at ? colors.white : 'rgba(255,255,255,.55)' }} />
        ))}
      </View>
    </>
  );
}

type Detail = Companion & {
  reviewList: { n: string; a: string; stars: number; t: string; created_at: number }[];
  /** When they can be booked (free intervals per kind they offer); kept current with useAvailability. */
  availability?: Availability | null;
  no: string[];
};

export default function Profile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const listed = useStore((s) => s.byId[id]);
  const [detail, setDetail] = useState<Detail | null>(null);
  // Paused, removed or never existed (an old link): the API says 404.
  const [missing, setMissing] = useState(false);
  const loadDetail = useCallback(
    () => api<Detail>('GET', `/companions/${id}`).then((d) => { setDetail(d); setMissing(false); }).catch((e) => {
      if (e instanceof ApiError && e.status === 404) setMissing(true);
      else useStore.getState().showToast(e.message);
    }),
    [id],
  );
  useEffect(() => { void loadDetail(); }, [loadDetail]);
  const { a: liveFree, reload: reloadSlots } = useAvailability(missing ? undefined : id);
  // Which kind the day strip shows when they offer both (in person first).
  const [stripPick, setStripPick] = useState<Kind | null>(null);
  const refresh = usePullRefresh(() => Promise.all([loadDetail(), reloadSlots()]));
  const c: Companion | undefined = missing ? undefined : detail ?? listed;
  const insets = useSafeAreaInsets();
  const top = useTopPad();
  const [scrolled, setScrolled] = useState(false);
  const [allReviews, setAllReviews] = useState(false);
  const chatOpen = useStore((s) => canMessage(id, s));
  const photoH = usePhotoHeight();
  // Small phones (and German, whose labels are longer, below 400 px): the Message button shows just its icon.
  const appWidth = useAppWidth();
  const narrow = appWidth < 360 || (getLang() === 'de' && appWidth < 400);
  const { showToast, openSheet } = useStore.getState();
  if (missing) return <Unavailable bg={colors.white} title="This companion isn’t available" body="They may have paused or removed their profile." />;
  if (!c) return <View style={{ flex: 1, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.ink} /></View>;

  const reviews = detail?.reviewList ?? [];
  // In-person and video dates share one calendar, but each range of hours can be for one kind: each its next free time.
  const kinds = kindsOf(c.acts);
  const avail = liveFree ?? detail?.availability ?? null;
  const free: Record<Kind, number | null> = { meet: avail ? firstStart(avail, 'meet') : null, video: avail ? firstStart(avail, 'video') : null };
  const stripKind: Kind = stripPick && kinds.includes(stripPick) ? stripPick : kinds[0] ?? 'meet';
  const strip = avail ? daysOf(avail, stripKind) : [];
  const bookKind = free[stripKind] !== null ? stripKind : kinds.find((k) => free[k] !== null);
  const freeLabel = (k: Kind) => (k === 'video' ? 'Next free video date' : kinds.length > 1 ? 'Next free in person' : 'Next free');
  const btnBg = scrolled ? colors.white : 'rgba(255,255,255,.88)';
  const btnBd = scrolled ? colors.ink : 'transparent';

  return (
    <View style={{ flex: 1, backgroundColor: colors.white }}>
      <StatusBar style={scrolled ? 'dark' : 'light'} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={refresh}
        scrollEventThrottle={32}
        onScroll={(e) => {
          const v = e.nativeEvent.contentOffset.y > photoH - 90;
          if (v !== scrolled) setScrolled(v);
        }}
        contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}
      >
        <View style={{ height: photoH }}>
          <PhotoSlides c={c} height={photoH} />
        </View>

        <View style={{ marginTop: -26, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: colors.white, paddingTop: 26, paddingHorizontal: 20 }}>
          <Row style={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <H size={31} lh={1.1} ls={-0.035}>{c.name}{ageStr(c)}</H>
              {c.pron ? <Txt size={13} color={colors.gray600} style={{ marginTop: 4 }}>{c.pron}</Txt> : null}
            </View>
            {c.verified ? (
              <Row style={{ height: 30, paddingHorizontal: 11, borderRadius: 999, backgroundColor: colors.blush, gap: 5, marginTop: 4 }}>
                <Icon name="badge-check" size={15} />
                <Txt size={12} weight={600}>ID verified</Txt>
              </Row>
            ) : (
              <Row style={{ height: 30, paddingHorizontal: 11, borderRadius: 999, borderWidth: 2, borderColor: colors.ink, gap: 5, marginTop: 4 }}>
                <Icon name="clock" size={14} color={colors.gray600} />
                <Txt size={12} weight={600} color={colors.gray600}>Verification pending</Txt>
              </Row>
            )}
          </Row>
          <Txt raw size={16} lh={1.4} color={colors.gray800} style={{ marginTop: 8 }}>{c.tagline}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8, columnGap: 16, marginTop: 14 }}>
            <Row style={{ gap: 5 }}>
              <Icon name="map-pin" size={15} color={colors.gray600} />
              <Txt size={14}>{c.dist ? `${c.area} · ${c.dist} away` : c.area}</Txt>
            </Row>
            <Txt size={14}><Txt size={14} color={colors.amber}>★</Txt> <Txt size={14} weight={700}>{ratingStr(c)}</Txt> <Txt size={14} color={colors.gray600}>{reviewsStr(c)}</Txt></Txt>
          </View>
          <View style={{ height: 1, backgroundColor: colors.ink, marginVertical: 22 }} />

          <Section title="About" first />
          <Txt raw size={15} lh={1.6} color={colors.gray900} align="justify">{c.bio}</Txt>

          <Section title="Interests" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {c.interests.map((t) => (
              <View key={t} style={{ height: 34, paddingHorizontal: 14, borderRadius: 999, borderWidth: 2, borderColor: colors.ink, justifyContent: 'center' }}>
                <Txt size={14}>{t}</Txt>
              </View>
            ))}
          </View>

          <Section title="Activities offered" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {c.acts.map((a) => (
              <View key={a} style={{ width: '47%', flexGrow: 1, gap: 10, padding: 14, borderRadius: 18, backgroundColor: colors.sun }}>
                <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={AM[a].icon} size={18} />
                </View>
                <View>
                  <Txt size={14} weight={600}>{AM[a].label}</Txt>
                  <Txt size={12} lh={1.35} color={colors.gray600} style={{ marginTop: 2 }}>{AM[a].desc}</Txt>
                </View>
              </View>
            ))}
          </View>

          {/* Dates in person and video dates each have their own boundaries: the ones for each kind they offer. */}
          <Txt size={17} weight={700} style={{ marginTop: 26, marginBottom: 4 }}>Boundaries</Txt>
          <Txt size={13} color={colors.gray600} style={{ marginBottom: 12 }}>
            {kinds.length > 1 ? `Set by ${c.name}. Dates in person and video dates each have their own.` : kinds[0] === 'video' ? `Set by ${c.name}. They apply to every video date.` : `Set by ${c.name}. They apply to every booking.`}
          </Txt>
          {(kinds.length ? kinds : (['meet'] as Kind[])).map((k, i) => {
            const bd = boundariesOf(c, k);
            return (
              <View key={k} style={{ gap: 8, marginTop: i ? 14 : 0 }}>
                {kinds.length > 1 ? (
                  <Row style={{ gap: 6 }}>
                    <Icon name={k === 'video' ? 'video' : 'users-round'} size={15} />
                    <Txt size={14} weight={700}>{k === 'video' ? 'On video dates' : 'In person'}</Txt>
                  </Row>
                ) : null}
                <Row style={{ gap: 10, alignItems: 'stretch' }}>
                  <BoundaryList title="Comfortable with" titleColor={colors.greenDeep} bg={colors.greenSoft} items={bd.ok.length ? bd.ok : [bd.none]} icon="check" iconColor={colors.green} />
                  <BoundaryList title="Never offered" titleColor={colors.gray800} bg={colors.butter} items={bd.no} icon="x" iconColor={colors.red} />
                </Row>
              </View>
            );
          })}

          <Txt size={17} weight={700} style={{ marginTop: 26, marginBottom: 8 }}>Languages</Txt>
          {c.langs.map(([l, lv]) => (
            <Row key={l} style={{ justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.hairline }}>
              <Txt size={15}>{l}</Txt>
              <Row style={{ gap: 10 }}>
                <Txt size={13} color={colors.gray600}>{lv}</Txt>
                <Row style={{ gap: 3 }}>
                  {[1, 2, 3, 4].map((i) => <View key={i} style={{ width: 14, height: 4, borderRadius: 2, backgroundColor: i <= LEVEL[lv] ? colors.ink : colors.track }} />)}
                </Row>
              </Row>
            </Row>
          ))}

          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 26, marginBottom: 12 }}>
            <Txt size={17} weight={700}>Availability</Txt>
            {/* Takes the room beside the title and wraps there (German is longer). */}
            <Txt size={12} color={colors.gray600} align="right" style={{ flex: 1, marginLeft: 12 }}>Or tap a day to pick a time</Txt>
          </Row>
          {/* When they're next free, live, for each kind they offer: once someone books it, it moves on to the next free time. */}
          {kinds.map((k) => {
            const f = free[k];
            if (!avail?.kinds[k]) return null; // still loading
            return f !== null ? (
              <PressBox key={k} shadow={4} shadowColor={colors.greenDeep} fx="push" onPress={() => openQuickBook(c.id, k)} accessibilityLabel={`${freeLabel(k)}: ${whenAt(f)}. Book it`}
                style={{ marginBottom: 12, padding: 14, borderRadius: 18, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.mintSoft, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                {k === 'video' ? <Icon name="video" size={16} color={colors.greenDeep} /> : <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.green }} />}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt size={12} weight={600} color={colors.gray800} numberOfLines={1}>{freeLabel(k)}</Txt>
                  <Txt size={17} weight={700} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{whenAt(f)}</Txt>
                </View>
                <View style={{ height: 40, paddingHorizontal: 16, borderRadius: 12, backgroundColor: colors.ink, justifyContent: 'center' }}>
                  <Txt size={14} weight={700} color={colors.white}>Book it</Txt>
                </View>
              </PressBox>
            ) : (
              <View key={k} style={{ marginBottom: 12, padding: 14, borderRadius: 18, backgroundColor: colors.cream }}>
                <Txt size={14} color={colors.gray600}>{k === 'video' ? 'No video date free in the next 7 days.' : kinds.length > 1 ? 'No in-person time free in the next 7 days.' : `${c.name} isn’t free in the next 7 days.`}</Txt>
              </View>
            );
          })}
          {/* Both kinds: the day strip shows one at a time. */}
          {kinds.length > 1 ? (
            <Row style={{ gap: 8, marginBottom: 10 }}>
              {kinds.map((k) => (
                <Chip key={k} label={k === 'video' ? 'Video date' : 'In person'} icon={k === 'video' ? 'video' : 'map-pin'} on={stripKind === k} onPress={() => setStripPick(k)} height={34} style={{ flex: 1 }} />
              ))}
            </Row>
          ) : null}
          <Row style={{ gap: 6 }}>
            {(strip.length ? strip : Array.from({ length: 7 }, () => null)).map((day, i) => {
              const d = day ? slotDay(day.date, i) : null;
              const n = day ? day.starts.length : 0;
              const first = n ? timeOf(day!.starts[0]) : '';
              return (
                <Pressable
                  key={day?.date ?? i}
                  accessibilityRole="button"
                  accessibilityLabel={d ? (n ? `${d.full}, free from ${first}` : `${d.full}, not free`) : 'Loading'}
                  accessibilityState={{ disabled: !n }}
                  onPress={() => n && openBooking(c.id, day!.date, kinds.length > 1 ? stripKind : undefined)}
                  style={{ flex: 1, alignItems: 'center', gap: 3, paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: n ? colors.ink : colors.cream, backgroundColor: n ? colors.white : colors.cream }}
                >
                  <Txt size={11} weight={500} color={n ? colors.ink : colors.gray400}>{d?.d ?? ' '}</Txt>
                  <Txt size={17} weight={700} color={n ? colors.ink : colors.gray400}>{d?.n ?? ' '}</Txt>
                  <Txt size={9.5} color={colors.gray600} numberOfLines={1}>{!d ? ' ' : n ? first : '—'}</Txt>
                </Pressable>
              );
            })}
          </Row>

          <Section title="Reviews" />
          <Row style={{ gap: 16, padding: 16, borderRadius: 18, backgroundColor: colors.sun }}>
            <H size={38} ls={-0.03}>{ratingStr(c)}</H>
            <View style={{ gap: 3, flex: 1 }}>
              <Txt size={15} ls={0.13} color={colors.amber}>★★★★★</Txt>
              <Txt size={13} color={colors.gray600}>{c.rating ? 'From ' + c.reviews + ' completed bookings' : 'A rating appears after 3 completed bookings'}</Txt>
            </View>
          </Row>
          {reviews.slice(0, allReviews ? 20 : 2).map((r, i) => (
            <View key={i} style={{ paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.hairline, gap: 8 }}>
              <Row style={{ gap: 10 }}>
                <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.butter, alignItems: 'center', justifyContent: 'center' }}>
                  <Txt size={13} weight={700} color={colors.gray800}>{r.n[0]}</Txt>
                </View>
                <View style={{ flex: 1 }}>
                  <Txt size={14} weight={600}>{r.n}</Txt>
                  <Txt size={12} color={colors.gray600}>{new Intl.DateTimeFormat(locale(), { month: 'short', year: 'numeric' }).format(new Date(r.created_at * 1000))} · {r.a} · Verified booking</Txt>
                </View>
              </Row>
              <Txt raw size={14} lh={1.55} color={colors.gray900}>{r.t}</Txt>
            </View>
          ))}
          {reviews.length > 2 && !allReviews ? (
            <SecondaryButton label={'See all ' + reviews.length + ' reviews'} onPress={() => setAllReviews(true)} style={{ marginTop: 14 }} />
          ) : null}

          <Row style={{ marginTop: 24, marginBottom: 8, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 16, borderWidth: 2, borderColor: colors.ink, gap: 12 }}>
            <Icon name="shield-check" size={18} color={colors.green} />
            <Txt size={13} lh={1.45} color={colors.gray800} style={{ flex: 1 }}>Meet in public and pay only through ZeitMit.</Txt>
            <Pressable accessibilityRole="button" onPress={() => openSheet('report', { reportReason: null, reportTarget: c.id })} style={{ padding: 4 }}>
              <Txt size={13} weight={600} color={colors.red}>Report</Txt>
            </Pressable>
          </Row>
        </View>
      </ScrollView>

      {/* Status bar backdrop once scrolled past the photo */}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, backgroundColor: scrolled ? 'rgba(255,255,255,.96)' : 'transparent' }} />

      {/* Floating top buttons */}
      <Row style={{ position: 'absolute', top, left: 16, right: 16, justifyContent: 'space-between' }}>
        <CircleButton icon="chevron-left" label="Back" iconSize={22} border={1} bg={btnBg} borderColor={btnBd} onPress={() => goBack()} />
        <Row style={{ gap: 8 }}>
          <CircleButton icon="share" label="Share" iconSize={18} border={1} bg={btnBg} borderColor={btnBd} onPress={() => showToast('Profile link copied')} />
          <SaveButton id={c.id} variant="profile" scrolled={scrolled} size={42} iconSize={19} />
        </Row>
      </Row>

      {/* Sticky booking bar */}
      <Row style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 14, paddingHorizontal: 20, paddingBottom: Math.max(30, insets.bottom + 8), backgroundColor: 'rgba(255,255,255,.96)', borderTopWidth: 2, borderTopColor: colors.ink, gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={14} color={colors.gray600} numberOfLines={1}><H size={23} weight={700} ls={-0.02}>{eur(c.rate)}</H>/h</Txt>
          <Txt size={12} color={colors.gray600} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>+10% fee</Txt>
        </View>
        <SecondaryButton label={narrow ? '' : 'Message'} accessibilityLabel={t('Message')} icon={chatOpen ? 'message-circle' : 'lock'} iconSize={17} height={50} radius={15} size={15} style={{ paddingHorizontal: 14 }} onPress={() => messageCompanion(c.id, c.name)} />
        <PressBox shadow={3} shadowColor={colors.pink} fx="scale" onPress={() => (bookKind ? openQuickBook(c.id, bookKind) : openBooking(c.id))} accessibilityLabel="Book now" style={{ height: 50, paddingHorizontal: 18, borderRadius: 15, backgroundColor: colors.ink, justifyContent: 'center' }}>
          <Txt size={15} weight={600} color={colors.white}>Book now</Txt>
        </PressBox>
      </Row>
    </View>
  );
}

function Section({ title, first }: { title: string; first?: boolean }) {
  return <Txt size={17} weight={700} style={{ marginTop: first ? 0 : 26, marginBottom: first ? 10 : 12 }}>{title}</Txt>;
}

function BoundaryList({ title, titleColor, bg, items, icon, iconColor }: { title: string; titleColor: string; bg: string; items: string[]; icon: string; iconColor: string }) {
  return (
    <View style={{ flex: 1, padding: 14, borderRadius: 18, backgroundColor: bg, gap: 8 }}>
      <Txt size={12} weight={700} color={titleColor}>{title}</Txt>
      {items.map((o) => (
        <Row key={o} style={{ gap: 6, alignItems: 'flex-start' }}>
          <Icon name={icon} size={14} color={iconColor} style={{ marginTop: 1 }} />
          <Txt size={13} lh={1.35} style={{ flex: 1 }}>{o}</Txt>
        </Row>
      ))}
    </View>
  );
}
