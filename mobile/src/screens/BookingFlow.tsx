import { useEffect, useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font } from '../theme';
import { AM, BSTEPS, eur, hours, NO, ROM, slotDay, type ActId } from '../data';
import { fitAt, useSlots } from '../lib/slots';

const TIMES = ['09:30', '11:00', '12:30', '14:00', '15:30', '17:00', '18:30', '20:00'];
import { useStore } from '../store';
import { toBookings } from '../nav';
import { Icon } from '../ui/Icon';
import { Box, Confetti, Enter, H, Ring, Row, Stripes, Txt, Photo } from '../ui/primitives';
import { CircleButton, PrimaryButton, TextButton, useTopPad } from '../ui/common';
import { t } from '../i18n';

type Draft = { act: ActId | null; date: string | null; time: string | null; dur: number | null; place: string; note: string; placeErr: boolean; agree: boolean };

export default function BookingFlow() {
  const params = useLocalSearchParams<{ cid: string; date?: string }>();
  const c = useStore((s) => s.byId[params.cid]);
  // Open times update live while you book: someone else's booking or cancellation shows up at once.
  const { slots: liveSlots, reload } = useSlots(params.cid);
  const slots = liveSlots ?? [];
  const [busy, setBusy] = useState(false);
  const top = useTopPad();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(1);
  const [done, setDone] = useState(false);
  const [b, setB] = useState<Draft>({ act: null, date: params.date ?? null, time: null, dur: null, place: '', note: '', placeErr: false, agree: false });
  const upd = (o: Partial<Draft>) => setB((x) => ({ ...x, ...o }));
  const di = slots.findIndex((s) => s.date === b.date);
  const day = di >= 0 ? slots[di] : undefined;
  const fit = fitAt(day, b.time);

  // A checkout left unpaid earlier (and not released then) would keep this time from showing as free.
  useEffect(() => {
    if (useStore.getState().pendingCheckout?.cid === params.cid) void useStore.getState().releaseCheckout().then(() => reload());
  }, [params.cid, reload]);

  // Someone else just booked the picked time, or the companion changed their availability: say so and step back.
  // Quiet while your own payment runs (your booking holds the time) and just after it, until the hold is released.
  const quiet = useRef(0);
  const lost = !!liveSlots && !!b.time && !busy && !done && (!fit || (!!b.dur && b.dur > fit));
  useEffect(() => {
    if (!lost || !c || Date.now() < quiet.current) return;
    const { showToast } = useStore.getState();
    if (!fit) {
      showToast(`${b.time} isn’t available any more. Pick another time.`);
      upd({ time: null });
      if (step > 2) setStep(2);
    } else {
      showToast(`From ${b.time}, ${c.name} is now only free for ${hours(fit)}. Pick a shorter time.`);
      upd({ dur: null });
      if (step > 3) setStep(3);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lost]);
  if (!c) return null;

  const sub = b.dur ? c.rate * b.dur : 0;
  const fee = Math.round(sub * 10) / 100;
  const credit = (useStore.getState().user?.credit ?? 0) / 100;
  const creditUse = b.dur ? Math.min(credit, sub + fee) : 0;
  const total = b.dur ? eur(sub + fee - creditUse) : '—';
  const isDateAct = !!b.act && ROM.includes(b.act);
  const valid = [!!b.act, fit > 0, !!b.dur && b.dur <= fit, true, true, !isDateAct || b.agree][step - 1];

  const next = () => {
    if (!valid) return;
    if (step === 4 && !b.place.trim()) return upd({ placeErr: true });
    if (step < 6) return setStep(step + 1);
    if (busy) return;
    setBusy(true);
    void useStore.getState()
      .addBooking({ cid: c.id, act: b.act!, date: b.date!, time: b.time!, dur: b.dur!, place: b.place, note: b.note, boundariesAgreed: b.agree })
      .then((bk) => {
        if (bk) setDone(true);
        else {
          quiet.current = Date.now() + 4000;
          void reload();
        }
        setBusy(false);
      });
  };
  const back = () => (step > 1 ? setStep(step - 1) : router.back());
  const close = () => router.back();
  const days = slots.map((s, i) => slotDay(s.date, i));
  const dayLabel = di >= 0 ? days[di].full : '—';
  const durLabel = b.dur ? hours(b.dur) : '—';
  const actLabel = b.act ? AM[b.act].label : '—';

  if (done) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.sun, alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 28, paddingBottom: 40, gap: 12 }}>
        <View style={{ width: 100, height: 100, marginBottom: 16, alignItems: 'center', justifyContent: 'center' }}>
          <Ring size={100} color={colors.pink} />
          <Confetti />
          <Enter kind="pop" style={{ width: 100, height: 100, borderRadius: 50, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
            <Enter kind="pop" delay={260}>
              <Icon name="check" size={48} color={colors.sun} />
            </Enter>
          </Enter>
        </View>
        <Enter kind="rise" delay={320}><H size={28} ls={-0.03} align="center">Paid & request sent</H></Enter>
        <Enter kind="rise" delay={420}>
          <Txt size={15} lh={1.55} color={colors.gray800} align="center">
            You paid {total}. ZeitMit holds it safely until you meet. If {c.name} declines, you get a full refund. When you meet, share your meet code and the money is released.
          </Txt>
        </Enter>
        <Enter kind="rise" delay={540} style={{ width: '100%' }}>
        <Box shadow={4} style={{ width: '100%', marginTop: 12, padding: 16, borderRadius: 18, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 48, height: 48, borderRadius: 14, overflow: 'hidden' }}><Photo hue={c.hue} url={c.photoUrl} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt size={15} weight={700}>{actLabel} · {durLabel}</Txt>
            <Txt size={13} color={colors.gray600}>{dayLabel} · {b.time}</Txt>
          </View>
          <Txt size={15} weight={700}>{total}</Txt>
        </Box>
        </Enter>
        <Enter kind="fade" delay={700}><Txt size={12} color={colors.gray600}>Free cancellation up to 24 hours before.</Txt></Enter>
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
          <View style={{ width: 36, height: 36, borderRadius: 12, overflow: 'hidden' }}><Photo hue={c.hue} url={c.photoUrl} /></View>
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
              {days.map((d, i) => {
                const open = slots[i].times.length > 0;
                const on = b.date === d.date;
                return (
                  <Pressable key={d.date} accessibilityRole="button" accessibilityLabel={d.full} accessibilityState={{ selected: on, disabled: !open }} onPress={() => open && upd({ date: d.date, time: null })} style={{ flex: 1, alignItems: 'center', gap: 4, paddingTop: 10, paddingBottom: 8, borderRadius: 14, borderWidth: 1, borderColor: colors.ink, backgroundColor: on ? colors.ink : open ? colors.white : 'transparent' }}>
                    <Txt size={11} weight={500} color={on ? colors.white : open ? colors.ink : colors.gray400} numberOfLines={1}>{d.label}</Txt>
                    <Txt size={18} weight={700} color={on ? colors.white : open ? colors.ink : colors.gray400}>{d.n}</Txt>
                    <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: open ? (on ? colors.sun : colors.green) : 'transparent' }} />
                  </Pressable>
                );
              })}
            </Row>
            {!slots.length ? (
              <Txt size={14} color={colors.gray600} style={{ marginTop: 24 }}>Loading availability…</Txt>
            ) : day ? (
              <>
                <Txt size={14} weight={600} style={{ marginTop: 24, marginBottom: 10 }}>Available times</Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {TIMES.map((t) => {
                    const open = day.times.includes(t);
                    const on = b.time === t;
                    return (
                      <Pressable key={t} accessibilityRole="button" accessibilityState={{ selected: on, disabled: !open }} onPress={() => open && upd({ time: t, dur: b.dur && b.dur > fitAt(day, t) ? null : b.dur })} style={{ width: '22.5%', flexGrow: 1, height: 46, borderRadius: 12, borderWidth: 1, borderColor: on || open ? colors.ink : colors.butter, backgroundColor: on ? colors.ink : open ? colors.white : colors.butter, alignItems: 'center', justifyContent: 'center' }}>
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
                const open = d <= fit; // longer would run into someone else's booking
                return (
                  <Pressable key={d} accessibilityRole="radio" accessibilityState={{ checked: on, disabled: !open }} onPress={() => open && upd({ dur: d })} style={{ width: '47%', flexGrow: 1, gap: 6, padding: 18, borderRadius: 18, borderWidth: 1.5, borderColor: open ? colors.ink : colors.butter, backgroundColor: on ? colors.butter : open ? colors.white : colors.butter }}>
                    <Txt size={17} weight={700} color={open ? colors.ink : colors.gray350} style={!open ? { textDecorationLine: 'line-through' } : null}>{hours(d)}</Txt>
                    <Txt size={14} color={!open ? colors.gray350 : on ? colors.ink : colors.gray600}>{eur(c.rate * d)}</Txt>
                  </Pressable>
                );
              })}
            </View>
            {fit > 0 && fit < 4 ? (
              <Row style={{ marginTop: 14, gap: 8, alignItems: 'flex-start' }}>
                <Icon name="clock" size={15} color={colors.gray600} style={{ marginTop: 2 }} />
                <Txt size={13} lh={1.5} color={colors.gray600} style={{ flex: 1 }}>{c.name} has another booking later, so from {b.time} you can book up to {hours(fit)}.</Txt>
              </Row>
            ) : null}
          </>
        )}

        {step === 4 && (
          <>
            <StepTitle title="Where will you meet?" sub="A café, park entrance or public venue." />
            <Row style={{ height: 54, gap: 10, paddingHorizontal: 16, borderRadius: 16, backgroundColor: colors.white, borderWidth: 1.5, borderColor: b.placeErr ? colors.red : colors.ink }}>
              <Icon name="map-pin" size={18} color={colors.gray600} />
              <TextInput value={b.place} onChangeText={(t) => upd({ place: t, placeErr: false })} accessibilityLabel="Meeting place" placeholder={t("e.g. Café at Paul-Lincke-Ufer")} placeholderTextColor={colors.gray400} style={[font('body'), inputReset, { flex: 1, fontSize: 16 }]} />
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
                placeholder={t(`Hi ${c.name}, I’d love to…`)}
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
              {creditUse ? <PriceRow l="Gift credit" r={'−' + eur(creditUse)} /> : null}
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
        <PrimaryButton label={step === 6 ? (busy ? 'Sending…' : 'Pay & send request') : 'Continue'} dim={!valid || busy} onPress={next} style={{ paddingHorizontal: 24 }} />
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
