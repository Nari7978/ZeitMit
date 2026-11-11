import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font } from '../theme';
import { AM, boundariesOf, BSTEPS, eur, isVideo, kindOf, kindsOf, lengthLabel, MAX_MINUTES, MIN_MINUTES, placeFor, placeOr, ROM, slotDay, type ActId, type Kind } from '../data';
import { daysOf, deadlineFor, earliestNow, firstStart, freeFrom, otherZone, timeOf, useAvailability } from '../lib/avail';
import { cityOf } from '../lib/tz';
import { localAt, untilLabel, whenAt } from '../lib/dates';
import { useStore } from '../store';
import { goBack, toBookings } from '../nav';
import { Icon } from '../ui/Icon';
import { Box, Confetti, Enter, H, Ring, Row, Txt, Photo } from '../ui/primitives';
import { DayBar, DayStrip, LengthPicker, spanText, StartPicker } from '../ui/TimePicker';
import { CircleButton, PrimaryButton, TextButton, Unavailable, useKeyboardShown, useTopPad } from '../ui/common';
import { t } from '../i18n';

/** `start`: unix; `minutes`: the length. */
type Draft = { act: ActId | null; date: string | null; start: number | null; minutes: number | null; place: string; note: string; agree: boolean };

export default function BookingFlow() {
  const params = useLocalSearchParams<{ cid: string; date?: string; quick?: string; kind?: string }>();
  const c = useStore((s) => s.byId[params.cid]);
  const listLoaded = useStore((s) => !s.loading);
  // Free time updates live while you book: a booking confirmed or cancelled meanwhile shows up at once.
  const { a, reload } = useAvailability(c ? params.cid : undefined);
  // The link may ask for one kind (a profile's "Next free" or day strip); otherwise the activity picked decides.
  const asked: Kind | null = params.kind === 'video' || params.kind === 'meet' ? params.kind : null;
  const offered = c ? kindsOf(c.acts) : [];
  const acts = c ? (asked && offered.includes(asked) ? c.acts.filter((x) => kindOf(x) === asked) : c.acts) : [];
  const [busy, setBusy] = useState(false);
  const top = useTopPad();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardShown();
  const [step, setStep] = useState(1);
  // Quick booking: the companion's next free time, booked on one page (activity, length, pay). "Pick another time"
  // switches to the step-by-step flow.
  const [quick, setQuick] = useState(params.quick === '1');
  const [done, setDone] = useState(false);
  const [b, setB] = useState<Draft>({ act: null, date: params.date ?? null, start: null, minutes: null, place: '', note: '', agree: false });
  const upd = (o: Partial<Draft>) => setB((x) => ({ ...x, ...o }));
  const kind: Kind = b.act ? kindOf(b.act) : (asked && offered.includes(asked) ? asked : offered[0] ?? 'meet');
  const free = a?.kinds[kind] ?? null;
  const minLen = free?.min ?? MIN_MINUTES[kind];
  const maxLen = free?.max ?? MAX_MINUTES;
  // Another kind of activity can have other free time: the picked start goes (quietly), the day stays. It also has
  // other boundaries, so agreeing to them starts over.
  const pickAct = (x: ActId) => upd(kindOf(x) === kind ? { act: x } : { act: x, start: null, minutes: null, agree: false });
  const [booked, setBooked] = useState<{ expiresAt?: number } | null>(null);
  const days = a ? daysOf(a, kind, minLen) : [];
  const day = days.find((d) => d.date === b.date);
  // How long a booking from the picked start can be: up to the next booking, closed or blocked time, at most 8 hours.
  const room = a && free && b.start !== null && b.start >= earliestNow(a) && b.start < a.latest ? Math.min(maxLen, freeFrom(free.open, b.start)) : 0;
  const fits = room >= minLen;

  // A checkout left unpaid earlier: close it before trying again.
  useEffect(() => {
    if (useStore.getState().pendingCheckout?.cid === params.cid) void useStore.getState().releaseCheckout().then(() => reload());
  }, [params.cid, reload]);

  // Someone else was just confirmed for the picked time, or the companion changed their hours: say so and step back.
  // Quiet while your own payment runs and just after it.
  const quiet = useRef(0);
  const lost = !!a && b.start !== null && !busy && !done && (!fits || (!!b.minutes && b.minutes > room));
  useEffect(() => {
    if (quick || !lost || !c || Date.now() < quiet.current) return;
    const { showToast } = useStore.getState();
    const at = timeOf(b.start!);
    if (!fits) {
      showToast(`${at} isn’t available any more. Pick another time.`);
      upd({ start: null });
      if (step > 2) setStep(2);
    } else {
      showToast(`From ${at}, ${c.name} is now only free for ${lengthLabel(room)}. Pick a shorter time.`);
      upd({ minutes: null });
      if (step > 3) setStep(3);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lost]);

  // Quick booking always takes the next free start. When someone else is confirmed for it (or the companion changes
  // their hours), it moves to the next one at once, and says so.
  const next = a ? firstStart(a, kind, minLen) : null;
  const shown = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (!quick || !a || !c || busy || done) return;
    const was = shown.current;
    if (was !== undefined && was === next) return;
    shown.current = next;
    const room0 = next !== null && free ? Math.min(maxLen, freeFrom(free.open, next)) : 0;
    setB((x) => ({ ...x, date: next !== null ? localAt(next).date : null, start: next, minutes: next !== null ? Math.min(x.minutes ?? minLen, room0) : x.minutes }));
    if (was && Date.now() >= quiet.current) {
      useStore.getState().showToast(next !== null ? `${timeOf(was)} isn’t free any more. Next free: ${whenAt(next)}.` : `${timeOf(was)} isn’t free any more, and ${c.name} has nothing else free this week.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quick, a, next, busy, done, c?.id]);
  // One activity on offer (or one of the kind asked for, like video dates): it's the one.
  useEffect(() => {
    if (acts.length === 1 && !b.act) upd({ act: acts[0] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c?.id, acts.length]);
  // The day picked (from a profile's day strip) has nothing free for this length: no day picked.
  useEffect(() => {
    if (a && b.date && !quick && step === 2 && day && !day.starts.length) upd({ date: null, start: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, b.date, step]);
  if (!c && listLoaded) return <Unavailable title="This companion isn’t available" body="They may have paused or removed their profile." />;
  if (!c) return <View style={{ flex: 1, backgroundColor: colors.sun, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.ink} /></View>;

  // Priced by the minute, in cents, as the server does: rate × minutes ÷ 60, plus the 10% fee.
  const sub = b.minutes ? Math.round((c.rate * 100 * b.minutes) / 60) : 0;
  const fee = Math.round(sub * 0.1);
  const credit = useStore.getState().user?.credit ?? 0;
  const creditUse = b.minutes ? Math.min(credit, sub + fee) : 0;
  const total = b.minutes ? eur((sub + fee - creditUse) / 100) : '—';
  const isDateAct = !!b.act && ROM.includes(b.act);
  const okLength = !!b.minutes && b.minutes >= minLen && b.minutes <= room;
  const valid = quick
    ? !!b.act && fits && okLength && (!isDateAct || b.agree)
    : [!!b.act, fits, okLength, true, true, !isDateAct || b.agree][step - 1];
  // A video date happens in the app, so it skips the meeting place.
  const video = !!b.act && isVideo(b.act);
  const order = video ? [1, 2, 3, 5, 6] : [1, 2, 3, 4, 5, 6];
  const at = order.indexOf(step);
  const deadline = b.start !== null ? deadlineFor(b.start) : null;
  const zone = otherZone(a);

  const go = () => {
    if (!valid) return;
    if (!quick && step < 6) return setStep(order[at + 1] ?? step + 1);
    if (busy) return;
    setBusy(true);
    void useStore.getState()
      .addBooking({ cid: c.id, act: b.act!, startsAt: b.start!, minutes: b.minutes!, place: b.place, note: b.note, boundariesAgreed: b.agree })
      .then((bk) => {
        if (bk) {
          setBooked({ expiresAt: bk.expiresAt });
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
  const dayLabel = b.start !== null ? slotDay(localAt(b.start).date, 9).full : '—';
  const when = b.start !== null ? (b.minutes ? spanText(b.start, b.minutes, day?.dst) : timeOf(b.start, day?.dst)) : '—';
  const durLabel = b.minutes ? lengthLabel(b.minutes) : '—';
  const actLabel = b.act ? AM[b.act].label : '—';
  const until = untilLabel(booked?.expiresAt ?? deadline ?? 0);

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
        {/* Every booking is a request: it's confirmed once the companion accepts. */}
        <Enter kind="rise" delay={320}><H size={28} ls={-0.03} align="center">Paid & request sent</H></Enter>
        <Enter kind="rise" delay={420}>
          <Txt size={15} lh={1.55} color={colors.gray800} align="center">
            {video
              ? `You paid ${total}. ${c.name} has until ${until} to accept. Once they do, join from Bookings from 10 minutes before the start. ZeitMit holds the money until the video date ends. If they decline or don’t accept in time, you get a full refund.`
              : `You paid ${total}. ZeitMit holds it safely until you meet. ${c.name} has until ${until} to accept. If they decline or don’t accept in time, you get a full refund.`}
          </Txt>
        </Enter>
        <Enter kind="rise" delay={540} style={{ width: '100%' }}>
        <Box shadow={4} fit style={{ width: '100%', marginTop: 12, padding: 16, borderRadius: 18, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 48, height: 48, borderRadius: 14, overflow: 'hidden' }}><Photo hue={c.hue} url={c.photoUrl} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt size={15} weight={700}>{actLabel} · {durLabel}</Txt>
            <Txt size={13} color={colors.gray600}>{dayLabel} · {when}</Txt>
          </View>
          <Txt size={15} weight={700}>{total}</Txt>
        </Box>
        </Enter>
        <Enter kind="fade" delay={700}><Txt size={12} color={colors.gray600} align="center">Free cancellation until it’s accepted. After that, the service fee isn’t refundable.</Txt></Enter>
        <View style={{ width: '100%', gap: 6, marginTop: 16 }}>
          <PrimaryButton label="View in Bookings" onPress={() => toBookings('pending')} />
          <View style={{ alignItems: 'center' }}>
            <TextButton label="Back to Discover" size={15} onPress={() => router.dismissTo('/')} style={{ paddingVertical: 12 }} />
          </View>
        </View>
      </View>
    );
  }

  const zoneNote = zone ? (
    <Row style={{ gap: 6, marginTop: 10, alignItems: 'flex-start' }}>
      <Icon name="globe" size={14} color={colors.gray600} style={{ marginTop: 2 }} />
      <Txt size={12.5} lh={1.45} color={colors.gray600} style={{ flex: 1 }}>{`Times are in your time zone. ${c.name}’s hours are set in ${cityOf(zone)} time.`}</Txt>
    </Row>
  ) : null;

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
                <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: b.start !== null ? colors.green : colors.gray400 }} />
                <Txt size={13} weight={600} color={colors.gray800}>{b.start !== null ? (kind === 'video' ? 'Next free video date' : 'Next free') : !a ? 'Checking…' : 'Nothing free this week'}</Txt>
              </Row>
              {b.start !== null ? <H size={26} ls={-0.02}>{whenAt(b.start)}</H> : null}
              <Txt size={13} lh={1.45} color={colors.gray800}>
                {b.start !== null ? `${c.name} is free for up to ${lengthLabel(room)} from then.` : !a ? ' ' : 'Try again later: times free up when bookings are cancelled.'}
              </Txt>
              {b.start !== null && deadline ? (
                <Row style={{ gap: 6, marginTop: 4, alignItems: 'flex-start' }}>
                  <Icon name="hourglass" size={14} color={colors.greenDeep} style={{ marginTop: 2 }} />
                  <Txt size={13} weight={600} lh={1.45} color={colors.greenDeep} style={{ flex: 1 }}>{`${c.name} has until ${untilLabel(deadline)} to accept, or you get a full refund.`}</Txt>
                </Row>
              ) : null}
            </Box>
            {zoneNote}
            <Txt size={16} weight={700} style={{ marginTop: 24, marginBottom: 10 }}>What would you like to do?</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {acts.map((x) => {
                const on = b.act === x;
                return (
                  <Pressable key={x} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => pickAct(x)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 7, height: 42, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: on ? colors.ink : colors.white }}>
                    <Icon name={AM[x].icon} size={16} color={on ? colors.white : colors.ink} />
                    <Txt size={14} weight={600} color={on ? colors.white : colors.ink}>{AM[x].label}</Txt>
                  </Pressable>
                );
              })}
            </View>
            <Txt size={16} weight={700} style={{ marginTop: 24, marginBottom: 10 }}>How long?</Txt>
            {fits ? <LengthPicker video={kind === 'video'} minutes={b.minutes} min={minLen} max={room} rate={c.rate} onChange={(m) => upd({ minutes: m })} /> : null}
            {fits && b.minutes && b.start !== null ? <EndsAt start={b.start} minutes={b.minutes} dst={day?.dst} /> : null}
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
            {/* What's refundable, before paying with one tap (the step-by-step flow says it on its last step). */}
            {fits && b.minutes ? (
              <Row style={{ marginTop: 10, gap: 8, alignItems: 'flex-start' }}>
                <Icon name="rotate-ccw" size={15} color={colors.gray600} style={{ marginTop: 1 }} />
                <Txt size={13} lh={1.45} color={colors.gray600} style={{ flex: 1 }}>
                  {video
                    ? `Once ${c.name} accepts, the ${eur(fee / 100)} service fee isn’t refundable. If they’re not in the call for all of it, you pay only for the time they were.`
                    : `Once ${c.name} accepts, the ${eur(fee / 100)} service fee isn’t refundable.`}
                </Txt>
              </Row>
            ) : null}
            {isDateAct ? <Boundaries c={c} kind={kind} agree={b.agree} onToggle={() => upd({ agree: !b.agree })} /> : null}
            <TextButton label="Pick another time" icon="calendar" size={14} weight={700} onPress={() => { setQuick(false); setStep(b.act ? 2 : 1); }} style={{ alignSelf: 'center', marginTop: 18 }} />
          </>
        )}
        {!quick && step === 1 && (
          <>
            <StepTitle title="What would you like to do?" sub={`${c.name} offers these activities.`} />
            <View style={{ gap: 10 }}>
              {acts.map((x) => {
                const on = b.act === x;
                return (
                  <Pressable key={x} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => pickAct(x)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: on ? colors.butter : colors.white }}>
                    <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: colors.blush, alignItems: 'center', justifyContent: 'center' }}><Icon name={AM[x].icon} size={20} /></View>
                    <View style={{ flex: 1 }}>
                      <Txt size={16} weight={600}>{AM[x].label}</Txt>
                      <Txt size={13} color={colors.gray600} style={{ marginTop: 2 }}>{AM[x].desc}</Txt>
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
            <StepTitle title="Pick a day and start time" sub="Any start in 15-minute steps, from 3½ hours from now. Green is free." />
            {!a ? (
              <Txt size={14} color={colors.gray600}>Loading availability…</Txt>
            ) : (
              <>
                <DayStrip days={days} selected={b.date} onPick={(d) => upd({ date: d, start: null })} />
                {zoneNote}
                {day && day.starts.length ? (
                  <View style={{ marginTop: 20, gap: 18 }}>
                    <DayBar day={day} pick={b.start !== null && b.minutes && b.minutes <= room ? [b.start, b.start + b.minutes * 60] : null} />
                    <StartPicker day={day} value={b.start !== null && day.starts.includes(b.start) ? b.start : null} onPick={(u) => upd({ start: u, minutes: b.minutes && b.minutes > Math.min(maxLen, freeFrom(free!.open, u)) ? null : b.minutes })} />
                    {b.start !== null && fits ? (
                      <Row style={{ gap: 8, padding: 14, borderRadius: 16, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink }}>
                        <Icon name="clock" size={17} />
                        <Txt size={14} weight={600} style={{ flex: 1 }}>{`From ${timeOf(b.start, day.dst)}, ${c.name} is free for up to ${lengthLabel(room)}.`}</Txt>
                      </Row>
                    ) : null}
                  </View>
                ) : (
                  <View style={{ marginTop: 24, padding: 18, borderRadius: 16, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.ink }}>
                    <Txt size={14} color={colors.gray600} align="center">{days.some((d) => d.starts.length) ? 'Choose a day with a green dot to see times.' : `${c.name} has nothing free in the next 7 days.`}</Txt>
                  </View>
                )}
              </>
            )}
          </>
        )}

        {!quick && step === 3 && (
          <>
            <StepTitle title="How long?" sub={`${eur(c.rate)} per hour, charged by the minute. ${kind === 'video' ? '30 minutes' : '1 hour'} to 8 hours, in 15-minute steps.`} />
            {b.start !== null && fits ? (
              <>
                <LengthPicker video={kind === 'video'} minutes={b.minutes} min={minLen} max={room} rate={c.rate} onChange={(m) => upd({ minutes: m })} />
                {b.minutes ? <EndsAt start={b.start} minutes={b.minutes} dst={day?.dst} /> : null}
                {room < maxLen ? (
                  <Row style={{ marginTop: 14, gap: 8, alignItems: 'flex-start' }}>
                    <Icon name="info" size={15} color={colors.gray600} style={{ marginTop: 2 }} />
                    <Txt size={13} lh={1.5} color={colors.gray600} style={{ flex: 1 }}>{`From ${timeOf(b.start)}, ${c.name} is free until ${timeOf(b.start + room * 60)}, so you can book up to ${lengthLabel(room)}.`}</Txt>
                  </Row>
                ) : null}
              </>
            ) : null}
          </>
        )}

        {!quick && step === 4 && (
          <>
            <StepTitle title="Where will you meet?" sub="Optional. A café, park entrance or public venue. You can also agree on it in the chat." />
            <Row style={{ height: 54, gap: 10, paddingHorizontal: 16, borderRadius: 16, backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.ink }}>
              <Icon name="map-pin" size={18} color={colors.gray600} />
              <TextInput value={b.place} onChangeText={(v) => upd({ place: v })} accessibilityLabel="Meeting place" placeholder={t("e.g. Café at Paul-Lincke-Ufer")} placeholderTextColor={colors.gray400} style={[font('body'), inputReset, { flex: 1, fontSize: 16 }]} />
              {b.place ? <Pressable accessibilityRole="button" accessibilityLabel={t('Clear meeting place')} hitSlop={10} onPress={() => upd({ place: '' })}><Icon name="x" size={17} color={colors.gray600} /></Pressable> : null}
            </Row>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
              {['A café in ' + c.area, c.area + ' U-Bahn station exit', 'Museum or gallery lobby'].map((x) => (
                <Pressable key={x} accessibilityRole="button" onPress={() => upd({ place: x })} style={pill}><Txt size={13}>{x}</Txt></Pressable>
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
                onChangeText={(v) => upd({ note: v.slice(0, 240) })}
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
              {['First time doing this', 'Practising my German', 'Happy to follow your lead'].map((x) => (
                <Pressable key={x} accessibilityRole="button" onPress={() => upd({ note: ((b.note ? b.note + ' ' : '') + x + '.').slice(0, 240) })} style={[pill, { flexDirection: 'row', alignItems: 'center', gap: 5 }]}>
                  <Icon name="plus" size={13} color={colors.gray600} />
                  <Txt size={13}>{x}</Txt>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {!quick && step === 6 && (
          <>
            <H size={25} ls={-0.03} style={{ marginBottom: 18 }}>Review your request</H>
            <Box shadow={4} style={{ backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, borderRadius: 20, paddingVertical: 4, paddingHorizontal: 16 }}>
              <ReviewRow icon="sparkles" label="Activity" value={actLabel} onEdit={() => setStep(1)} />
              <ReviewRow icon="calendar" label="When" value={`${dayLabel} · ${when}`} onEdit={() => setStep(2)} />
              <ReviewRow icon="clock" label="Duration" value={durLabel} onEdit={() => setStep(3)} />
              {video
                ? <ReviewRow icon="video" label="Where" value={placeFor(b.act!, '')} />
                : <ReviewRow icon="map-pin" label="Meeting place" value={placeOr(b.place.trim())} onEdit={() => setStep(4)} />}
              <ReviewRow icon="message-square-text" label="Note" value={b.note || 'No note added'} onEdit={() => setStep(5)} last />
            </Box>
            <Box shadow={4} style={{ marginTop: 14, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, borderRadius: 20, padding: 16, gap: 10 }}>
              <PriceRow l="Hourly rate" r={eur(c.rate)} />
              <PriceRow l={`${eur(c.rate)} × ${durLabel}`} r={eur(sub / 100)} />
              <PriceRow l="Service fee (10%)" r={eur(fee / 100)} />
              {creditUse ? <PriceRow l="Gift credit" r={'−' + eur(creditUse / 100)} /> : null}
              <View style={{ height: 1, backgroundColor: colors.ink }} />
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt size={16} weight={700}>Total payable</Txt>
                <Txt size={16} weight={700}>{total}</Txt>
              </Row>
            </Box>
            {isDateAct ? <Boundaries c={c} kind={kind} agree={b.agree} onToggle={() => upd({ agree: !b.agree })} /> : null}
            <View style={{ marginTop: 14, gap: 8, padding: 16, borderRadius: 16, backgroundColor: colors.lilac }}>
              <Txt size={14} weight={700}>How payment works</Txt>
              <Row style={{ gap: 4, alignItems: 'flex-start' }}>
                <FlowStep icon="user" bg={colors.white} label={'You pay\nnow'} />
                <Icon name="arrow-right" size={16} style={{ marginTop: 14 }} />
                <FlowStep icon="lock" bg={colors.sun} label={'ZeitMit\nholds it'} />
                <Icon name="arrow-right" size={16} style={{ marginTop: 14 }} />
                {video
                  ? <FlowStep icon="video" bg={colors.mint} label={`${c.name} gets it\nafter the call`} />
                  : <FlowStep icon="key-round" bg={colors.mint} label={`${c.name} gets it\nwith your code`} />}
              </Row>
              {deadline ? (
                <Row style={{ gap: 8, alignItems: 'flex-start' }}>
                  <Icon name="hourglass" size={16} style={{ marginTop: 2 }} />
                  <Txt size={13} lh={1.5} color={colors.gray800} style={{ flex: 1 }}>{`${c.name} has until ${untilLabel(deadline)} to accept.`}</Txt>
                </Row>
              ) : null}
              <Row style={{ gap: 8, alignItems: 'flex-start' }}>
                <Icon name="rotate-ccw" size={16} style={{ marginTop: 2 }} />
                <Txt size={13} lh={1.5} color={colors.gray800} style={{ flex: 1 }}>
                  {video
                    ? `Full refund if ${c.name} declines or doesn’t accept in time. Once they accept, the ${eur(fee / 100)} service fee isn’t refundable: you get the rest back if you cancel 24+ hours before, or if ${c.name} cancels or doesn’t join.`
                    : `Full refund if ${c.name} declines or doesn’t accept in time. Once they accept, the ${eur(fee / 100)} service fee isn’t refundable: you get the rest back if you cancel 24+ hours before, or if ${c.name} cancels.`}
                </Txt>
              </Row>
              {video ? (
                <Row style={{ gap: 8, alignItems: 'flex-start' }}>
                  <Icon name="video" size={16} style={{ marginTop: 2 }} />
                  <Txt size={13} lh={1.5} color={colors.gray800} style={{ flex: 1 }}>{`If ${c.name} isn’t in the call for all of it, you pay only for the time they were.`}</Txt>
                </Row>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>

      <Row style={{ paddingTop: 14, paddingHorizontal: 20, paddingBottom: keyboard ? 12 : Math.max(30, insets.bottom + 8), backgroundColor: colors.white, borderTopWidth: 2, borderTopColor: colors.ink, gap: 14 }}>
        {/* The total keeps room for itself; on small phones a long button label (German) wraps instead. */}
        <View style={{ flex: 1, minWidth: 84 }}>
          <Txt size={12} color={colors.gray600}>{b.minutes ? 'Total incl. fees' : 'Select a duration'}</Txt>
          <H size={21} ls={-0.02}>{total}</H>
        </View>
        <PrimaryButton label={quick || step === 6 ? (busy ? 'Sending…' : 'Pay & send request') : step === 4 && !b.place.trim() ? 'Skip for now' : 'Continue'} dim={!valid || busy} onPress={go} style={{ paddingHorizontal: 16, flexShrink: 1 }} />
      </Row>
    </KeyboardAvoidingView>
  );
}

/** "Ends 20:15 · 18:15–20:15": when the booking ends, worked out from the start and length. */
function EndsAt({ start, minutes, dst }: { start: number; minutes: number; dst?: boolean }) {
  return (
    <Row style={{ marginTop: 12, gap: 8, padding: 14, borderRadius: 16, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink }}>
      <Icon name="flag" size={16} />
      <Txt size={14} weight={600} style={{ flex: 1 }}>{`Ends ${timeOf(start + minutes * 60, dst)} · ${spanText(start, minutes, dst)}`}</Txt>
    </Row>
  );
}

const inputReset = { paddingVertical: 0, color: colors.ink, outlineStyle: 'none' } as object;
const pill = { height: 34, paddingHorizontal: 12, borderRadius: 999, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.white, justifyContent: 'center' as const };

/**
 * The companion's boundaries for a date, and "I'll respect these boundaries" (needed to book one). A video date has
 * its own (nothing physical happens on a call).
 */
function Boundaries({ c, kind, agree, onToggle }: { c: { name: string; ok: string[]; okVideo?: string[] }; kind: Kind; agree: boolean; onToggle: () => void }) {
  const bd = boundariesOf(c, kind);
  return (
    <View style={{ marginTop: 14, padding: 16, borderRadius: 18, backgroundColor: colors.blush, gap: 10 }}>
      <Row style={{ gap: 6 }}>
        <Icon name={kind === 'video' ? 'video' : 'heart'} size={15} />
        <Txt size={14} weight={700} style={{ flex: 1 }}>{kind === 'video' ? `${c.name}’s video date boundaries` : `${c.name}’s boundaries`}</Txt>
      </Row>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {(bd.ok.length ? bd.ok : [bd.none]).map((o) => <BoundaryChip key={o} label={o} icon="check" color={colors.greenDeep} />)}
        {bd.no.map((o) => <BoundaryChip key={o} label={o} icon="x" color={colors.redDeep} />)}
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

const PriceRow = ({ l, r }: { l: string; r: string }) => (
  <Row style={{ justifyContent: 'space-between' }}>
    <Txt size={14} color={colors.gray600}>{l}</Txt>
    <Txt size={14}>{r}</Txt>
  </Row>
);

// Long labels (German, small phones) wrap inside the chip instead of running past the card.
const BoundaryChip = ({ label, icon, color }: { label: string; icon: string; color: string }) => (
  <Row style={{ minHeight: 26, maxWidth: '100%', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 13, backgroundColor: colors.white, gap: 4 }}>
    <Icon name={icon} size={12} color={color} />
    <Txt size={12} color={color} style={{ flexShrink: 1 }}>{label}</Txt>
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
