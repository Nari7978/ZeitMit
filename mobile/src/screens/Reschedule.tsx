// Picking a new time for a booking, from either side: any free start in 15-minute steps for the same length, kept
// current while the screen is open. A request the companion hasn't answered is moved straight away; otherwise the
// other side gets the suggestion to accept or decline (at least 3 hours before the new time).
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { goBack } from '../nav';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { AM, lengthLabel, type ActId, type BookingStatus, type Kind } from '../data';
import { api, ApiError } from '../api';
import { useStore, type Resched } from '../store';
import { daysOf, deadlineFor, otherZone, type Availability } from '../lib/avail';
import { untilLabel } from '../lib/dates';
import { cityOf } from '../lib/tz';
import { useLive } from '../lib/live';
import { Icon } from '../ui/Icon';
import { Box, Row, Txt } from '../ui/primitives';
import { DayBar, DayStrip, spanText, StartPicker } from '../ui/TimePicker';
import { CircleButton, PrimaryButton, Unavailable, useTopPad } from '../ui/common';
import { StepTitle } from './BookingFlow';

const FREE_CHANGE_HOURS = 24;

type Data = {
  id: string; side: 'customer' | 'companion'; cid: string; act: ActId; kind: Kind; minutes: number; status: BookingStatus; startsAt: number;
  day: string; time: string; end: string; full: string; other: string; resched: Resched | null; left: number;
  /** The companion's free time for this kind of date, with this booking's own time left free. */
  availability: Availability | null;
};

