import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { pickAndUpload } from '../lib/photos';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font } from '../theme';
import { A, AM, CSTEPS, eur, INTERESTS, LANGS, OKOPTS, WEEK, WIN, type ActId } from '../data';
import { toggleIn, useStore } from '../store';
import { toCompanionMode } from '../nav';
import { Icon } from '../ui/Icon';
import { Box, Chip, Enter, H, Row, Stripes, Toggle, Txt, Photo } from '../ui/primitives';
import { CircleButton, IconTile, PrimaryButton, SecondaryButton, TextButton, useTopPad } from '../ui/common';
import { StepTitle } from './BookingFlow';
import { t } from '../i18n';

type Draft = {
  name: string; showAge: boolean; about: string; aboutErr: boolean; interests: string[]; acts: ActId[]; langs: string[];
  rate: number; days: string[]; wins: string[]; ok: string[]; adult: boolean; idv: boolean; rules: boolean;
  photoId?: string; photoUrl?: string; idPhotoId?: string; tagline: string;
};

const HOW: [string, string, string][] = [
  ['user-round', 'Create your profile', 'Introduce yourself through what you enjoy, not how you look.'],
  ['list-checks', 'Choose activities', 'Friendship or date-style, within boundaries you set.'],
  ['euro', 'Set your hourly rate', 'You decide. Customers see every fee up front.'],
  ['calendar-range', 'Set availability', 'Open the hours that suit you, change them anytime.'],
  ['inbox', 'Accept requests', 'Read the plan first. Accept only what feels right.'],
  ['wallet', 'Get paid for completed bookings', 'Payouts follow each completed booking, once verified.'],
];

