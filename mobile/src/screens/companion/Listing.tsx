import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { colors, font } from '../../theme';
import { A, INTERESTS, LANGS, OKOPTS, type Companion } from '../../data';
import { api } from '../../api';
import { pickAndUpload } from '../../lib/photos';
import { GALLERY_MAX, GALLERY_MIN, toggleIn, useStore } from '../../store';
import { openProfile, toCustomerMode } from '../../nav';
import { Icon } from '../../ui/Icon';
import { Box, Chip, Photo, Row, Toggle, Txt } from '../../ui/primitives';
import { PrimaryButton, SecondaryButton, TextButton } from '../../ui/common';
import { PhotoGrid, type GalleryPhoto } from '../../ui/PhotoGrid';
import { GENDERS, RateStepper } from '../Become';
import { CompShell } from './Shell';
import { t } from '../../i18n';

const LEVELS = ['Native', 'Fluent', 'Conversational', 'Basic'];

type Draft = {
  photoUrl: string | null; tagline: string; about: string; interests: string[]; langs: Record<string, string>; ok: string[];
  area: string; showAge: boolean; lgbtq: boolean; age: string; gender: 'w' | 'm' | 'nb'; pronouns: string;
};

export default function Listing() {
  const cRate = useStore((s) => s.comp.rate);
  const cActs = useStore((s) => s.comp.acts);
  const status = useStore((s) => s.companionStatus);
  const me = useStore((s) => s.user?.id);
  const { setListing, showToast } = useStore.getState();
  const [d, setD] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'photo' | 'gallery' | 'save' | null>(null);
  const [gallery, setGallery] = useState<GalleryPhoto[] | null>(null);
  const upd = (o: Partial<Draft>) => { setD((x) => (x ? { ...x, ...o } : x)); setDirty(true); };

  useEffect(() => {
    api<Companion & { bio: string; showAge: boolean; ageValue: number | null; galleryIds: string[]; gallery: string[] }>('GET', '/companion')
      .then((c) => {
        setD({
          photoUrl: c.photoUrl ?? null, tagline: c.tagline, about: c.bio, interests: c.interests, ok: c.ok, area: c.area,
          langs: Object.fromEntries(c.langs), showAge: c.showAge, lgbtq: c.lgbtq,
          age: c.ageValue ? String(c.ageValue) : '', gender: c.g, pronouns: c.pron ?? '',
        });
        setGallery(c.galleryIds.map((id, i) => ({ id, url: c.gallery[i] })));
      })
      .catch((e) => showToast(e.message));
  }, [showToast]);

  const changePhoto = async () => {
    setBusy('photo');
    try {
      const r = await pickAndUpload('companion');
      if (r) { setD((x) => (x ? { ...x, photoUrl: r.url } : x)); showToast('Listing photo updated'); }
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // The extra photos are saved straight away (the server keeps at least 3 once there are 3).
  const saveGallery = async (next: GalleryPhoto[], done: string) => {
    const r = await api<{ ids: string[]; gallery: string[] }>('PUT', '/companion/gallery', { ids: next.map((p) => p.id) });
    setGallery(r.ids.map((id, i) => ({ id, url: r.gallery[i] })));
    useStore.setState((s) => ({ comp: { ...s.comp, gallery: r.ids.length } }));
    showToast(done);
  };
  const addPhoto = async () => {
    if (!gallery || busy) return;
    setBusy('gallery');
    try {
      const r = await pickAndUpload('gallery');
      if (r) await saveGallery([...gallery, r], 'Photo added');
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const removePhoto = async (id: string) => {
    if (!gallery || busy) return;
    if (gallery.length <= GALLERY_MIN) return showToast('Keep at least 3 photos. Add a new one before removing this one.');
    setBusy('gallery');
    try {
      await saveGallery(gallery.filter((p) => p.id !== id), 'Photo removed');
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!d) return;
    if (d.about.trim().length < 40) return showToast('Write at least 40 characters about yourself.');
    if (!Object.keys(d.langs).length) return showToast('Pick at least one language.');
    if (!/^\d{2}$/.test(d.age) || +d.age < 18) return showToast('Enter your age. You must be 18 or older.');
    setBusy('save');
    try {
      await api('PATCH', '/companion', {
        tagline: d.tagline, about: d.about, interests: d.interests, ok: d.ok, area: d.area, showAge: d.showAge, lgbtq: d.lgbtq,
        age: +d.age, gender: d.gender, pronouns: d.pronouns,
        langs: Object.keys(d.langs), levels: d.langs,
      });
      setDirty(false);
      showToast('Listing saved');
      void useStore.getState().refresh();
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const card = { padding: 18, borderRadius: 22, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, gap: 12 };
  const input = [font('body'), { borderRadius: 14, borderWidth: 2, borderColor: colors.ink, paddingHorizontal: 14, fontSize: 15, color: colors.ink, backgroundColor: colors.white, outlineStyle: 'none' } as object];

  return (
    <CompShell title="Your listing">
      <Box shadow={4} style={[card, { flexDirection: 'row', alignItems: 'center', gap: 14 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Change listing photo" onPress={() => void changePhoto()} style={{ width: 84, height: 104, borderRadius: 16, overflow: 'hidden', borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
          {d?.photoUrl ? <Photo hue={0} url={d.photoUrl} /> : <Icon name={busy === 'photo' ? 'hourglass' : 'image-plus'} size={26} />}
        </Pressable>
        <View style={{ flex: 1, gap: 4 }}>
          <Txt size={15} weight={700}>Listing photo</Txt>
          <Txt size={12} lh={1.4} color={colors.gray600}>Shown on Discover, Search and your profile.</Txt>
          <Row style={{ gap: 14 }}>
            <TextButton label={d?.photoUrl ? 'Change' : 'Add photo'} size={13} onPress={() => void changePhoto()} />
            {status === 'approved' && me ? <TextButton label="View as customer" size={13} onPress={() => openProfile(me)} /> : null}
          </Row>
        </View>
      </Box>

      {gallery ? (
        <Box shadow={4} style={card}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt size={15} weight={700}>More photos</Txt>
            <Txt size={12} weight={600} color={gallery.length >= GALLERY_MIN ? colors.greenDeep : colors.red}>{`${gallery.length}/${GALLERY_MAX}`}</Txt>
          </Row>
          <Txt size={12} lh={1.45} color={gallery.length >= GALLERY_MIN ? colors.gray600 : colors.red}>
            {gallery.length >= GALLERY_MIN ? 'Customers swipe through these on your profile. Keep at least 3.' : 'Add at least 3 photos besides your profile photo, ideally doing things you enjoy. Customers swipe through them on your profile.'}
          </Txt>
          <PhotoGrid photos={gallery} adding={busy === 'gallery'} onAdd={() => void addPhoto()} onRemove={(id) => void removePhoto(id)} />
        </Box>
      ) : null}

      <Box shadow={4} style={[card, { gap: 14 }]}>
        <Txt size={15} weight={700}>Hourly rate</Txt>
        <RateStepper bare rate={cRate} onChange={(r) => setListing({ rate: r })} />
        <Txt size={12} color={colors.gray600} align="center">Customers see your rate plus a separate 10% service fee.</Txt>
      </Box>
      <Box shadow={4} style={card}>
        <Txt size={15} weight={700}>Activities you offer</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {A.map((a) => (
            <Chip key={a.id} label={a.label} icon={a.icon} padL={11} padR={13} on={cActs.includes(a.id)} onPress={() => setListing({ acts: toggleIn(useStore.getState().comp.acts, a.id) })} />
          ))}
        </View>
      </Box>

      {d ? (
        <>
          <Box shadow={4} style={card}>
            <Txt size={15} weight={700}>About you</Txt>
            <Txt size={12} weight={600} color={colors.gray600}>Tagline</Txt>
            <TextInput value={d.tagline} onChangeText={(t) => upd({ tagline: t.slice(0, 60) })} placeholder={t("e.g. Second coffees and gallery Sundays")} placeholderTextColor={colors.gray400} accessibilityLabel="Tagline" style={[...input, { height: 46 }]} />
            <Txt size={12} weight={600} color={colors.gray600}>About</Txt>
            <TextInput value={d.about} onChangeText={(t) => upd({ about: t.slice(0, 400) })} multiline textAlignVertical="top" accessibilityLabel="About" style={[...input, { height: 120, paddingTop: 12, lineHeight: 21 }]} />
            <Txt size={12} color={colors.gray600} align="right">{d.about.length}/400</Txt>
            <Row style={{ gap: 10 }}>
              <View style={{ width: 80, gap: 6 }}>
                <Txt size={12} weight={600} color={colors.gray600}>Age</Txt>
                <TextInput value={d.age} onChangeText={(v) => upd({ age: v.replace(/\D/g, '').slice(0, 2) })} keyboardType="number-pad" accessibilityLabel="Age" style={[...input, { height: 46 }]} />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Txt size={12} weight={600} color={colors.gray600}>Pronouns (optional)</Txt>
                <TextInput value={d.pronouns} onChangeText={(v) => upd({ pronouns: v.slice(0, 20) })} placeholder={t('e.g. she/her')} placeholderTextColor={colors.gray400} autoCapitalize="none" accessibilityLabel="Pronouns" style={[...input, { height: 46 }]} />
              </View>
            </Row>
            <Txt size={12} weight={600} color={colors.gray600}>I am a</Txt>
            <Row style={{ gap: 8 }}>
              {GENDERS.map(([k, l]) => <Chip key={k} label={l} height={40} radius={12} weight={600} style={{ flex: 1 }} on={d.gender === k} onPress={() => upd({ gender: k })} />)}
            </Row>
            <Txt size={12} weight={600} color={colors.gray600}>Area</Txt>
            <TextInput value={d.area} onChangeText={(t) => upd({ area: t.slice(0, 40) })} placeholder={t("e.g. Kreuzberg")} placeholderTextColor={colors.gray400} accessibilityLabel="Area" style={[...input, { height: 46 }]} />
          </Box>

          <Box shadow={4} style={card}>
            <Txt size={15} weight={700}>Interests</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {[...new Set([...INTERESTS, ...d.interests])].map((i) => <Chip key={i} label={i} on={d.interests.includes(i)} onPress={() => upd({ interests: toggleIn(d.interests, i) })} />)}
            </View>
          </Box>

          <Box shadow={4} style={card}>
            <Txt size={15} weight={700}>Languages</Txt>
            <Txt size={12} color={colors.gray600}>Tap a language to add it, tap its level to change it.</Txt>
            {LANGS.map((l) => {
              const lv = d.langs[l];
              return (
                <Row key={l} style={{ gap: 10 }}>
                  <Chip label={l} on={!!lv} onPress={() => { const n = { ...d.langs }; if (lv) delete n[l]; else n[l] = 'Fluent'; upd({ langs: n }); }} style={{ minWidth: 104 }} />
                  {lv ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={`${l} level: ${lv}`} onPress={() => upd({ langs: { ...d.langs, [l]: LEVELS[(LEVELS.indexOf(lv) + 1) % LEVELS.length] } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 }}>
                      <Txt size={13} weight={600}>{lv}</Txt>
                      <Icon name="repeat" size={13} color={colors.gray600} />
                    </Pressable>
                  ) : null}
                </Row>
              );
            })}
          </Box>

          <Box shadow={4} style={card}>
            <Txt size={15} weight={700}>Your boundaries</Txt>
            <Txt size={12} lh={1.45} color={colors.gray600}>What you’re comfortable with on date-style bookings. Kissing, intimacy and private locations are never allowed.</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {OKOPTS.map((o) => <Chip key={o} label={o} on={d.ok.includes(o)} onPress={() => upd({ ok: toggleIn(d.ok, o) })} />)}
            </View>
          </Box>

          <Box shadow={4} style={[card, { gap: 0, paddingVertical: 4 }]}>
            <Row style={{ gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.hairline }}>
              <View style={{ flex: 1 }}><Txt size={15} weight={600}>Show my age</Txt></View>
              <Toggle on={d.showAge} label="Show my age" onPress={() => upd({ showAge: !d.showAge })} />
            </Row>
            <Row style={{ gap: 12, paddingVertical: 12 }}>
              <View style={{ flex: 1 }}>
                <Txt size={15} weight={600}>LGBTQ+-friendly</Txt>
                <Txt size={12} color={colors.gray600}>Show this label on your profile.</Txt>
              </View>
              <Toggle on={d.lgbtq} label="LGBTQ+-friendly" onPress={() => upd({ lgbtq: !d.lgbtq })} />
            </Row>
          </Box>

          <PrimaryButton label={busy === 'save' ? 'Saving…' : dirty ? 'Save listing' : 'Saved'} dim={!dirty || busy === 'save'} onPress={() => void save()} />
        </>
      ) : (
        <Txt size={14} color={colors.gray600}>Loading your listing…</Txt>
      )}
      <SecondaryButton label="Switch to customer mode" icon="repeat" iconSize={16} height={50} radius={16} size={15} onPress={toCustomerMode} />
    </CompShell>
  );
}
