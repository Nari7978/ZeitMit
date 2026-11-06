import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font } from '../theme';
import { AM, BSTEPS, eur, hours, isVideo, kindOf, kindsOf, MAX_HOURS, MIN_HOURS, NO, placeFor, placeOr, replyByFor, ROM, slotDay, VIDEO_GRACE_MIN, type ActId, type Kind } from '../data';
import { fitAt, nextFree, useSlots } from '../lib/slots';
import { berlinUnix, untilLabel, whenFree } from '../lib/dates';
import { useStore } from '../store';
import { goBack, toBookings } from '../nav';
import { Icon } from '../ui/Icon';
import { Box, Confetti, Enter, H, Ring, Row, Stripes, Txt, Photo } from '../ui/primitives';
import { TimeGrid } from '../ui/TimeGrid';
import { CircleButton, PrimaryButton, TextButton, Unavailable, useKeyboardShown, useTopPad } from '../ui/common';
import { t } from '../i18n';

type Draft = { act: ActId | null; date: string | null; time: string | null; dur: number | null; place: string; note: string; agree: boolean };

export default function BookingFlow() {
  const params = useLocalSearchParams<{ cid: string; date?: string; quick?: string; kind?: string }>();
  const c = useStore((s) => s.byId[params.cid]);
  const listLoaded = useStore((s) => !s.loading);
  // Open times update live while you book: someone else's booking or cancellation shows up at once.
  const { times, reload } = useSlots(c ? params.cid : undefined);
  // Video dates and in-person dates have their own hours: the link may ask for one kind (a profile's "Next free" or
  // day strip); otherwise the activity picked decides.
  const asked: Kind | null = params.kind === 'video' || params.kind === 'meet' ? params.kind : null;
  const offered = c ? kindsOf(c.acts) : [];
  const acts = c ? (asked && offered.includes(asked) ? c.acts.filter((a) => kindOf(a) === asked) : c.acts) : [];
  const [busy, setBusy] = useState(false);
  const top = useTopPad();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardShown();
  const [step, setStep] = useState(1);
  // Quick booking: the companion's next free time, booked on one page (activity, length, pay). "Pick another time"
  // switches to the step-by-step flow.
  const [quick, setQuick] = useState(params.quick === '1');
  const [done, setDone] = useState(false);
  const [b, setB] = useState<Draft>({ act: null, date: params.date ?? null, time: null, dur: null, place: '', note: '', agree: false });
  const upd = (o: Partial<Draft>) => setB((x) => ({ ...x, ...o }));
  const kind: Kind = b.act ? kindOf(b.act) : (asked && offered.includes(asked) ? asked : offered[0] ?? 'meet');
  const liveSlots = times ? times[kind] ?? [] : null;
  const slots = liveSlots ?? [];
  // Another kind of activity has other open times: the picked time goes (quietly), the day stays.
  const pickAct = (a: ActId) => upd(kindOf(a) === kind ? { act: a } : { act: a, time: null, dur: null });
  const [booked, setBooked] = useState<{ replyBy?: number } | null>(null);
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
    if (quick || !lost || !c || Date.now() < quiet.current) return;
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

  // Quick booking always holds the next free time. When someone else books it (or the companion changes their
  // hours), it moves to the next one at once, and says so.
  const free = nextFree(liveSlots);
  const shown = useRef<{ date: string; time: string } | null | undefined>(undefined);
  useEffect(() => {
    if (!quick || !liveSlots || !c || busy || done) return;
    const was = shown.current;
    if (was !== undefined && was?.date === free?.date && was?.time === free?.time) return;
    shown.current = free ? { date: free.date, time: free.time } : null;
    setB((x) => ({ ...x, date: free?.date ?? null, time: free?.time ?? null, dur: free ? Math.min(x.dur ?? 1, free.fit) : x.dur }));
    if (was && Date.now() >= quiet.current) {
      useStore.getState().showToast(free ? `${was.time} isn’t free any more. Next free: ${whenFree(free.date, free.time)}.` : `${was.time} isn’t free any more, and ${c.name} has nothing else free this week.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quick, liveSlots, free?.date, free?.time, free?.fit, busy, done, c?.id]);
  // One activity on offer (or one of the kind asked for, like video dates): it's the one.
  useEffect(() => {
    if (acts.length === 1 && !b.act) upd({ act: acts[0] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c?.id, acts.length]);
  if (!c && listLoaded) return <Unavailable title="This companion isn’t available" body="They may have paused or removed their profile." />;
  if (!c) return <View style={{ flex: 1, backgroundColor: colors.sun, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.ink} /></View>;

  const sub = b.dur ? c.rate * b.dur : 0;
  const fee = Math.round(sub * 10) / 100;
  const credit = (useStore.getState().user?.credit ?? 0) / 100;
  const creditUse = b.dur ? Math.min(credit, sub + fee) : 0;
  const total = b.dur ? eur(sub + fee - creditUse) : '—';
  const isDateAct = !!b.act && ROM.includes(b.act);
  const valid = quick
    ? !!b.act && fit > 0 && !!b.dur && b.dur <= fit && (!isDateAct || b.agree)
    : [!!b.act, fit > 0, !!b.dur && b.dur <= fit, true, true, !isDateAct || b.agree][step - 1];
  // A video date happens in the app, so it skips the meeting place.
  const video = !!b.act && isVideo(b.act);
  const order = video ? [1, 2, 3, 5, 6] : [1, 2, 3, 4, 5, 6];
  const at = order.indexOf(step);

  const next = () => {
    if (!valid) return;
    if (!quick && step < 6) return setStep(order[at + 1] ?? step + 1);
    if (busy) return;
    setBusy(true);
    void useStore.getState()
      .addBooking({ cid: c.id, act: b.act!, date: b.date!, time: b.time!, dur: b.dur!, place: b.place, note: b.note, boundariesAgreed: b.agree })
      .then((bk) => {
        if (bk) {
          setBooked({ replyBy: bk.replyBy });
          setDone(true);
        } else {
          quiet.current = Date.now() + 4000;
          void reload();
        }
        setBusy(false);
      });
  };
  const back = () => (!quick && step > 1 ? setStep(order[at - 1] ?? step - 1) : goBack());
  const close = () => goBack();
  const days = slots.map((s, i) => slotDay(s.date, i));
  const dayLabel = di >= 0 ? days[di].full : '—';
  const durLabel = b.dur ? hours(b.dur) : '—';
  // What limits the length from the picked time: midnight (bookings end by then) or the companion's next booking.
  const toMidnight = b.time ? 24 - (+b.time.slice(0, 2) + +b.time.slice(3) / 60) : 0;
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
        {/* A video date is booked at once; an in-person request waits for the companion's answer. */}
        <Enter kind="rise" delay={320}><H size={28} ls={-0.03} align="center">{video ? 'Video date booked' : 'Paid & request sent'}</H></Enter>
        <Enter kind="rise" delay={420}>
          <Txt size={15} lh={1.55} color={colors.gray800} align="center">
            {video
              ? `You paid ${total}. It’s confirmed: join from Bookings, from 10 minutes before the start. ZeitMit holds the money until you’ve been on the call together for 10 minutes.`
              : `You paid ${total}. ZeitMit holds it safely until you meet. ${c.name} has until ${untilLabel(booked?.replyBy ?? replyByFor(berlinUnix(b.date!, b.time!)))} to accept. If they decline or don’t reply in time, you get a full refund.`}
          </Txt>
        </Enter>
        <Enter kind="rise" delay={540} style={{ width: '100%' }}>
        <Box shadow={4} fit style={{ width: '100%', marginTop: 12, padding: 16, borderRadius: 18, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 48, height: 48, borderRadius: 14, overflow: 'hidden' }}><Photo hue={c.hue} url={c.photoUrl} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt size={15} weight={700}>{actLabel} · {durLabel}</Txt>
            <Txt size={13} color={colors.gray600}>{dayLabel} · {b.time}</Txt>
          </View>
          <Txt size={15} weight={700}>{total}</Txt>
        </Box>
        </Enter>
        <Enter kind="fade" delay={700}><Txt size={12} color={colors.gray600} align="center">{video ? `Free cancellation for ${VIDEO_GRACE_MIN} minutes, or up to 24 hours before.` : 'Free cancellation up to 24 hours before.'}</Txt></Enter>
        <View style={{ width: '100%', gap: 6, marginTop: 16 }}>
          <PrimaryButton label="View in Bookings" onPress={() => toBookings(video ? 'upcoming' : 'pending')} />
          <View style={{ alignItems: 'center' }}>
            <TextButton label="Back to Discover" size={15} onPress={() => router.dismissTo('/')} style={{ paddingVertical: 12 }} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.sun }}>
      <Row style={{ paddingTop: top, paddingHorizontal: 16, gap: 10 }}>
        <CircleButton icon="chevron-left" label="Back" onPress={back} />
        <Row style={{ flex: 1, gap: 10, minWidth: 0 }}>
          <View style={{ width: 36, height: 36, borderRadius: 12, overflow: 'hidden' }}><Photo hue={c.hue} url={c.photoUrl} /></View>
          <View style={{ minWidth: 0, flex: 1 }}>
            <Txt size={16} weight={700}>Book {c.name}</Txt>
            <Txt size={12} color={colors.gray600} numberOfLines={1}>{quick ? (kind === 'video' ? 'Video date' : 'Next free time') : `Step ${at + 1} of ${order.length} · ${BSTEPS[step - 1]}`}</Txt>
          </View>
        </Row>
        <CircleButton icon="x" label="Close" iconSize={19} onPress={close} />
      </Row>
      {!quick ? (
        <Row style={{ gap: 4, paddingTop: 16, paddingHorizontal: 20 }}>
          {order.map((n, i) => <View key={n} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= at ? colors.ink : colors.track }} />)}
        </Row>
      ) : null}

      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingTop: 24 }}>
        {quick && (
          <>
            <Box shadow={4} shadowColor={colors.greenDeep} style={{ padding: 18, borderRadius: 20, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.mintSoft, gap: 4 }}>
              <Row style={{ gap: 7 }}>
                <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: b.time ? colors.green : colors.gray400 }} />
                <Txt size={13} weight={600} color={colors.gray800}>{b.time ? (kind === 'video' ? 'Next free video date' : 'Next free') : !liveSlots ? 'Checking…' : 'Nothing free this week'}</Txt>
              </Row>
              {b.time && b.date ? <H size={26} ls={-0.02}>{whenFree(b.date, b.time)}</H> : null}
              <Txt size={13} lh={1.45} color={colors.gray800}>
                {b.time ? `${c.name} is free for up to ${hours(fit)} from then. Once you book it, others see the next free time.` : !liveSlots ? ' ' : 'Try again later: times free up when bookings are cancelled.'}
              </Txt>
              {b.time && b.date ? (
                <Row style={{ gap: 6, marginTop: 4, alignItems: 'flex-start' }}>
                  <Icon name={kind === 'video' ? 'zap' : 'hourglass'} size={14} color={colors.greenDeep} style={{ marginTop: 2 }} />
                  <Txt size={13} weight={600} lh={1.45} color={colors.greenDeep} style={{ flex: 1 }}>
                    {kind === 'video' ? 'Confirmed at once, no waiting.' : `${c.name} replies by ${untilLabel(replyByFor(berlinUnix(b.date, b.time)))}, or you get a full refund.`}
                  </Txt>
                </Row>
              ) : null}
            </Box>
            <Txt size={16} weight={700} style={{ marginTop: 24, marginBottom: 10 }}>What would you like to do?</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {acts.map((a) => {
                const on = b.act === a;
                return (
                  <Pressable key={a} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => pickAct(a)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 7, height: 42, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: on ? colors.ink : colors.white }}>
                    <Icon name={AM[a].icon} size={16} color={on ? colors.white : colors.ink} />
                    <Txt size={14} weight={600} color={on ? colors.white : colors.ink}>{AM[a].label}</Txt>
                  </Pressable>
                );
              })}
            </View>
            <Txt size={16} weight={700} style={{ marginTop: 24 }}>How long?</Txt>
            {fit > 0 ? <LengthStepper dur={b.dur} max={Math.min(MAX_HOURS, fit)} rate={c.rate} onChange={(d) => upd({ dur: d })} /> : null}
            {video ? (
              <Row style={{ marginTop: 16, gap: 8 }}>
                <Icon name="video" size={15} color={colors.gray600} />
                <Txt size={13} color={colors.gray600}>Video call in the app</Txt>
              </Row>
            ) : (
              <Row style={{ marginTop: 16, gap: 8 }}>
                <Icon name="map-pin" size={15} color={colors.gray600} />
                <Txt size={13} color={colors.gray600} style={{ flex: 1 }}>Agree on a public place in the chat.</Txt>
              </Row>
            )}
            {isDateAct ? <Boundaries c={c} agree={b.agree} onToggle={() => upd({ agree: !b.agree })} /> : null}
            <TextButton label="Pick another time" icon="calendar" size={14} weight={700} onPress={() => { setQuick(false); setStep(b.act ? 2 : 1); }} style={{ alignSelf: 'center', marginTop: 18 }} />
          </>
        )}
        {!quick && step === 1 && (
          <>
            <StepTitle title="What would you like to do?" sub={`${c.name} offers these activities.`} />
            <View style={{ gap: 10 }}>
              {acts.map((a) => {
                const on = b.act === a;
                return (
                  <Pressable key={a} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => pickAct(a)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: on ? colors.butter : colors.white }}>
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

        {!quick && step === 2 && (
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
                <TimeGrid times={day.times} selected={b.time} onPick={(t) => upd({ time: t, dur: b.dur && b.dur > fitAt(day, t) ? null : b.dur })} />
              </>
            ) : (
              <View style={{ marginTop: 24, padding: 18, borderRadius: 16, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.ink }}>
                <Txt size={14} color={colors.gray600} align="center">Choose a day with a green dot to see times.</Txt>
              </View>
            )}
          </>
        )}

        {!quick && step === 3 && (
          <>
            <StepTitle title="How long?" sub={`${eur(c.rate)} per hour. Book ${MIN_HOURS} to ${MAX_HOURS} hours, in half-hour steps.`} />
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
            <LengthStepper dur={b.dur} max={Math.min(MAX_HOURS, fit)} rate={c.rate} onChange={(d) => upd({ dur: d })} />
            {fit > 0 && fit < MAX_HOURS ? (
              <Row style={{ marginTop: 14, gap: 8, alignItems: 'flex-start' }}>
                <Icon name="clock" size={15} color={colors.gray600} style={{ marginTop: 2 }} />
                <Txt size={13} lh={1.5} color={colors.gray600} style={{ flex: 1 }}>
                  {fit >= toMidnight ? `Bookings end by midnight, so from ${b.time} you can book up to ${hours(fit)}.` : `${c.name} has another booking later, so from ${b.time} you can book up to ${hours(fit)}.`}
                </Txt>
              </Row>
            ) : null}
          </>
        )}

        {!quick && step === 4 && (
          <>
            <StepTitle title="Where will you meet?" sub="Optional. A café, park entrance or public venue. You can also agree on it in the chat." />
            <Row style={{ height: 54, gap: 10, paddingHorizontal: 16, borderRadius: 16, backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.ink }}>
              <Icon name="map-pin" size={18} color={colors.gray600} />
              <TextInput value={b.place} onChangeText={(t) => upd({ place: t })} accessibilityLabel="Meeting place" placeholder={t("e.g. Café at Paul-Lincke-Ufer")} placeholderTextColor={colors.gray400} style={[font('body'), inputReset, { flex: 1, fontSize: 16 }]} />
              {b.place ? <Pressable accessibilityRole="button" accessibilityLabel={t('Clear meeting place')} hitSlop={10} onPress={() => upd({ place: '' })}><Icon name="x" size={17} color={colors.gray600} /></Pressable> : null}
            </Row>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
              {['A café in ' + c.area, c.area + ' U-Bahn station exit', 'Museum or gallery lobby'].map((t) => (
                <Pressable key={t} accessibilityRole="button" onPress={() => upd({ place: t })} style={pill}><Txt size={13}>{t}</Txt></Pressable>
              ))}
            </View>
            <Row style={{ marginTop: 22, gap: 12, padding: 16, borderRadius: 16, backgroundColor: colors.lilac, alignItems: 'flex-start' }}>
              <Icon name="shield-check" size={18} />
              <Txt size={13} lh={1.5} color={colors.gray800} style={{ flex: 1 }}>Always meet in a public place. ZeitMit never asks for your home address.</Txt>
            </Row>
          </>
        )}

        {!quick && step === 5 && (
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

        {!quick && step === 6 && (
          <>
            <H size={25} ls={-0.03} style={{ marginBottom: 18 }}>{video ? 'Review your booking' : 'Review your request'}</H>
            <Box shadow={4} style={{ backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, borderRadius: 20, paddingVertical: 4, paddingHorizontal: 16 }}>
              <ReviewRow icon="sparkles" label="Activity" value={actLabel} onEdit={() => setStep(1)} />
              <ReviewRow icon="calendar" label="When" value={`${dayLabel} · ${b.time}`} onEdit={() => setStep(2)} />
              <ReviewRow icon="clock" label="Duration" value={durLabel} onEdit={() => setStep(3)} />
              {video
                ? <ReviewRow icon="video" label="Where" value={placeFor(b.act!, '')} />
                : <ReviewRow icon="map-pin" label="Meeting place" value={placeOr(b.place.trim())} onEdit={() => setStep(4)} />}
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
            {isDateAct ? <Boundaries c={c} agree={b.agree} onToggle={() => upd({ agree: !b.agree })} /> : null}
            <View style={{ marginTop: 14, gap: 8, padding: 16, borderRadius: 16, backgroundColor: colors.lilac }}>
              <Txt size={14} weight={700}>How payment works</Txt>
              <Row style={{ gap: 4, alignItems: 'flex-start' }}>
                <FlowStep icon="user" bg={colors.white} label={'You pay\nnow'} />
                <Icon name="arrow-right" size={16} style={{ marginTop: 14 }} />
                <FlowStep icon="lock" bg={colors.sun} label={'ZeitMit\nholds it'} />
                <Icon name="arrow-right" size={16} style={{ marginTop: 14 }} />
                {video
                  ? <FlowStep icon="video" bg={colors.mint} label={`${c.name} gets it\nafter 10 min on the call`} />
                  : <FlowStep icon="key-round" bg={colors.mint} label={`${c.name} gets it\nwith your code`} />}
              </Row>
              <Row style={{ gap: 8, alignItems: 'flex-start' }}>
                <Icon name="rotate-ccw" size={16} style={{ marginTop: 2 }} />
                <Txt size={13} lh={1.5} color={colors.gray800} style={{ flex: 1 }}>
                  {video
                    ? `Confirmed at once. Full refund if you cancel within ${VIDEO_GRACE_MIN} minutes or 24+ hours before, or if ${c.name} doesn’t join.`
                    : `Full refund if ${c.name} declines or doesn’t reply in time, or if you cancel 24+ hours before.`}
                </Txt>
              </Row>
            </View>
          </>
        )}
      </ScrollView>

      <Row style={{ paddingTop: 14, paddingHorizontal: 20, paddingBottom: keyboard ? 12 : Math.max(30, insets.bottom + 8), backgroundColor: colors.white, borderTopWidth: 2, borderTopColor: colors.ink, gap: 14 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={12} color={colors.gray600}>{b.dur ? 'Total incl. fees' : 'Select a duration'}</Txt>
          <H size={21} ls={-0.02}>{total}</H>
        </View>
        <PrimaryButton label={quick || step === 6 ? (video ? (busy ? 'Booking…' : 'Pay & book') : busy ? 'Sending…' : 'Pay & send request') : step === 4 && !b.place.trim() ? 'Skip for now' : 'Continue'} dim={!valid || busy} onPress={next} style={{ paddingHorizontal: 24 }} />
      </Row>
    </KeyboardAvoidingView>
  );
}

const inputReset = { paddingVertical: 0, color: colors.ink, outlineStyle: 'none' } as object;
const pill = { height: 34, paddingHorizontal: 12, borderRadius: 999, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.white, justifyContent: 'center' as const };

/** The companion's boundaries for a date, and "I'll respect these boundaries" (needed to book one). */
function Boundaries({ c, agree, onToggle }: { c: { name: string; ok: string[] }; agree: boolean; onToggle: () => void }) {
  return (
    <View style={{ marginTop: 14, padding: 16, borderRadius: 18, backgroundColor: colors.blush, gap: 10 }}>
      <Row style={{ gap: 6 }}>
        <Icon name="heart" size={15} />
        <Txt size={14} weight={700}>{c.name}’s boundaries</Txt>
      </Row>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {c.ok.map((o) => <BoundaryChip key={o} label={o} icon="check" color={colors.greenDeep} />)}
        {NO.map((o) => <BoundaryChip key={o} label={o} icon="x" color={colors.redDeep} />)}
      </View>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: agree }} onPress={onToggle} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 4 }}>
        <View style={{ width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: agree ? colors.roseDeep : colors.ink, backgroundColor: agree ? colors.roseDeep : colors.white, alignItems: 'center', justifyContent: 'center' }}>
          {agree ? <Icon name="check" size={14} color={colors.white} /> : null}
        </View>
        <Txt size={13} weight={600}>I’ll respect these boundaries</Txt>
      </Pressable>
    </View>
  );
}

export function StepTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <>
      <H size={25} ls={-0.03} style={{ marginBottom: sub ? 6 : 18 }}>{title}</H>
      {sub ? <Txt size={14} color={colors.gray600} style={{ marginBottom: 18 }}>{sub}</Txt> : null}
    </>
  );
}

/** `onEdit` left out: the value can't be changed (a video date's "Video call in the app"). */
function ReviewRow({ icon, label, value, onEdit, last }: { icon: string; label: string; value: string; onEdit?: () => void; last?: boolean }) {
  return (
    <Row style={{ gap: 12, paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.hairline }}>
      <Icon name={icon} size={17} color={colors.gray600} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={14} color={colors.gray600}>{label}</Txt>
        <Txt size={14}>{value}</Txt>
      </View>
      {onEdit ? <TextButton label="Edit" size={13} onPress={onEdit} /> : null}
    </Row>
  );
}

/** Any length from 1 hour up to what fits from the picked time, in half hours. */
function LengthStepper({ dur, max, rate, onChange }: { dur: number | null; max: number; rate: number; onChange: (d: number) => void }) {
  const own = !!dur && ![1, 2, 3, 4].includes(dur);
  const go = (d: number) => onChange(Math.min(max, Math.max(MIN_HOURS, d)));
  return (
    <View style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: own ? colors.butter : colors.white }}>
      <StepButton icon="minus" label="Half an hour shorter" on={!!dur && dur > MIN_HOURS} onPress={() => go((dur ?? MIN_HOURS) - 0.5)} />
      <View style={{ flex: 1, minWidth: 0, alignItems: 'center' }}>
        <Txt size={12} weight={600} color={colors.gray600}>Your own length</Txt>
        <Txt size={17} weight={700} numberOfLines={1}>{dur ? hours(dur) : 'Half-hour steps'}</Txt>
        {dur ? <Txt size={14} color={colors.gray600}>{eur(rate * dur)}</Txt> : null}
      </View>
      <StepButton icon="plus" label="Half an hour longer" on={(dur ?? 0) < max} onPress={() => go(dur ? dur + 0.5 : MIN_HOURS)} />
    </View>
  );
}

const StepButton = ({ icon, label, on, onPress }: { icon: string; label: string; on: boolean; onPress: () => void }) => (
  <Pressable
    accessibilityRole="button" accessibilityLabel={t(label)} accessibilityState={{ disabled: !on }} disabled={!on} hitSlop={6} onPress={onPress}
    style={{ width: 44, height: 44, borderRadius: 14, borderWidth: 2, borderColor: on ? colors.ink : colors.gray350, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' }}
  >
    <Icon name={icon} size={18} color={on ? colors.ink : colors.gray350} />
  </Pressable>
);

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