export default function Become() {
  const insets = useSafeAreaInsets();
  const top = useTopPad();
  const first = useStore((s) => s.user?.first ?? '');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [b, setB] = useState<Draft>({ name: first, showAge: true, about: '', aboutErr: false, interests: [], acts: [], langs: [], rate: 25, days: [], wins: [], ok: [], adult: false, idv: false, rules: false, tagline: '' });
  const [uploading, setUploading] = useState<'photo' | 'id' | null>(null);
  const upload = async (kind: 'companion' | 'id', source: 'library' | 'camera') => {
    setUploading(kind === 'id' ? 'id' : 'photo');
    try {
      const r = await pickAndUpload(kind, source);
      if (r) upd(kind === 'id' ? { idPhotoId: r.id, idv: true } : { photoId: r.id, photoUrl: r.url });
    } catch (e) {
      useStore.getState().showToast((e as Error).message);
    } finally {
      setUploading(null);
    }
  };
  const upd = (o: Partial<Draft>) => setB((x) => ({ ...x, ...o }));
  const footPad = Math.max(30, insets.bottom + 8);

  const valid = [true, !!b.name.trim() && b.about.trim().length >= 40, b.acts.length > 0 && b.langs.length > 0, b.days.length > 0 && b.wins.length > 0, b.adult && b.idv && b.rules, true][step];
  const next = () => {
    if (!valid && step !== 1) return;
    if (step === 1 && b.about.trim().length < 40) return upd({ aboutErr: true });
    if (step < 5) {
      upd({ aboutErr: false });
      return setStep(step + 1);
    }
    if (busy) return;
    setBusy(true);
    void useStore.getState()
      .submitCompanion({ name: b.name, showAge: b.showAge, about: b.about, interests: b.interests, acts: b.acts, ok: b.ok, langs: b.langs, rate: b.rate, days: b.days, wins: b.wins, adult: b.adult, rules: b.rules, idPhotoId: b.idPhotoId, photoId: b.photoId, tagline: b.tagline })
      .then((ok) => { setBusy(false); if (ok) setDone(true); });
  };

  if (done) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.sun, alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 28, paddingBottom: 40, gap: 12 }}>
        <Enter kind="pop" style={{ width: 96, height: 96, marginBottom: 16, borderRadius: 32, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="hourglass" size={40} color={colors.sun} />
        </Enter>
        <H size={28} ls={-0.03}>Profile submitted</H>
        <Txt size={15} lh={1.55} color={colors.gray800} align="center">We’ll review it and let you know, usually within 1–3 working days. Meanwhile you can explore companion mode; it isn’t public yet.</Txt>
        <View style={{ width: '100%', gap: 6, marginTop: 20 }}>
          <PrimaryButton label="Open companion mode" onPress={toCompanionMode} />
          <View style={{ alignItems: 'center' }}><TextButton label="Back to profile" size={15} onPress={() => router.back()} style={{ paddingVertical: 12 }} /></View>
        </View>
      </View>
    );
  }

  if (step === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.sun }}>
        <StatusBar style="light" />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}>
          <View style={{ height: 330, backgroundColor: colors.ink, overflow: 'hidden' }}>
            <Stripes hue={290} l={[0.42, 0.39]} c={[0.12, 0.12]} style={{ opacity: 0.55 }} />
            <Txt kind="mono" size={10} weight={500} color="rgba(255,255,255,.55)" style={{ position: 'absolute', top: 110, right: 20 }}>editorial · two friends, museum steps</Txt>
            <LinearGradient colors={['rgba(23,21,43,.2)', colors.ink]} locations={[0, 0.92]} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
            <CircleButton icon="x" label="Close" iconSize={19} border={0} bg="rgba(255,255,255,.14)" color={colors.white} onPress={() => router.back()} style={{ position: 'absolute', top, left: 16 }} />
            <View style={{ position: 'absolute', left: 20, right: 20, bottom: 24, gap: 10 }}>
              <Txt kind="mono" size={11} weight={600} ls={0.08} color={colors.sun}>BECOME A COMPANION</Txt>
              <H size={32} lh={1.08} ls={-0.035} color={colors.white}>Share your time, on your terms.</H>
              <Txt size={15} lh={1.5} color="rgba(255,255,255,.75)">Offer the activities you already enjoy to people who’d like good company.</Txt>
            </View>
          </View>
          <View style={{ paddingTop: 24, paddingHorizontal: 20 }}>
            <Txt size={17} weight={700} style={{ marginBottom: 6 }}>How it works</Txt>
            {HOW.map(([icon, t, d]) => (
              <Row key={t} style={{ gap: 14, paddingVertical: 14, borderBottomWidth: 2, borderBottomColor: colors.ink, alignItems: 'flex-start' }}>
                <IconTile icon={icon} />
                <View style={{ flex: 1 }}>
                  <Txt size={15} weight={600}>{t}</Txt>
                  <Txt size={13} lh={1.45} color={colors.gray600} style={{ marginTop: 2 }}>{d}</Txt>
                </View>
              </Row>
            ))}
            <Box shadow={3} style={{ marginTop: 18, padding: 16, borderRadius: 16, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, gap: 8 }}>
              {[['eye-off', 'Profiles are reviewed before they appear publicly.'], ['info', 'Earnings depend on bookings and are not guaranteed.'], ['shield-check', '18+ only. ID verification is required.']].map(([icon, t]) => (
                <Row key={t} style={{ gap: 8, alignItems: 'flex-start' }}>
                  <Icon name={icon} size={16} />
                  <Txt size={13} lh={1.5} color={colors.gray800} style={{ flex: 1 }}>{t}</Txt>
                </Row>
              ))}
            </Box>
          </View>
        </ScrollView>
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 14, paddingHorizontal: 20, paddingBottom: footPad, backgroundColor: 'rgba(250,249,255,.96)', borderTopWidth: 2, borderTopColor: colors.ink }}>
          <PrimaryButton label="Create companion profile" onPress={() => setStep(1)} />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.sun }}>
      <Row style={{ paddingTop: top, paddingHorizontal: 16, gap: 10 }}>
        <CircleButton icon="chevron-left" label="Back" onPress={() => setStep(step - 1)} />
        <View style={{ flex: 1 }}>
          <Txt size={16} weight={700}>Become a Companion</Txt>
          <Txt size={12} color={colors.gray600}>Step {step} of 5 · {CSTEPS[step - 1]}</Txt>
        </View>
        <CircleButton icon="x" label="Close" iconSize={19} onPress={() => router.back()} />
      </Row>
      <Row style={{ gap: 4, paddingTop: 16, paddingHorizontal: 20 }}>
        {CSTEPS.map((_, i) => <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < step ? colors.ink : colors.track }} />)}
      </Row>
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingTop: 24 }}>
        {step === 1 && (
          <>
            <StepTitle title="Introduce yourself" />
            <Row style={{ gap: 14, marginBottom: 18 }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Add profile photo" onPress={() => void upload('companion', 'library')} style={{ width: 96, height: 120, borderRadius: 20, borderWidth: 2, borderColor: colors.ink, borderStyle: b.photoUrl ? 'solid' : 'dashed', backgroundColor: colors.white, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                {b.photoUrl ? <Photo hue={0} url={b.photoUrl} /> : <Icon name={uploading === 'photo' ? 'hourglass' : 'image-plus'} size={26} />}
              </Pressable>
              <View style={{ flex: 1, gap: 4 }}>
                <Txt size={14} weight={700}>Profile photo</Txt>
                <Txt size={12} lh={1.45} color={colors.gray600}>A clear, friendly photo of you. Profiles with a photo get far more requests.</Txt>
                <TextButton label={b.photoUrl ? 'Change photo' : 'Choose a photo'} size={13} onPress={() => void upload('companion', 'library')} />
              </View>
            </Row>
            <Label>Display name</Label>
            <Box shadow={3} style={{ borderRadius: 14 }}>
              <TextInput value={b.name} onChangeText={(t) => upd({ name: t })} accessibilityLabel="Display name" style={[font('body'), input, { height: 52, borderWidth: 2 }]} />
            </Box>
            <Box shadow={3} style={{ marginTop: 16, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Txt size={14} weight={600}>Show my age</Txt>
                <Txt size={12} color={colors.gray600}>You can hide it at any time.</Txt>
              </View>
              <Toggle on={b.showAge} label="Show my age" onPress={() => upd({ showAge: !b.showAge })} />
            </Box>
            <Row style={{ justifyContent: 'space-between', marginTop: 18, marginBottom: 6 }}>
              <Txt size={13} weight={600}>About you</Txt>
              <TextButton label="Use an example" size={12} onPress={() => upd({ about: 'Illustrator and long-time Neukölln local. I like slow museum visits, trying new cafés and helping people settle into the city.', aboutErr: false, interests: b.interests.length ? b.interests : ['Art', 'Coffee', 'Design'] })} />
            </Row>
            <TextInput
              value={b.about}
              onChangeText={(t) => upd({ about: t.slice(0, 400), aboutErr: false })}
              accessibilityLabel="About you"
              placeholder={t("What you enjoy, what you’re like to spend time with, what you can show people…")}
              placeholderTextColor={colors.gray400}
              multiline
              textAlignVertical="top"
              style={[font('body'), input, { height: 130, paddingTop: 14, borderWidth: 1.5, borderColor: b.aboutErr ? colors.red : colors.ink, fontSize: 15, lineHeight: 22 }]}
            />
            <Row style={{ justifyContent: 'space-between', marginTop: 6 }}>
              {b.aboutErr ? <Txt size={12} color={colors.red}>Write at least 40 characters.</Txt> : <View />}
              <Txt size={12} color={colors.gray600}>{b.about.length}/400</Txt>
            </Row>
            <Label style={{ marginTop: 18, marginBottom: 8 }}>Interests</Label>
            <Wrap>{INTERESTS.map((i) => <Chip key={i} label={i} on={b.interests.includes(i)} onPress={() => upd({ interests: toggleIn(b.interests, i) })} />)}</Wrap>
          </>
        )}

        {step === 2 && (
          <>
            <StepTitle title="What will you offer?" sub="Everything stays non-sexual and in public. Pick at least one." />
            <Wrap>{A.map((a) => <Chip key={a.id} label={a.label} icon={a.icon} iconSize={16} height={40} size={14} padL={12} padR={15} on={b.acts.includes(a.id)} onPress={() => upd({ acts: toggleIn(b.acts, a.id) })} />)}</Wrap>
            <Txt size={15} weight={700} style={{ marginTop: 26, marginBottom: 4 }}>Your boundaries</Txt>
            <Txt size={13} color={colors.gray600} style={{ marginBottom: 10 }}>What you’re comfortable with on date-style bookings. Kissing, intimacy and private locations are never allowed.</Txt>
            <Wrap>{OKOPTS.map((o) => <Chip key={o} label={o} height={38} size={14} padL={15} padR={15} on={b.ok.includes(o)} onPress={() => upd({ ok: toggleIn(b.ok, o) })} />)}</Wrap>
            <Txt size={15} weight={700} style={{ marginTop: 26, marginBottom: 10 }}>Languages you speak</Txt>
            <Wrap>{LANGS.map((l) => <Chip key={l} label={l} height={38} size={14} padL={15} padR={15} on={b.langs.includes(l)} onPress={() => upd({ langs: toggleIn(b.langs, l) })} />)}</Wrap>
          </>
        )}

        {step === 3 && (
          <>
            <StepTitle title="Rate and availability" />
            <RateStepper rate={b.rate} onChange={(rate) => upd({ rate })} />
            <Txt size={12} lh={1.5} color={colors.gray600} style={{ marginTop: 10 }}>Customers see your rate plus a separate 10% service fee. You can change it later.</Txt>
            <Txt size={15} weight={700} style={{ marginTop: 24, marginBottom: 10 }}>Days</Txt>
            <Row style={{ gap: 6 }}>{WEEK.map((d) => <Chip key={d} label={d} height={44} radius={12} weight={600} padL={0} padR={0} style={{ flex: 1 }} on={b.days.includes(d)} onPress={() => upd({ days: toggleIn(b.days, d) })} />)}</Row>
            <Txt size={15} weight={700} style={{ marginTop: 20, marginBottom: 10 }}>Times of day</Txt>
            <Row style={{ gap: 8 }}>{WIN.map(([k, l]) => <Chip key={k} label={l} height={44} radius={12} weight={600} style={{ flex: 1 }} on={b.wins.includes(k)} onPress={() => upd({ wins: toggleIn(b.wins, k) })} />)}</Row>
          </>
        )}

        {step === 4 && (
          <>
            <StepTitle title="Verification" sub="Required before your profile goes live." />
            <View style={{ gap: 10 }}>
              <Box shadow={4} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink }}>
                <IconTile icon="scan-face" iconSize={19} />
                <View style={{ flex: 1 }}>
                  <Txt size={15} weight={600}>Verify your identity</Txt>
                  <Txt size={12} lh={1.4} color={colors.gray600} style={{ marginTop: 2 }}>A selfie holding your ID card or passport next to your face. Only our review team sees it, and it’s deleted after the check.</Txt>
                </View>
                {b.idv ? (
                  <View style={{ height: 26, paddingHorizontal: 10, borderRadius: 999, backgroundColor: colors.greenSoft, justifyContent: 'center' }}><Txt size={12} weight={600} color={colors.greenDeep}>Uploaded</Txt></View>
                ) : (
                  <Pressable accessibilityRole="button" disabled={uploading === 'id'} onPress={() => void upload('id', Platform.OS === 'web' ? 'library' : 'camera')} style={{ height: 36, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.ink, justifyContent: 'center', opacity: uploading === 'id' ? 0.5 : 1 }}>
                    <Txt size={13} weight={600} color={colors.white}>{uploading === 'id' ? 'Uploading…' : 'Take photo'}</Txt>
                  </Pressable>
                )}
              </Box>
              {([['adult', 'I’m 18 or older', 'ZeitMit is for adults only.'], ['rules', 'I’ll keep every booking non-sexual and in public', 'As set out in the Community Guidelines.']] as const).map(([k, t, d]) => (
                <Box key={k} shadow={4} style={{ borderRadius: 18 }}>
                  <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: b[k] }} onPress={() => upd({ [k]: !b[k] })} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink }}>
                    <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: b[k] ? colors.ink : colors.white, alignItems: 'center', justifyContent: 'center' }}>
                      {b[k] ? <Icon name="check" size={15} color={colors.white} /> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Txt size={15} weight={600}>{t}</Txt>
                      <Txt size={12} color={colors.gray600} style={{ marginTop: 2 }}>{d}</Txt>
                    </View>
                  </Pressable>
                </Box>
              ))}
            </View>
            <Txt size={12} lh={1.5} color={colors.gray600} style={{ marginTop: 16 }}>Documents are handled by the verification partner and are never shown on your profile.</Txt>
          </>
        )}

        {step === 5 && (
          <>
            <StepTitle title="Review and submit" />
            <Box shadow={4} style={{ backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, borderRadius: 20, paddingVertical: 4, paddingHorizontal: 16 }}>
              {[
                ['Name · age', `${b.name} · ${b.showAge ? 'Shown' : 'Hidden'}`],
                ['About', b.about],
                ['Interests', b.interests.join(', ') || '—'],
                ['Activities', b.acts.map((a) => AM[a].label).join(', ') || '—'],
                ['Languages', b.langs.join(', ') || '—'],
                ['Rate', `${eur(b.rate)} / hour`],
                ['Availability', (b.days.join(', ') || '—') + (b.wins.length ? ' · ' + WIN.filter((w) => b.wins.includes(w[0])).map((w) => w[1]).join(', ') : '')],
              ].map(([l, v], i, arr) => (
                <View key={l} style={{ paddingVertical: 12, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: colors.hairline }}>
                  <Txt size={12} color={colors.gray600}>{l}</Txt>
                  <Txt size={14} lh={1.5}>{v}</Txt>
                </View>
              ))}
            </Box>
            <Row style={{ marginTop: 14, gap: 10, padding: 16, borderRadius: 16, backgroundColor: colors.lilac, alignItems: 'flex-start' }}>
              <Icon name="eye-off" size={16} />
              <Txt size={13} lh={1.5} color={colors.gray800} style={{ flex: 1 }}>Your profile will be reviewed before it appears publicly. This usually takes 1–3 working days.</Txt>
            </Row>
          </>
        )}
      </ScrollView>
      <View style={{ paddingTop: 14, paddingHorizontal: 20, paddingBottom: footPad, backgroundColor: colors.white, borderTopWidth: 2, borderTopColor: colors.ink }}>
        <PrimaryButton label={step === 5 ? 'Submit for review' : 'Continue'} onPress={next} style={{ opacity: valid ? 1 : 0.4 }} />
      </View>
    </KeyboardAvoidingView>
  );
}

