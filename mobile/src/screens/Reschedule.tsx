// Picking a new time for a booking, from either side. The companion's open times update live; times that are too
// short for the booking are crossed out. A request the companion hasn't answered is moved straight away; otherwise
// the other side gets the suggestion to accept or decline.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { AM, hours, slotDay, type ActId, type BookingStatus } from '../data';
import { api } from '../api';
import { useStore, type Resched } from '../store';
import { fitAt, type DaySlots } from '../lib/slots';
import { useLive } from '../lib/live';
import { Icon } from '../ui/Icon';
import { Box, Row, Txt } from '../ui/primitives';
import { CircleButton, PrimaryButton, useTopPad } from '../ui/common';
import { StepTitle } from './BookingFlow';

const TIMES = ['09:30', '11:00', '12:30', '14:00', '15:30', '17:00', '18:30', '20:00'];
const FREE_CHANGE_HOURS = 24;

type Data = {
  id: string; side: 'customer' | 'companion'; cid: string; act: ActId; dur: number; status: BookingStatus; startsAt: number;
  day: string; time: string; full: string; other: string; resched: Resched | null; left: number; slots: DaySlots[];
};

export default function Reschedule() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const top = useTopPad();
  const insets = useSafeAreaInsets();
  const [d, setD] = useState<Data | null>(null);
  const [pick, setPick] = useState<{ date: string | null; time: string | null }>({ date: null, time: null });
  const [busy, setBusy] = useState(false);
  const { showToast } = useStore.getState();

  const load = useCallback(async () => {
    try {
      setD(await api<Data>('GET', `/bookings/${id}/reschedule`));
    } catch (e) {
      showToast((e as Error).message);
    }
  }, [id, showToast]);
  useEffect(() => { void load(); }, [load]);
  // Someone books or cancels meanwhile: reload (this view leaves the booking's own time out, so it can't use the pushed list).
  useLive(d ? `/live/slots/${d.cid}` : null, (e) => { if (e.type === 'slots') void load(); }, () => void load());

  if (!d) return <View style={{ flex: 1, backgroundColor: colors.sun, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.ink} /></View>;

  const days = d.slots.map((s, i) => slotDay(s.date, i));
  const di = d.slots.findIndex((s) => s.date === pick.date);
  const day = di >= 0 ? d.slots[di] : undefined;
  const currentDate = berlinDate(d.startsAt);
  const isCurrent = (date: string, t: string) => date === currentDate && t === d.time;
  const fits = (s: DaySlots, t: string) => fitAt(s, t) >= d.dur && !isCurrent(s.date, t);
  const chosen = !!day && !!pick.time && fits(day, pick.time);
  const direct = d.side === 'customer' && d.status === 'pending';
  const tooLate = d.side === 'customer' && d.status === 'confirmed' && d.startsAt - Date.now() / 1000 < FREE_CHANGE_HOURS * 3600;
  const blocked = d.left <= 0 ? 'This booking was already moved 3 times. Cancel it and book again instead.'
    : tooLate ? `You can change the time up to ${FREE_CHANGE_HOURS} hours before. Send ${d.other} a message instead.`
      : d.resched && d.resched.by !== d.side ? `${d.other} suggested ${d.resched.day} · ${d.resched.time}. Answer that suggestion first.`
        : null;
  const label = !chosen ? 'Pick a new time' : direct ? 'Move request' : d.side === 'customer' ? `Ask ${d.other} to move it` : 'Suggest this time';

  const submit = async () => {
    if (!chosen || busy) return;
    setBusy(true);
    try {
      const r = await api<{ moved: boolean; full: string }>('POST', `/bookings/${d.id}/reschedule`, { date: pick.date, time: pick.time });
      showToast(r.moved ? `Request moved to ${r.full}.` : `Suggested ${r.full}. We’ll let you know when ${d.other} answers.`);
      void useStore.getState().refresh();
      router.back();
    } catch (e) {
      showToast((e as Error).message);
      setPick((p) => ({ ...p, time: null }));
      void load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.sun }}>
      <Row style={{ paddingTop: top, paddingHorizontal: 16, gap: 10 }}>
        <CircleButton icon="x" label="Close" iconSize={19} onPress={() => router.back()} />
        <Txt size={16} weight={700} style={{ flex: 1 }}>{d.side === 'customer' ? 'Change time' : 'Suggest another time'}</Txt>
      </Row>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingTop: 18 }}>
        <Box shadow={4} style={{ padding: 14, borderRadius: 18, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 22 }}>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: colors.blush, alignItems: 'center', justifyContent: 'center' }}><Icon name={AM[d.act].icon} size={20} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt size={15} weight={700}>{AM[d.act].label} · {hours(d.dur)}</Txt>
            <Txt size={13} color={colors.gray600}>Now {d.day} · {d.time} · with {d.other}</Txt>
          </View>
        </Box>
        {blocked ? (
          <Row style={{ gap: 10, padding: 16, borderRadius: 16, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, alignItems: 'flex-start' }}>
            <Icon name="info" size={18} />
            <Txt size={14} lh={1.5} style={{ flex: 1 }}>{blocked}</Txt>
          </Row>
        ) : (
          <>
            <StepTitle title="Pick a new time" sub={`Same length (${hours(d.dur)}), Berlin time. Times that are too short are crossed out.`} />
            <Row style={{ gap: 6 }}>
              {days.map((x, i) => {
                const open = d.slots[i].times.some((t) => fits(d.slots[i], t));
                const on = pick.date === x.date;
                return (
                  <Pressable key={x.date} accessibilityRole="button" accessibilityLabel={x.full} accessibilityState={{ selected: on, disabled: !open }} onPress={() => open && setPick({ date: x.date, time: null })} style={{ flex: 1, alignItems: 'center', gap: 4, paddingTop: 10, paddingBottom: 8, borderRadius: 14, borderWidth: 1, borderColor: colors.ink, backgroundColor: on ? colors.ink : open ? colors.white : 'transparent' }}>
                    <Txt size={11} weight={500} color={on ? colors.white : open ? colors.ink : colors.gray400} numberOfLines={1}>{x.label}</Txt>
                    <Txt size={18} weight={700} color={on ? colors.white : open ? colors.ink : colors.gray400}>{x.n}</Txt>
                    <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: open ? (on ? colors.sun : colors.green) : 'transparent' }} />
                  </Pressable>
                );
              })}
            </Row>
            {day ? (
              <>
                <Txt size={14} weight={600} style={{ marginTop: 24, marginBottom: 10 }}>Available times</Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {TIMES.map((t) => {
                    const now = isCurrent(day.date, t);
                    const open = fits(day, t);
                    const on = pick.time === t;
                    return (
                      <Pressable key={t} accessibilityRole="button" accessibilityLabel={now ? `${t}, current time` : t} accessibilityState={{ selected: on, disabled: !open }} onPress={() => open && setPick((p) => ({ ...p, time: t }))} style={{ width: '22.5%', flexGrow: 1, height: 46, borderRadius: 12, borderWidth: now ? 2 : 1, borderStyle: now ? 'dashed' : 'solid', borderColor: on || open || now ? colors.ink : colors.butter, backgroundColor: on ? colors.ink : open ? colors.white : colors.butter, alignItems: 'center', justifyContent: 'center' }}>
                        <Txt size={14} weight={600} color={on ? colors.white : open || now ? colors.ink : colors.gray350} style={!open && !now ? { textDecorationLine: 'line-through' } : null}>{t}</Txt>
                        {now ? <Txt size={9.5} weight={600} color={colors.gray600}>Now</Txt> : null}
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
      </ScrollView>
      <View style={{ paddingTop: 14, paddingHorizontal: 20, paddingBottom: Math.max(30, insets.bottom + 8), backgroundColor: colors.white, borderTopWidth: 2, borderTopColor: colors.ink, gap: 10 }}>
        {!blocked ? (
          <Txt size={12} lh={1.45} color={colors.gray600}>
            {direct ? `${d.other} hasn’t answered yet, so your request simply moves.` : `${d.other} has to agree. Until then it stays on ${d.day} · ${d.time}.`}
          </Txt>
        ) : null}
        <PrimaryButton label={busy ? 'Sending…' : label} dim={!chosen || busy || !!blocked} onPress={() => void submit()} />
      </View>
    </View>
  );
}

/** Berlin date (YYYY-MM-DD) of a unix time, as the API's open-times list uses. */
const berlinDate = (unix: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(unix * 1000));
