import { Pressable, ScrollView, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { colors } from '../theme';
import { A, AM, ageStr, ratingStr, ROM, eur, isDateCompanion, type Companion } from '../data';
import { useStore } from '../store';
import { openProfile, searchWith } from '../nav';
import { Icon } from '../ui/Icon';
import { Box, Enter, H, PressBox, Row, Shimmer, Stripes, Txt, Photo } from '../ui/primitives';
import { PrimaryButton, SaveButton, SectionHead, StatusCover, TextButton, useTopPad } from '../ui/common';
import { openSettings } from './Settings';
import { useNavBottom } from '../ui/chrome';
import { oklch } from '../lib/oklch';

const DATE_TILES = [
  { bg: colors.pink, fg: colors.white },
  { bg: colors.violet, fg: colors.white },
  { bg: colors.mint, fg: colors.ink },
  { bg: colors.white, fg: colors.ink },
];

export default function Discover() {
  const top = useTopPad();
  const bottom = useNavBottom() + 90;
  const city = useStore((s) => s.city);
  const first = useStore((s) => s.user?.first ?? '');
  const loading = useStore((s) => s.loading);
  const hasUnread = useStore((s) => s.notifs.some((n) => !n.read));
  const openSheet = useStore((s) => s.openSheet);

  const C = useStore((s) => s.companions);
  const saved = useStore((s) => s.saved);
  const featured = C.slice(0, 5);
  // Right after launch there may be no approved companions yet.
  const hasCompanions = loading || C.length > 0;
  const walkers = C.filter((c) => c.acts.includes('walks'));
  const dateList = C.filter(isDateCompanion);
  // "Similar interests": interests of the companions you saved, matched against everyone else.
  const liked = new Set(C.filter((c) => saved.includes(c.id)).flatMap((c) => c.interests));
  const similar = C.filter((c) => !saved.includes(c.id))
    .map((c) => ({ c, shared: c.interests.filter((i) => liked.has(i)) }))
    .sort((a, b) => b.shared.length - a.shared.length)
    .slice(0, 3);

  return (
    <View style={{ flex: 1, backgroundColor: colors.sun }}>
      <StatusCover color={colors.sun} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: top, paddingBottom: bottom }}>
        <Enter>
          {/* Header */}
          <Row style={{ justifyContent: 'space-between', paddingTop: 8, paddingHorizontal: 20 }}>
            <Logo size={24} />
            <Row style={{ gap: 8 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`City: ${city}`}
                onPress={() => openSheet('city')}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingLeft: 10, paddingRight: 12, borderRadius: 999, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.white }}
              >
                <Icon name="map-pin" size={16} />
                <Txt size={14} weight={600}>{city}</Txt>
                <Icon name="chevron-down" size={14} color={colors.gray600} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Notifications"
                onPress={() => router.push('/notifications')}
                style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="bell" size={18} />
                {hasUnread ? <View style={{ position: 'absolute', top: 7, right: 8, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.red, borderWidth: 2, borderColor: colors.white }} /> : null}
              </Pressable>
            </Row>
          </Row>

          {/* Hero */}
          <View style={{ paddingTop: 26, paddingHorizontal: 20 }}>
            <Txt size={15} color={colors.gray600} style={{ marginBottom: 6 }}>Good morning, {first}</Txt>
            <H size={52} lh={47} ls={-0.055}>
              Rent a date.{'\n'}
              <Txt kind="display" weight={800} size={52} ls={-0.055} color={colors.rose}>Or a mate.</Txt>
            </H>
          </View>

          {/* Search entry */}
          <View style={{ paddingTop: 20, paddingHorizontal: 20 }}>
            <Pressable
              accessibilityRole="search"
              accessibilityLabel="Find a date or a mate"
              onPress={() => router.navigate({ pathname: '/search', params: { focus: '1' } })}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 12, height: 56, paddingLeft: 18, paddingRight: 8, borderRadius: 18, borderWidth: 2, borderColor: colors.ink,
                backgroundColor: colors.white, shadowColor: colors.ink, shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 4,
              }}
            >
              <Icon name="search" size={20} />
              <Txt size={15} color={colors.gray600} style={{ flex: 1 }}>Find a date or a mate</Txt>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="sliders-horizontal" size={17} color={colors.white} />
              </View>
            </Pressable>
          </View>

          {/* Activity shortcuts */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingTop: 22, paddingBottom: 8, paddingHorizontal: 20 }}>
            {A.slice(0, 8).map((a) => (
              <PressBox key={a.id} fx="scale" onPress={() => searchWith({ acts: [a.id] })} accessibilityLabel={a.label} style={{ minWidth: 70, alignItems: 'center', gap: 8 }}>
                <Box shadow={4} style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={a.icon} size={22} />
                </Box>
                <Txt size={12} weight={500} numberOfLines={1}>{a.label}</Txt>
              </PressBox>
            ))}
          </ScrollView>

          {/* Featured */}
          {hasCompanions ? (
            <>
              <SectionHead title="Featured this week" onSeeAll={() => router.navigate('/search')} style={{ marginTop: 24, marginBottom: 14 }} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={266} decelerationRate="fast" contentContainerStyle={{ gap: 14, paddingHorizontal: 20, paddingBottom: 18 }}>
                {loading
                  ? [0, 1].map((i) => <Shimmer key={i} style={{ width: 252, height: 336, borderRadius: 24 }} />)
                  : featured.map((c) => <FeaturedCard key={c.id} c={c} />)}
              </ScrollView>
            </>
          ) : (
            <LaunchCard />
          )}

          {/* Swipe mode + Gift */}
          <Row style={{ gap: 10, paddingHorizontal: 20, paddingBottom: 26, alignItems: 'stretch' }}>
            <PressBox fx="push" shadow={4} onPress={() => router.push('/swipe')} accessibilityLabel="Swipe mode" style={[tile, { flex: 1.25, backgroundColor: colors.ink }]}>
              <Row style={{ width: '100%', justifyContent: 'space-between' }}>
                <Icon name="layers" size={24} color={colors.sun} />
                <View style={{ height: 22, paddingHorizontal: 8, borderRadius: 999, backgroundColor: colors.pink, justifyContent: 'center' }}>
                  <Txt size={11} weight={700} color={colors.white}>NEW</Txt>
                </View>
              </Row>
              <H size={22} lh={22} ls={-0.02} color={colors.sun}>Swipe mode</H>
            </PressBox>
            <PressBox fx="push" shadow={4} onPress={() => openSheet('gift', { gift: { amt: 100, to: '', msg: '', done: false } })} accessibilityLabel="Gift a date" style={[tile, { flex: 1, backgroundColor: colors.violet }]}>
              <Icon name="gift" size={24} color={colors.white} />
              <H size={22} lh={22} ls={-0.02} color={colors.white}>Gift a date</H>
            </PressBox>
          </Row>

          {/* Date experiences */}
          <View style={{ marginTop: 6, marginHorizontal: 20, marginBottom: 28, paddingTop: 20, paddingBottom: 18, borderRadius: 26, backgroundColor: colors.blush, overflow: 'hidden' }}>
            <View style={{ paddingHorizontal: 20, gap: 8 }}>
              <Row style={{ gap: 6 }}>
                <Icon name="heart" size={13} color={colors.roseDeep} />
                <Txt kind="mono" size={11} weight={600} ls={0.08} color={colors.roseDeep}>DATE EXPERIENCES</Txt>
              </Row>
              <Txt kind="display" weight={700} size={23} lh={1.12} ls={-0.025}>A date, a plus-one, or someone for the family lunch</Txt>
              <Txt size={13} lh={1.5} color={colors.gray800}>Romantic-style company in public, always within the companion’s own boundaries.</Txt>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingTop: 16, paddingHorizontal: 20, paddingBottom: 4 }}>
              {ROM.map((id, i) => (
                <PressBox
                  key={id}
                  fx="push"
                  shadow={4}
                  onPress={() => searchWith({ acts: [id] })}
                  accessibilityLabel={AM[id].label}
                  style={{ width: '47.5%', flexGrow: 1, height: 118, borderRadius: 22, borderWidth: 2.5, borderColor: colors.ink, backgroundColor: DATE_TILES[i].bg, padding: 14, justifyContent: 'space-between', alignItems: 'flex-start' }}
                >
                  <Icon name={AM[id].icon} size={24} color={DATE_TILES[i].fg} />
                  <H size={21} lh={21} ls={-0.02} color={DATE_TILES[i].fg}>{AM[id].label}</H>
                </PressBox>
              ))}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingTop: 16, paddingHorizontal: 20 }}>
              {dateList.map((c) => (
                <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={c.name} onPress={() => openProfile(c.id)} style={{ width: 132, gap: 8 }}>
                  <View style={{ height: 160, borderRadius: 18, overflow: 'hidden' }}><Photo hue={c.hue} url={c.photoUrl} /></View>
                  <View style={{ paddingHorizontal: 2 }}>
                    <Txt size={14} weight={600} numberOfLines={1}>{c.name}{ageStr(c)}</Txt>
                    <Txt size={12} color={colors.gray800}>{eur(c.rate)}/h · {c.area}</Txt>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {/* Explore your city */}
          <View style={{ paddingTop: 10, paddingHorizontal: 20 }}>
            <Pressable accessibilityRole="button" onPress={() => searchWith({ acts: ['walks'] })} style={{ height: 216, borderRadius: 26, overflow: 'hidden' }}>
              <Stripes hue={250} l={[0.8, 0.77]} c={[0.05, 0.055]} />
              <Txt kind="mono" size={10} weight={500} color="rgba(23,21,43,.5)" style={{ position: 'absolute', top: 16, right: 18 }}>editorial · canal path, autumn</Txt>
              <LinearGradient colors={['rgba(18,14,38,.82)', 'rgba(18,14,38,.35)', 'rgba(18,14,38,.1)']} locations={[0, 0.7, 1]} start={{ x: 0, y: 0.4 }} end={{ x: 1, y: 0.6 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
              <View style={{ position: 'absolute', left: 20, right: 20, bottom: 20, gap: 8 }}>
                <Txt kind="mono" size={11} weight={600} ls={0.08} color={colors.sun}>EXPLORE YOUR CITY</Txt>
                <Txt kind="display" weight={700} size={25} lh={1.1} ls={-0.025} color={colors.white} style={{ maxWidth: 240 }}>Sunday along the Landwehrkanal</Txt>
                <Row style={{ gap: 10, marginTop: 4 }}>
                  <Row>
                    {walkers.slice(0, 3).map((w) => (
                      <View key={w.id} style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#2A2142', marginRight: -8, overflow: 'hidden' }}><Photo hue={w.hue} url={w.photoUrl} /></View>
                    ))}
                  </Row>
                  {walkers.length ? <Txt size={13} color="rgba(255,255,255,.85)" style={{ marginLeft: 8 }}>{walkers.length} companions who know the quiet corners</Txt> : null}
                </Row>
              </View>
            </Pressable>
          </View>

          {hasCompanions ? (
            <>
          {/* Available today */}
          <SectionHead dot title="Available today" onSeeAll={() => searchWith({ when: 'today' })} style={{ marginTop: 32, marginBottom: 14 }} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: 20, paddingBottom: 4 }}>
            {C.filter((c) => c.today).map((c) => (
              <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={c.name} onPress={() => openProfile(c.id)} style={{ width: 148, gap: 10 }}>
                <View style={{ height: 184, borderRadius: 20, overflow: 'hidden' }}>
                  <Photo hue={c.hue} url={c.photoUrl} />
                  <Txt kind="mono" size={9} weight={500} lh={1.4} color="rgba(23,21,43,.5)" style={{ position: 'absolute', left: 10, right: 10, bottom: 10 }}>{c.photoUrl ? '' : c.photo}</Txt>
                  <SaveButton id={c.id} variant="photo" size={32} iconSize={15} style={{ position: 'absolute', top: 8, right: 8 }} />
                </View>
                <View style={{ gap: 2, paddingHorizontal: 2 }}>
                  <Txt size={15} weight={600}>{c.name}{ageStr(c)}</Txt>
                  <Txt size={13} color={colors.gray600}>{eur(c.rate)}/h · {c.area}</Txt>
                </View>
              </Pressable>
            ))}
          </ScrollView>

          {/* Coffee & conversation */}
          <SectionHead title="Coffee & conversation" onSeeAll={() => searchWith({ acts: ['coffee'] })} style={{ marginTop: 32, marginBottom: 14 }} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 18, paddingHorizontal: 20 }}>
            {C.filter((c) => c.acts.includes('coffee')).slice(0, 4).map((c) => (
              <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={c.name} onPress={() => openProfile(c.id)} style={{ width: '47%', flexGrow: 1, gap: 10, minWidth: 0 }}>
                <View style={{ aspectRatio: 4 / 5, borderRadius: 20, overflow: 'hidden' }}>
                  <Photo hue={c.hue} url={c.photoUrl} />
                  <Txt kind="mono" size={9} weight={500} lh={1.4} color="rgba(23,21,43,.5)" style={{ position: 'absolute', left: 10, top: 10, right: 10 }}>{c.photoUrl ? '' : c.photo}</Txt>
                  {c.verified ? (
                    <Row style={{ position: 'absolute', left: 10, bottom: 10, height: 24, paddingHorizontal: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,.92)', gap: 4 }}>
                      <Icon name="badge-check" size={13} />
                      <Txt size={11} weight={600}>Verified</Txt>
                    </Row>
                  ) : null}
                </View>
                <View style={{ gap: 3, paddingHorizontal: 2, minWidth: 0 }}>
                  <Row style={{ justifyContent: 'space-between', gap: 6 }}>
                    <Txt size={15} weight={600} numberOfLines={1} style={{ flexShrink: 1 }}>{c.name}{ageStr(c)}</Txt>
                    <Txt size={13}><Txt size={13} color={colors.amber}>★</Txt> {ratingStr(c)}</Txt>
                  </Row>
                  <Txt size={13} lh={1.35} color={colors.gray600} numberOfLines={1}>{c.tagline}</Txt>
                  <Txt size={13} weight={600} style={{ marginTop: 2 }}>{eur(c.rate)} <Txt size={13} color={colors.gray600}>/ hour</Txt></Txt>
                </View>
              </Pressable>
            ))}
          </View>

          {/* LGBTQ+-friendly */}
          <View style={{ marginTop: 36, marginHorizontal: 20, paddingTop: 22, paddingBottom: 6, borderTopWidth: 2, borderTopColor: colors.ink }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt kind="display" weight={700} size={21} ls={-0.02}>LGBTQ+-friendly</Txt>
              <TextButton label="See all" onPress={() => searchWith({ lgbtq: true })} />
            </Row>
            <Row style={{ gap: 8, marginTop: 6 }}>
              <LinearGradient colors={['#D9435F', '#E99A24', '#178A60', '#3B6FE0', '#111111']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: 28, height: 4, borderRadius: 2 }} />
              <Txt size={13} lh={1.4} color={colors.gray600} style={{ flex: 1 }}>Companions who chose to show this on their profile.</Txt>
            </Row>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingTop: 14, paddingHorizontal: 20, paddingBottom: 8 }}>
            {C.filter((c) => c.lgbtq).map((c) => (
              <PressBox key={c.id} shadow={4} fx="push" onPress={() => openProfile(c.id)} accessibilityLabel={c.name} style={{ width: 220, flexDirection: 'row', gap: 12, alignItems: 'center', padding: 10, borderRadius: 20, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink }}>
                <View style={{ width: 64, height: 76, borderRadius: 14, overflow: 'hidden' }}><Photo hue={c.hue} url={c.photoUrl} /></View>
                <View style={{ gap: 3, flex: 1, minWidth: 0 }}>
                  <Txt size={15} weight={600}>{c.name}{ageStr(c)}</Txt>
                  <Txt size={12} color={colors.gray600} numberOfLines={1}>{c.area} · {c.dist}</Txt>
                  <Txt size={13} weight={600}>{eur(c.rate)}<Txt size={13} color={colors.gray600}>/h</Txt></Txt>
                </View>
              </PressBox>
            ))}
          </ScrollView>

          {/* Similar interests */}
          <SectionHead title="People with similar interests" style={{ marginTop: 28, marginBottom: 6 }} />
          <View style={{ paddingHorizontal: 20 }}>
            {similar.map(({ c, shared }) => {
              const k = c.id;
              return (
                <Pressable key={k} accessibilityRole="button" accessibilityLabel={c.name} onPress={() => openProfile(k)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: colors.ink }}>
                  <View style={{ width: 52, height: 52, borderRadius: 26, overflow: 'hidden' }}><Photo hue={c.hue} url={c.photoUrl} /></View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Txt size={15} weight={600}>{c.name}{ageStr(c)}</Txt>
                    <Txt size={13} color={colors.gray600}>{shared.length ? 'You both like ' + shared.slice(0, 2).join(' & ') : c.tagline}</Txt>
                  </View>
                  <Txt size={14} weight={600}>{eur(c.rate)}<Txt size={14} color={colors.gray600}>/h</Txt></Txt>
                  <Icon name="chevron-right" size={18} color={colors.gray400} />
                </Pressable>
              );
            })}
          </View>

            </>
          ) : null}

          {/* Respectful by design */}
          <Row style={{ marginTop: 28, marginHorizontal: 20, padding: 18, borderRadius: 20, backgroundColor: colors.lilac, gap: 14, alignItems: 'flex-start' }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="shield-check" size={20} />
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Txt size={15} weight={700}>Respectful by design</Txt>
              <Txt size={13} lh={1.5} color={colors.gray800}>Every meeting is in a public place, booked and paid through ZeitMit, and covered by our community guidelines.</Txt>
              <TextButton label="How we keep it safe →" size={13} onPress={() => openSettings('guidelines')} style={{ alignSelf: 'flex-start', paddingVertical: 2 }} />
            </View>
          </Row>
        </Enter>
      </ScrollView>
    </View>
  );
}