export default function Reschedule() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const top = useTopPad();
  const insets = useSafeAreaInsets();
  const [d, setD] = useState<Data | null>(null);
  const [pick, setPick] = useState<{ date: string | null; start: number | null }>({ date: null, start: null });
  const [busy, setBusy] = useState(false);
  // Why it couldn't load: the API's answer (the booking is gone or can't move), or no connection.
  const [failed, setFailed] = useState<{ message: string; offline: boolean } | null>(null);
  const loaded = useRef(false);
  const { showToast } = useStore.getState();

  const load = useCallback(async () => {
    try {
      setD(await api<Data>('GET', `/bookings/${id}/reschedule`));
      loaded.current = true;
      setFailed(null);
    } catch (e) {
      // Already showing the times: just say what went wrong. Nothing to show yet: a screen that explains it.
      if (loaded.current) showToast((e as Error).message);
      else setFailed({ message: (e as Error).message, offline: !(e instanceof ApiError) });
    }
  }, [id, showToast]);
  useEffect(() => { void load(); }, [load]);
  // Someone books or cancels meanwhile: reload (this view leaves the booking's own time free, so it can't use the pushed one).
  useLive(d ? `/live/slots/${d.cid}` : null, (e) => { if (e.type === 'slots') void load(); }, () => void load());

  if (!d && failed) {
    return failed.offline
      ? <Unavailable title="Couldn’t load this booking" body="Check your connection and try again." onRetry={() => { setFailed(null); void load(); }} />
      : <Unavailable title="This booking can’t be changed" body={failed.message} />;
  }
  if (!d) return <View style={{ flex: 1, backgroundColor: colors.sun, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.ink} /></View>;

  const a = d.availability;
  // Starts where this booking's length fits, its current start left out.
  const days = a ? daysOf(a, d.kind, d.minutes).map((x) => ({ ...x, starts: x.starts.filter((u) => u !== d.startsAt) })) : [];
  const day = days.find((x) => x.date === pick.date);
  const chosen = !!day && pick.start !== null && day.starts.includes(pick.start);
  const direct = d.side === 'customer' && d.status === 'pending';
  const tooLate = d.side === 'customer' && d.status === 'confirmed' && d.startsAt - Date.now() / 1000 < FREE_CHANGE_HOURS * 3600;
  const blocked = d.left <= 0 ? 'This booking was already moved 3 times. Cancel it and book again instead.'
    : tooLate ? `You can change the time up to ${FREE_CHANGE_HOURS} hours before. Send ${d.other} a message instead.`
      : d.resched && d.resched.by !== d.side ? `${d.other} suggested ${d.resched.day} · ${d.resched.time}. Answer that suggestion first.`
        : null;
  const label = !chosen ? 'Pick a new time' : direct ? 'Move request' : d.side === 'customer' ? `Ask ${d.other} to move it` : 'Suggest this time';
  const zone = otherZone(a);
  const answerBy = chosen ? untilLabel(direct ? deadlineFor(pick.start!) : pick.start! - 3 * 3600) : null;

  const submit = async () => {
    if (!chosen || busy) return;
    setBusy(true);
    try {
      const r = await api<{ moved: boolean; full: string }>('POST', `/bookings/${d.id}/reschedule`, { startsAt: pick.start });
      showToast(r.moved ? `Request moved to ${r.full}.` : `Suggested ${r.full}. We’ll let you know when ${d.other} answers.`);
      void useStore.getState().refresh();
      goBack();
    } catch (e) {
      showToast((e as Error).message);
      setPick((p) => ({ ...p, start: null }));
      void load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.sun }}>
      <Row style={{ paddingTop: top, paddingHorizontal: 16, gap: 10 }}>
        <CircleButton icon="x" label="Close" iconSize={19} onPress={() => goBack()} />
        <Txt size={16} weight={700} style={{ flex: 1 }}>{d.side === 'customer' ? 'Change time' : 'Suggest another time'}</Txt>
      </Row>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingTop: 18 }}>
        <Box shadow={4} style={{ padding: 14, borderRadius: 18, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 22 }}>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: colors.blush, alignItems: 'center', justifyContent: 'center' }}><Icon name={AM[d.act].icon} size={20} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt size={15} weight={700}>{AM[d.act].label} · {lengthLabel(d.minutes)}</Txt>
            <Txt size={13} color={colors.gray600}>Now {d.day} · {d.time}–{d.end} · with {d.other}</Txt>
          </View>
        </Box>
        {blocked ? (
          <Row style={{ gap: 10, padding: 16, borderRadius: 16, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, alignItems: 'flex-start' }}>
            <Icon name="info" size={18} />
            <Txt size={14} lh={1.5} style={{ flex: 1 }}>{blocked}</Txt>
          </Row>
        ) : (
          <>
            <StepTitle title="Pick a new time" sub={`Same length (${lengthLabel(d.minutes)}). Any free start in 15-minute steps, from 3½ hours from now.`} />
            {!a ? <Txt size={14} color={colors.gray600}>{`${d.other} has no free time for this kind of date.`}</Txt> : (
              <>
                <DayStrip days={days} selected={pick.date} onPick={(x) => setPick({ date: x, start: null })} />
                {zone ? (
                  <Row style={{ gap: 6, marginTop: 10, alignItems: 'flex-start' }}>
                    <Icon name="globe" size={14} color={colors.gray600} style={{ marginTop: 2 }} />
                    <Txt size={12.5} lh={1.45} color={colors.gray600} style={{ flex: 1 }}>{`Times are in your time zone. The companion’s hours are set in ${cityOf(zone)} time.`}</Txt>
                  </Row>
                ) : null}
                {day && day.starts.length ? (
                  <View style={{ marginTop: 20, gap: 18 }}>
                    <DayBar day={day} pick={chosen ? [pick.start!, pick.start! + d.minutes * 60] : null} />
                    <StartPicker day={day} value={chosen ? pick.start : null} onPick={(u) => setPick((p) => ({ ...p, start: u }))} />
                    {chosen ? (
                      <Row style={{ gap: 8, padding: 14, borderRadius: 16, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink }}>
                        <Icon name="calendar-clock" size={17} />
                        <Txt size={14} weight={600} style={{ flex: 1 }}>{`New time: ${spanText(pick.start!, d.minutes, day.dst)}`}</Txt>
                      </Row>
                    ) : null}
                  </View>
                ) : (
                  <View style={{ marginTop: 24, padding: 18, borderRadius: 16, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.ink }}>
                    <Txt size={14} color={colors.gray600} align="center">{days.some((x) => x.starts.length) ? 'Choose a day with a green dot to see times.' : `No other time is free for ${lengthLabel(d.minutes)} in the next 7 days.`}</Txt>
                  </View>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
      <View style={{ paddingTop: 14, paddingHorizontal: 20, paddingBottom: Math.max(30, insets.bottom + 8), backgroundColor: colors.white, borderTopWidth: 2, borderTopColor: colors.ink, gap: 10 }}>
        {!blocked ? (
          <Txt size={12} lh={1.45} color={colors.gray600}>
            {direct
              ? `${d.other} hasn’t answered yet, so your request simply moves.${answerBy ? ` They then have until ${answerBy} to accept.` : ''}`
              : `${d.other} has to agree${answerBy ? ` by ${answerBy}` : ''}. Until then it stays on ${d.day} · ${d.time}.`}
          </Txt>
        ) : null}
        <PrimaryButton label={busy ? 'Sending…' : label} dim={!chosen || busy || !!blocked} onPress={() => void submit()} />
      </View>
    </View>
  );
}
