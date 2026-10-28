import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, TextInput, View, type TextInputInstance } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { colors, font } from '../theme';
import { A, ageStr, eur, isDateCompanion, PREF, ratingStr, reviewsStr, SORT, WHEN } from '../data';
import { filterCount, filtered, toggleIn, useStore, type Filters } from '../store';
import { openProfile } from '../nav';
import { Icon } from '../ui/Icon';
import { Chip, Enter, H, PressBox, Row, Stripes, Txt, Photo } from '../ui/primitives';
import { EmptyState, SaveButton, SecondaryButton, StatusCover, TextButton, useTopPad } from '../ui/common';
import { useNavBottom } from '../ui/chrome';
import { t } from '../i18n';

export function activeChips(f: Filters): [string, Partial<Filters>][] {
  const chips: [string, Partial<Filters>][] = [];
  if (f.type === 'date') chips.push(['Date-style', { type: 'all' }]);
  if (f.when !== 'any') chips.push([WHEN[f.when], { when: 'any' }]);
  if (f.max < 60) chips.push(['Up to ' + eur(f.max) + '/h', { max: 60 }]);
  f.langs.forEach((l) => chips.push([l, { langs: f.langs.filter((x) => x !== l) }]));
  if (f.rating) chips.push([f.rating + '+ rating', { rating: 0 }]);
  if (f.pref !== 'any') chips.push([PREF[f.pref], { pref: 'any' }]);
  if (f.lgbtq) chips.push(['LGBTQ+-friendly', { lgbtq: false }]);
  return chips;
}

