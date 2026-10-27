import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font } from '../theme';
import { AM, BSTEPS, CM, DAYS, dayOpen, eur, hours, isOpen, NO, ROM, TIMES, type ActId } from '../data';
import { useStore } from '../store';
import { toBookings } from '../nav';
import { Icon } from '../ui/Icon';
import { Box, Enter, H, Ring, Row, Stripes, Txt } from '../ui/primitives';
import { CircleButton, PrimaryButton, TextButton, useTopPad } from '../ui/common';

type Draft = { act: ActId | null; day: number | null; time: string | null; dur: number | null; place: string; note: string; placeErr: boolean; agree: boolean };

export default function BookingFlow() {
  const params = useLocalSearchParams<{ cid: string; day?: string }>();
  const c = CM[params.cid];
  const top = useTopPad();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(1);
  const [done, setDone] = useState(false);
  const [b, setB] = useState<Draft>({ act: null, day: params.day != null ? Number(params.day) : null, time: null, dur: null, place: '', note: '', placeErr: false, agree: false });
  const upd = (o: Partial<Draft>) => setB((x) => ({ ...x, ...o }));
  if (!c) return null;

  const sub = b.dur ? c.rate * b.dur : 0;
  const fee = Math.round(sub * 10) / 100;
  const total = b.dur ? eur(sub + fee) : '—';
  const isDateAct = !!b.act && ROM.includes(b.act);
  const valid = [!!b.act, b.day != null && !!b.time, !!b.dur, true, true, !isDateAct || b.agree][step - 1];

  const next = () => {
    if (!valid) return;
    if (step === 4 && !b.place.trim()) return upd({ placeErr: true });
    if (step < 6) return setStep(step + 1);
    useStore.getState().addBooking({ cid: c.id, act: b.act!, day: b.day!, time: b.time!, dur: b.dur!, place: b.place });
    setDone(true);
  };
  const back = () => (step > 1 ? setStep(step - 1) : router.back());
  const close = () => router.back();
  const dayLabel = b.day != null ? DAYS[b.day].full : '—';
  const durLabel = b.dur ? hours(b.dur) : '—';
  const actLabel = b.act ? AM[b.act].label : '—';

  if (done) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.sun, alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 28, paddingBottom: 40, gap: 12 }}>
        <View style={{ width: 100, height: 100, marginBottom: 16, alignItems: 'center', justifyContent: 'center' }}>
          <Ring size={100} color={colors.ink} />
          <Enter kind="pop" style={{ width: 100, height: 100, borderRadius: 50, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="send" size={40} color={colors.white} />
          </Enter>
        </View>
        <H size={28} ls={-0.03} align="center">Paid & request sent</H>
        <Txt size={15} lh={1.55} color={colors.gray800} align="center">
          You paid {total}. ZeitMit holds it safely until you meet. If {c.name} declines, you get a full refund. When you meet, share your meet code and the money is released.
        </Txt>
        <Box shadow={4} style={{ width: '100%', marginTop: 12, padding: 16, borderRadius: 18, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 48, height: 48, borderRadius: 14, overflow: 'hidden' }}><Stripes hue={c.hue} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt size={15} weight={700}>{actLabel} · {durLabel}</Txt>
            <Txt size={13} color={colors.gray600}>{dayLabel} · {b.time}</Txt>
          </View>
          <Txt size={15} weight={700}>{total}</Txt>
        </Box>
        <Txt size={12} color={colors.gray600}>Free cancellation up to 24 hours before.</Txt>
        <View style={{ width: '100%', gap: 6, marginTop: 16 }}>
          <PrimaryButton label="View in Bookings" onPress={() => toBookings('pending')} />
          <View style={{ alignItems: 'center' }}>
            <TextButton label="Back to Discover" size={15} onPress={() => router.dismissTo('/')} style={{ paddingVertical: 12 }} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.sun }}>
      <Row style={{ paddingTop: top, paddingHorizontal: 16, gap: 10 }}>
        <CircleButton icon="chevron-left" label="Back" onPress={back} />
        <Row style={{ flex: 1, gap: 10, minWidth: 0 }}>
          <View style={{ width: 36, height: 36, borderRadius: 12, overflow: 'hidden' }}><Stripes hue={c.hue} /></View>
          <View style={{ minWidth: 0, flex: 1 }}>
            <Txt size={16} weight={700}>Book {c.name}</Txt>
            <Txt size={12} color={colors.gray600} numberOfLines={1}>Step {step} of 6 · {BSTEPS[step - 1]}</Txt>
          </View>
        </Row>
        <CircleButton icon="x" label="Close" iconSize={19} onPress={close} />
      </Row>
      <Row style={{ gap: 4, paddingTop: 16, paddingHorizontal: 20 }}>
        {BSTEPS.map((_, i) => <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < step ? colors.ink : colors.track }} />)}
      </Row>

      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingTop: 24 }}>
        {step === 1 && (
          <>
            <StepTitle title="What would you like to do?" sub={`${c.name} offers these activities.`} />
            <View style={{ gap: 10 }}>
              {c.acts.map((a) => {
                const on = b.act === a;
                return (
                  <Pressable key={a} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => upd({ act: a })} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: on ? colors.butter : colors.white }}>
                    <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: colors.blush, alignItems: 'center', justifyContent: 'center' }}><Icon name={AM[a].icon} size={20} /></View>
                    <View style={{ flex: 1 }}>
                      <Txt size={16} weight={600}>{AM[a].label}</Txt>
                      <Txt size={13} color={colors.gray600} style={{ marginTop: 2 }}>{AM[a].desc}</Txt>
                    </View>
                    <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: on ? 6 : 2, borderColor: colors.ink }} />
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        {step === 2 && (
          <>
            <StepTitle title="Pick a day and time" sub="Times are in Berlin time." />
            <Row style={{ gap: 6 }}>
              {DAYS.map((d) => {
                const open = dayOpen(c.id, d.i);
                const on = b.day === d.i;
                return (
                  <Pressable key={d.i} accessibilityRole="button" accessibilityLabel={d.full} accessibilityState={{ selected: on, disabled: !open }} onPress={() => open && upd({ day: d.i, time: null })} style={{ flex: 1, alignItems: 'center', gap: 4, paddingTop: 10, paddingBottom: 8, borderRadius: 14, borderWidth: 1, borderColor: colors.ink, backgroundColor: on ? colors.ink : open ? colors.white : 'transparent' }}>
                    <Txt size={11} weight={500} color={on ? colors.white : open ? colors.ink : colors.gray400} numberOfLines={1}>{d.label}</Txt>
                    <Txt size={18} weight={700} color={on ? colors.white : open ? colors.ink : colors.gray400}>{d.n}</Txt>
                    <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: open ? (on ? colors.sun : colors.green) : 'transparent' }} />
                  </Pressable>
                );
              })}
            </Row>
            {b.day != null ? (
              <>
                <Txt size={14} weight={600} style={{ marginTop: 24, marginBottom: 10 }}>Available times</Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {TIMES.map((t, ti) => {
                    const open = isOpen(c.id, b.day!, ti);
                    const on = b.time === t;
                    return (
                      <Pressable key={t} accessibilityRole="button" accessibilityState={{ selected: on, disabled: !open }} onPress={() => open && upd({ time: t })} style={{ width: '22.5%', flexGrow: 1, height: 46, borderRadius: 12, borderWidth: 1, borderColor: on || open ? colors.ink : colors.butter, backgroundColor: on ? colors.ink : open ? colors.white : colors.butter, alignItems: 'center', justifyContent: 'center' }}>
                        <Txt size={14} weight={600} color={on ? colors.white : open ? colors.ink : colors.gray350} style={!open ? { textDecorationLine: 'line-through' } : null}>{t}</Txt>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : (
              <View style={{ marginTop: 24, padding: 18, borderRadius: 16, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.ink }}>
                <Txt size={14} color={colors.gray600} align="center">Choose a day with a green dot to see times.</Txt>
              </View>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <StepTitle title="How long?" sub={`${eur(c.rate)} per hour. Minimum one hour.`} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {[1, 2, 3, 4].map((d) => {
                const on = b.dur === d;
                return (
                  <Pressable key={d} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => upd({ dur: d })} style={{ width: '47%', flexGrow: 1, gap: 6, padding: 18, borderRadius: 18, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: on ? colors.butter : colors.white }}>
                    <Txt size={17} weight={700}>{hours(d)}</Txt>
                    <Txt size={14} color={on ? colors.ink : colors.gray600}>{eur(c.rate * d)}</Txt>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        {step === 4 && (
          <>
            <StepTitle title="Where will you meet?" sub="A café, park entrance or public venue." />
            <Row style={{ height: 54, gap: 10, paddingHorizontal: 16, borderRadius: 16, backgroundColor: colors.white, borderWidth: 1.5, borderColor: b.placeErr ? colors.red : colors.ink }}>
              <Icon name="map-pin" size={18} color={colors.gray600} />
              <TextInput value={b.place} onChangeText={(t) => upd({ place: t, placeErr: false })} accessibilityLabel="Meeting place" placeholder="e.g. Café at Paul-Lincke-Ufer" placeholderTextColor={colors.gray400} style={[font('body'), inputReset, { flex: 1, fontSize: 16 }]} />
            </Row>
            {b.placeErr ? (
              <Row style={{ gap: 6, marginTop: 8 }}>
                <Icon name="circle-alert" size={14} color={colors.red} />
                <Txt size={13} color={colors.red}>Add a public meeting place to continue.</Txt>
              </Row>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
              {['A café in ' + c.area, c.area + ' U-Bahn station exit', 'Museum or gallery lobby'].map((t) => (
                <Pressable key={t} accessibilityRole="button" onPress={() => upd({ place: t, placeErr: false })} style={pill}><Txt size={13}>{t}</Txt></Pressable>
              ))}
            </View>
            <Row style={{ marginTop: 22, gap: 12, padding: 16, borderRadius: 16, backgroundColor: colors.lilac, alignItems: 'flex-start' }}>
              <Icon name="shield-check" size={18} />
              <Txt size={13} lh={1.5} color={colors.gray800} style={{ flex: 1 }}>Choose a public place. ZeitMit never asks for your home address, and {c.name} only sees this once they accept.</Txt>
            </Row>
          </>
        )}

        {step === 5 && (
          <>
            <StepTitle title="Add a note" sub="Optional. Share what you have in mind." />
            <Box shadow={3} style={{ borderRadius: 16 }}>
              <TextInput
                value={b.note}
                onChangeText={(t) => upd({ note: t.slice(0, 240) })}
                accessibilityLabel="Note"
                placeholder={`Hi ${c.name}, I’d love to…`}
                placeholderTextColor={colors.gray400}
                multiline
                textAlignVertical="top"
                style={[font('body'), inputReset, { height: 150, padding: 16, borderRadius: 16, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.white, fontSize: 15, lineHeight: 22 }]}
              />
            </Box>
            <Txt size={12} color={colors.gray600} align="right" style={{ marginTop: 6 }}>{b.note.length}/240</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              {['First time doing this', 'Practising my German', 'Happy to follow your lead'].map((t) => (
                <Pressable key={t} accessibilityRole="button" onPress={() => upd({ note: ((b.note ? b.note + ' ' : '') + t + '.').slice(0, 240) })} style={[pill, { flexDirection: 'row', alignItems: 'center', gap: 5 }]}>
                  <Icon name="plus" size={13} color={colors.gray600} />
                  <Txt size={13}>{t}</Txt>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {step === 6 && (
          <>
            <H size={25} ls={-0.03} style={{ marginBottom: 18 }}>Review your request</H>
            <Box shadow={4} style={{ backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, borderRadius: 20, paddingVertical: 4, paddingHorizontal: 16 }}>
              <ReviewRow icon="sparkles" label="Activity" value={actLabel} onEdit={() => setStep(1)} />
              <ReviewRow icon="calendar" label="When" value={`${dayLabel} · ${b.time}`} onEdit={() => setStep(2)} />
              <ReviewRow icon="clock" label="Duration" value={durLabel} onEdit={() => setStep(3)} />
              <ReviewRow icon="map-pin" label="Meeting place" value={b.place || '—'} onEdit={() => setStep(4)} />
              <ReviewRow icon="message-square-text" label="Note" value={b.note || 'No note added'} onEdit={() => setStep(5)} last />
            </Box>
            <Box shadow={4} style={{ marginTop: 14, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, borderRadius: 20, padding: 16, gap: 10 }}>
              <PriceRow l="Hourly rate" r={eur(c.rate)} />
              <PriceRow l={`${eur(c.rate)} × ${b.dur || 0} h`} r={eur(sub)} />
              <PriceRow l="Service fee (10%)" r={eur(fee)} />
              <View style={{ height: 1, backgroundColor: colors.ink }} />
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt size={16} weight={700}>Total payable</Txt>
                <Txt size={16} weight={700}>{total}</Txt>
              </Row>
            </Box>
            {isDateAct ? (
              <View style={{ marginTop: 14, padding: 16, borderRadius: 18, backgroundColor: colors.blush, gap: 10 }}>
                <Row style={{ gap: 6 }}>
                  <Icon name="heart" size={15} />
                  <Txt size={14} weight={700}>{c.name}’s boundaries</Txt>
                </Row>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {c.ok.map((o) => <BoundaryChip key={o} label={o} icon="check" color={colors.greenDeep} />)}
                  {NO.map((o) => <BoundaryChip key={o} label={o} icon="x" color={colors.redDeep} />)}
                </View>
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: b.agree }} onPress={() => upd({ agree: !b.agree })} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 4 }}>
                  <View style={{ width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: b.agree ? colors.roseDeep : colors.ink, backgroundColor: b.agree ? colors.roseDeep : colors.white, alignItems: 'center', justifyContent: 'center' }}>
                    {b.agree ? <Icon name="check" size={14} color={colors.white} /> : null}
                  </View>
                  <Txt size={13} weight={600}>I’ll respect these boundaries</Txt>
                </Pressable>
              </View>
            ) : null}
            <View style={{ marginTop: 14, gap: 8, padding: 16, borderRadius: 16, backgroundColor: colors.lilac }}>
              <Txt size={14} weight={700}>How payment works</Txt>
              <Row style={{ gap: 4, alignItems: 'flex-start' }}>
                <FlowStep icon="user" bg={colors.white} label={'You pay\nnow'} />
                <Icon name="arrow-right" size={16} style={{ marginTop: 14 }} />
                <FlowStep icon="lock" bg={colors.sun} label={'ZeitMit\nholds it'} />
                <Icon name="arrow-right" size={16} style={{ marginTop: 14 }} />
                <FlowStep icon="key-round" bg={colors.mint} label={`${c.name} gets it\nwith your code`} />
              </Row>
              <Row style={{ gap: 8, alignItems: 'flex-start' }}>
                <Icon name="rotate-ccw" size={16} style={{ marginTop: 2 }} />
                <Txt size={13} lh={1.5} color={colors.gray800} style={{ flex: 1 }}>Full refund if {c.name} declines, or if you cancel 24+ hours before.</Txt>
              </Row>
            </View>
          </>
        )}
      </ScrollView>

      <Row style={{ paddingTop: 14, paddingHorizontal: 20, paddingBottom: Math.max(30, insets.bottom + 8), backgroundColor: colors.white, borderTopWidth: 2, borderTopColor: colors.ink, gap: 14 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={12} color={colors.gray600}>{b.dur ? 'Total incl. fees' : 'Select a duration'}</Txt>
          <H size={21} ls={-0.02}>{total}</H>
        </View>
        <PrimaryButton label={step === 6 ? 'Pay & send request' : 'Continue'} dim={!valid} onPress={next} style={{ paddingHorizontal: 24 }} />
      </Row>
    </KeyboardAvoidingView>
  );
}

const inputReset = { paddingVertical: 0, color: colors.ink, outlineStyle: 'none' } as object;
const pill = { height: 34, paddingHorizontal: 12, borderRadius: 999, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.white, justifyContent: 'center' as const };

export function StepTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <>
      <H size={25} ls={-0.03} style={{ marginBottom: sub ? 6 : 18 }}>{title}</H>
      {sub ? <Txt size={14} color={colors.gray600} style={{ marginBottom: 18 }}>{sub}</Txt> : null}
    </>
  );
}

function ReviewRow({ icon, label, value, onEdit, last }: { icon: string; label: string; value: string; onEdit: () => void; last?: boolean }) {
  return (
    <Row style={{ gap: 12, paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.hairline }}>
      <Icon name={icon} size={17} color={colors.gray600} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={14} color={colors.gray600}>{label}</Txt>
        <Txt size={14}>{value}</Txt>
      </View>
      <TextButton label="Edit" size={13} onPress={onEdit} />
    </Row>
  );
}

const PriceRow = ({ l, r }: { l: string; r: string }) => (
  <Row style={{ justifyContent: 'space-between' }}>
    <Txt size={14} color={colors.gray600}>{l}</Txt>
    <Txt size={14}>{r}</Txt>
  </Row>
);

const BoundaryChip = ({ label, icon, color }: { label: string; icon: string; color: string }) => (
  <Row style={{ height: 26, paddingHorizontal: 10, borderRadius: 999, backgroundColor: colors.white, gap: 4 }}>
    <Icon name={icon} size={12} color={color} />
    <Txt size={12} color={color}>{label}</Txt>
  </Row>
);

function FlowStep({ icon, bg, label }: { icon: string; bg: string; label: ReactNode }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 6 }}>
      <View style={{ width: 44, height: 44, borderRadius: 14, borderWidth: 2, borderColor: colors.ink, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={20} />
      </View>
      <Txt size={11} weight={700} lh={1.25} align="center">{label}</Txt>
    </View>
  );
}