const input = { paddingHorizontal: 16, borderRadius: 14, borderColor: colors.ink, backgroundColor: colors.white, fontSize: 16, color: colors.ink, outlineStyle: 'none' } as object;
const Label = ({ children, style }: { children: string; style?: object }) => <Txt size={13} weight={600} style={[{ marginBottom: 6 }, style]}>{children}</Txt>;
const Wrap = ({ children }: { children: React.ReactNode }) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>;

/** −  €28 / hour  + stepper used by onboarding and the companion listing. */
export function RateStepper({ rate, onChange, bare }: { rate: number; onChange: (r: number) => void; bare?: boolean }) {
  return (
    <Box shadow={bare ? 0 : 4} style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, !bare && { padding: 18, borderRadius: 20, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink }]}>
      <SecondaryButton accessibilityLabel="Lower rate" icon="minus" iconSize={18} height={48} style={{ width: 48, paddingHorizontal: 0 }} onPress={() => onChange(Math.max(15, rate - 1))} />
      <Txt size={15} color={colors.gray600}><H size={34} weight={700} ls={-0.03}>{eur(rate)}</H> / hour</Txt>
      <SecondaryButton accessibilityLabel="Raise rate" icon="plus" iconSize={18} height={48} style={{ width: 48, paddingHorizontal: 0 }} onPress={() => onChange(Math.min(80, rate + 1))} />
    </Box>
  );
}