export default function Search() {
  const top = useTopPad();
  const bottom = useNavBottom() + 90;
  const { city, query, f, sort, set, setF, clearAll, openSheet } = useStore();
  const inputRef = useRef<TextInputInstance>(null);
  const params = useLocalSearchParams<{ focus?: string }>();

  useEffect(() => {
    if (params.focus) {
      const t = setTimeout(() => inputRef.current?.focus(), 80);
      router.setParams({ focus: undefined });
      return () => clearTimeout(t);
    }
  }, [params.focus]);

  const list = useStore((s) => s.companions);
  const loading = useStore((s) => s.loading);
  const results = filtered(list, query, f, sort);
  const count = filterCount(f);
  const chips = activeChips(f);

  return (
    <View style={{ flex: 1, backgroundColor: colors.sun }}>
      <StatusCover color={colors.sun} />
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: top, paddingBottom: bottom }}>
        <Enter>
          <View style={{ paddingTop: 8, paddingHorizontal: 20, gap: 14 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <H size={30} ls={-0.035}>Search</H>
              <Pressable accessibilityRole="button" accessibilityLabel={`City: ${city}`} onPress={() => openSheet('city')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: 999, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.white }}>
                <Icon name="map-pin" size={15} />
                <Txt size={13} weight={600}>{city}</Txt>
              </Pressable>
            </Row>
            <Row style={{ gap: 10 }}>
              <View style={{ flex: 1 }}>
                <View style={{ position: 'absolute', top: 3, left: 3, right: -3, bottom: -3, borderRadius: 16, backgroundColor: colors.ink }} />
                <Row style={{ height: 52, gap: 10, paddingLeft: 16, paddingRight: 8, borderRadius: 16, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink }}>
                  <Icon name="search" size={19} color={colors.gray600} />
                  <TextInput
                    ref={inputRef}
                    value={query}
                    onChangeText={(t) => set({ query: t })}
                    accessibilityLabel="Search companions"
                    placeholder={t("Activity, interest, language…")}
                    placeholderTextColor={colors.gray400}
                    returnKeyType="search"
                    style={[font('body', 400), { flex: 1, minWidth: 0, fontSize: 16, color: colors.ink, paddingVertical: 0, outlineStyle: 'none' } as object]}
                  />
                  {query ? (
                    <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => set({ query: '' })} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.butter, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="x" size={15} color={colors.gray600} />
                    </Pressable>
                  ) : null}
                </Row>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={count ? `Filters, ${count} active` : 'Filters'}
                onPress={() => openSheet('filter')}
                style={{ width: 52, height: 52, borderRadius: 16, borderWidth: 2, borderColor: colors.ink, backgroundColor: count ? colors.ink : colors.white, alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="sliders-horizontal" size={20} color={count ? colors.white : colors.ink} />
                {count ? (
                  <View style={{ position: 'absolute', top: -5, right: -5, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 999, backgroundColor: colors.ink, borderWidth: 2, borderColor: colors.sun, alignItems: 'center', justifyContent: 'center' }}>
                    <Txt size={11} weight={700} color={colors.white}>{count}</Txt>
                  </View>
                ) : null}
              </Pressable>
            </Row>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 14, paddingHorizontal: 20, paddingBottom: 2 }}>
            {A.map((a) => (
              <Chip key={a.id} label={a.label} icon={a.icon} on={f.acts.includes(a.id)} padL={12} padR={14} onPress={() => setF({ acts: toggleIn(useStore.getState().f.acts, a.id) })} />
            ))}
          </ScrollView>

          {chips.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 12, paddingHorizontal: 20, alignItems: 'center' }}>
              {chips.map(([label, p]) => (
                <Pressable key={label} accessibilityRole="button" accessibilityLabel={`Remove ${label}`} onPress={() => setF(p)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingLeft: 12, paddingRight: 8, borderRadius: 999, backgroundColor: colors.ink }}>
                  <Txt size={12} weight={500} color={colors.white}>{label}</Txt>
                  <Icon name="x" size={13} color="rgba(255,255,255,.7)" />
                </Pressable>
              ))}
              <TextButton label="Clear all" size={13} onPress={clearAll} style={{ paddingHorizontal: 6 }} />
            </View>
          ) : null}

          <Row style={{ justifyContent: 'space-between', paddingTop: 20, paddingHorizontal: 20, paddingBottom: 12 }}>
            <Txt size={14} color={colors.gray600}>{results.length}{results.length === 1 ? ' companion' : ' companions'} in {city}</Txt>
            <Pressable accessibilityRole="button" accessibilityLabel={`Sort: ${SORT[sort]}`} onPress={() => openSheet('sort')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 }}>
              <Icon name="arrow-up-down" size={15} color={colors.gray600} />
              <Txt size={14} weight={600}>{SORT[sort]}</Txt>
            </Pressable>
          </Row>

          {results.length ? (
            <View style={{ gap: 12, paddingHorizontal: 20 }}>
              {results.map((c) => (
                <Enter key={c.id}>
                  <PressBox shadow={4} fx="scale" onPress={() => openProfile(c.id)} accessibilityLabel={`${c.name}, ${eur(c.rate)} per hour`} style={{ flexDirection: 'row', gap: 14, padding: 10, borderRadius: 22, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink }}>
                    <View style={{ width: 104, height: 132, borderRadius: 16, overflow: 'hidden' }}>
                      <Photo hue={c.hue} url={c.photoUrl} />
                      <Txt kind="mono" size={9} weight={500} lh={1.35} color="rgba(23,21,43,.5)" style={{ position: 'absolute', left: 8, right: 8, bottom: 8 }}>{c.photoUrl ? '' : c.photo}</Txt>
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 5, paddingTop: 4, paddingRight: 2, paddingBottom: 2 }}>
                      <Row style={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
                        <Row style={{ gap: 5, flexShrink: 1, minWidth: 0 }}>
                          <Txt size={17} weight={700} ls={-0.01} numberOfLines={1}>{c.name}{ageStr(c)}</Txt>
                          {c.verified ? <Icon name="badge-check" size={16} /> : null}
                        </Row>
                        <SaveButton id={c.id} variant="light" size={32} iconSize={15} style={{ marginTop: -4, marginRight: -2 }} />
                      </Row>
                      <Txt size={13} color={colors.gray600}>
                        {c.area} · {c.dist} · <Txt size={13}><Txt size={13} color={colors.amber}>★</Txt> {ratingStr(c)}</Txt> {reviewsStr(c)}
                      </Txt>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                        {isDateCompanion(c) ? (
                          <Row style={{ height: 24, paddingHorizontal: 9, borderRadius: 999, backgroundColor: colors.blush, gap: 4 }}>
                            <Icon name="heart" size={11} color={colors.roseDeep} />
                            <Txt size={12} weight={600} color={colors.roseDeep}>Dates</Txt>
                          </Row>
                        ) : null}
                        {c.interests.slice(0, 2).map((t) => (
                          <View key={t} style={{ height: 24, paddingHorizontal: 9, borderRadius: 999, backgroundColor: colors.butter, justifyContent: 'center' }}>
                            <Txt size={12} color={colors.gray800}>{t}</Txt>
                          </View>
                        ))}
                      </View>
                      <Row style={{ marginTop: 'auto', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                        <Txt size={13} color={colors.gray600} numberOfLines={1}>
                          <Txt size={17} weight={700}>{eur(c.rate)}</Txt> / hour
                        </Txt>
                        {c.today ? <Txt size={12} weight={600} color={colors.green}>Free today</Txt> : null}
                      </Row>
                    </View>
                  </PressBox>
                </Enter>
              ))}
            </View>
          ) : (
            list.length || loading ? (
              <EmptyState icon="search-x" tilt={-8} title="No one matches all of that" body="Try a wider price range, another day, or fewer languages." action={<SecondaryButton label="Clear filters" onPress={clearAll} style={{ marginTop: 8 }} />} />
            ) : (
              <EmptyState icon="users-round" tilt={-8} title="No companions in Berlin yet" body="We’re reviewing the first profiles now. Check back soon, or become one of the first companions." action={<SecondaryButton label="Become a companion" onPress={() => router.push('/become')} style={{ marginTop: 8 }} />} />
            )
          )}
        </Enter>
      </ScrollView>
    </View>
  );
}