const tile = {
  height: 104, borderRadius: 22, borderWidth: 2.5, borderColor: colors.ink, padding: 14,
  justifyContent: 'space-between' as const, alignItems: 'flex-start' as const,
};

export function Logo({ size, bangColor = colors.pink, color = colors.ink }: { size: number; bangColor?: string; color?: string }) {
  return (
    <H size={size} ls={-0.035} color={color}>
      zeitmit<Txt kind="display" weight={800} size={size} color={bangColor}>!</Txt>
    </H>
  );
}

function FeaturedCard({ c }: { c: Companion }) {
  return (
    <Enter>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${c.name}, ${c.tagline}`}
        onPress={() => openProfile(c.id)}
        style={{ width: 252, height: 336, borderRadius: 24, overflow: 'hidden', backgroundColor: oklch(0.885, 0.04, c.hue) }}
      >
        <Photo hue={c.hue} url={c.photoUrl} />
        <Txt kind="mono" size={10} weight={500} lh={1.4} color="rgba(23,21,43,.5)" style={{ position: 'absolute', top: 16, left: 16, maxWidth: 150 }}>{c.photoUrl ? '' : c.photo}</Txt>
        <SaveButton id={c.id} variant="photo" size={38} iconSize={18} style={{ position: 'absolute', top: 12, right: 12 }} />
        <LinearGradient colors={['rgba(18,14,38,0)', 'rgba(18,14,38,.86)']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '62%' }} />
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: 16, gap: 6 }}>
          <Row style={{ gap: 6 }}>
            <Txt kind="display" weight={700} size={23} ls={-0.02} color={colors.white} numberOfLines={1}>{c.name}{ageStr(c)}</Txt>
            {c.verified ? <Icon name="badge-check" size={18} color={colors.sun} /> : null}
          </Row>
          <Txt size={13} color="rgba(255,255,255,.82)">{c.tagline}</Txt>
          <Row style={{ gap: 6, marginTop: 4 }}>
            {c.interests.slice(0, 2).map((t) => (
              <View key={t} style={{ height: 26, paddingHorizontal: 10, borderRadius: 999, backgroundColor: 'rgba(255,255,255,.18)', justifyContent: 'center' }}>
                <Txt size={12} weight={500} color={colors.white}>{t}</Txt>
              </View>
            ))}
          </Row>
          <Row style={{ justifyContent: 'space-between', marginTop: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,.18)' }}>
            <Txt size={13} color={colors.white}>
              <Txt size={13} color="#FFC56B">★ </Txt>{ratingStr(c)} <Txt size={13} color="rgba(255,255,255,.7)">· {c.area}</Txt>
            </Txt>
            <Txt size={13} color={colors.white}>
              <Txt size={16} weight={700} color={colors.white}>{eur(c.rate)}</Txt>
              <Txt size={13} color="rgba(255,255,255,.7)">/h</Txt>
            </Txt>
          </Row>
        </View>
      </Pressable>
    </Enter>
  );
}

/** Shown on Discover while no companion has been approved yet. */
function LaunchCard() {
  const status = useStore((s) => s.companionStatus);
  return (
    <Box shadow={4} style={{ marginTop: 24, marginHorizontal: 20, marginBottom: 26, padding: 20, borderRadius: 24, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, gap: 10 }}>
      <Txt kind="mono" size={11} weight={600} ls={0.08} color={colors.roseDeep}>JUST LAUNCHED IN BERLIN</Txt>
      <H size={24} lh={1.12} ls={-0.025}>The first companions are joining now</H>
      <Txt size={14} lh={1.5} color={colors.gray800}>We check every profile and ID before it goes live, so it takes a little while. We’ll show new companions here as soon as they’re approved.</Txt>
      {status === 'none' || status === 'rejected' ? (
        <PrimaryButton label="Become one of the first" onPress={() => router.push('/become')} style={{ marginTop: 6 }} />
      ) : status === 'pending' ? (
        <Txt size={13} weight={600} color={colors.gray600}>Your companion profile is in review.</Txt>
      ) : null}
    </Box>
  );
}
