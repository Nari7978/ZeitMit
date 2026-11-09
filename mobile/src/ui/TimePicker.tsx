// Picking when to book, from a companion's free time (lib/avail.ts): the days ahead, a day's free and taken hours on
// a 24-hour bar, a start in 15-minute steps (hour, then minutes) and a length. Only what the server would accept can
// be picked; what's taken or closed shows as such.
import { Pressable, View } from 'react-native';
import { colors } from '../theme';
import { eur, lengthLabel, slotDay } from '../data';
import { timeOf, type Day, type Interval } from '../lib/avail';
import { localAt } from '../lib/dates';
import { t } from '../i18n';
import { Icon } from './Icon';
import { Row, Txt } from './primitives';

/** The days ahead as tiles; a green dot where a booking of this length can start. */
export function DayStrip({ days, selected, onPick }: { days: Day[]; selected: string | null; onPick: (date: string) => void }) {
  return (
    <Row style={{ gap: 6 }}>
      {days.map((d, i) => {
        const x = slotDay(d.date, i);
        const open = d.starts.length > 0;
        const on = selected === d.date;
        return (
          <Pressable
            key={d.date} accessibilityRole="button" accessibilityLabel={open ? x.full : t(`${x.full}, not free`)} accessibilityState={{ selected: on, disabled: !open }}
            onPress={() => open && onPick(d.date)}
            style={{ flex: 1, minWidth: 0, alignItems: 'center', gap: 4, paddingTop: 10, paddingBottom: 8, borderRadius: 14, borderWidth: 1, borderColor: colors.ink, backgroundColor: on ? colors.ink : open ? colors.white : 'transparent' }}
          >
            <Txt size={11} weight={500} color={on ? colors.white : open ? colors.ink : colors.gray400} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{x.label}</Txt>
            <Txt size={18} weight={700} color={on ? colors.white : open ? colors.ink : colors.gray400}>{x.n}</Txt>
            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: open ? (on ? colors.sun : colors.green) : 'transparent' }} />
          </Pressable>
        );
      })}
    </Row>
  );
}

/**
 * A day from midnight to midnight: free stretches in green, the rest (closed, booked, blocked or too soon) hatched,
 * the picked booking on top. Below, the free stretches as text.
 */
export function DayBar({ day, pick }: { day: Day; pick?: Interval | null }) {
  const len = day.to - day.from;
  const pos = (u: number) => `${(Math.max(0, Math.min(len, u - day.from)) / len) * 100}%` as const;
  const width = ([s, e]: Interval) => `${(Math.max(0, Math.min(e, day.to) - Math.max(s, day.from)) / len) * 100}%` as const;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ height: 22, borderRadius: 8, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.track, overflow: 'hidden' }}>
        {day.free.map((iv) => <View key={iv[0]} style={{ position: 'absolute', top: 0, bottom: 0, left: pos(iv[0]), width: width(iv), backgroundColor: colors.mint }} />)}
        {pick ? <View style={{ position: 'absolute', top: 3, bottom: 3, left: pos(pick[0]), width: width(pick), borderRadius: 4, backgroundColor: colors.ink }} /> : null}
      </View>
      <Row style={{ justifyContent: 'space-between' }}>
        {['00', '06', '12', '18', '24'].map((h) => <Txt key={h} size={10} color={colors.gray600}>{h}</Txt>)}
      </Row>
      <Row style={{ gap: 6, flexWrap: 'wrap' }}>
        {day.free.length ? day.free.map(([s, e]) => (
          <Row key={s} style={{ gap: 5, height: 26, paddingHorizontal: 10, borderRadius: 999, backgroundColor: colors.mintSoft }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.green }} />
            <Txt size={12} weight={600} color={colors.greenDeep}>{`Free ${timeOf(s, day.dst)}–${timeOf(e, day.dst)}`}</Txt>
          </Row>
        )) : <Txt size={13} color={colors.gray600}>Not free this day.</Txt>}
      </Row>
    </View>
  );
}

/** Starts grouped by the hour they're in ("18"), each hour with its quarters; on a day the clocks change, per offset. */
function hoursOf(day: Day) {
  const out: { key: string; label: string; starts: number[] }[] = [];
  for (const u of day.starts) {
    const label = timeOf(u, day.dst).replace(/:\d\d/, '');
    const last = out[out.length - 1];
    if (last && last.label === label && u - last.starts[last.starts.length - 1] <= 45 * 60) last.starts.push(u);
    else out.push({ key: String(u), label, starts: [u] });
  }
  return out;
}

/** A start in 15-minute steps: the hour first, then its minutes. Starts that can't be booked aren't offered. */
export function StartPicker({ day, value, onPick }: { day: Day; value: number | null; onPick: (u: number) => void }) {
  const hrs = hoursOf(day);
  const cur = hrs.find((h) => value !== null && h.starts.includes(value)) ?? null;
  const quarter = (u: number) => localAt(u).time.slice(3);
  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 8 }}>
        <Txt size={12} weight={600} color={colors.gray600}>Hour</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {hrs.map((h) => {
            const on = cur?.key === h.key;
            return (
              <Pressable
                key={h.key} accessibilityRole="button" accessibilityLabel={t(`From ${h.label}:00`)} accessibilityState={{ selected: on }}
                onPress={() => {
                  // Keep the minutes picked if that hour has them, else its first start.
                  const same = value !== null ? h.starts.find((u) => quarter(u) === quarter(value)) : undefined;
                  onPick(same ?? h.starts[0]);
                }}
                style={{ minWidth: 50, height: 44, paddingHorizontal: 10, borderRadius: 12, borderWidth: on ? 2 : 1, borderColor: colors.ink, backgroundColor: on ? colors.ink : colors.white, alignItems: 'center', justifyContent: 'center' }}
              >
                <Txt size={15} weight={700} color={on ? colors.white : colors.ink}>{h.label}</Txt>
              </Pressable>
            );
          })}
        </View>
      </View>
      {cur ? (
        <View style={{ gap: 8 }}>
          <Txt size={12} weight={600} color={colors.gray600}>Minutes</Txt>
          <Row style={{ gap: 8 }}>
            {['00', '15', '30', '45'].map((m) => {
              const u = cur.starts.find((x) => quarter(x) === m);
              const on = u !== undefined && u === value;
              return (
                <Pressable
                  key={m} accessibilityRole="button" accessibilityLabel={`${cur.label}:${m}`} accessibilityState={{ selected: on, disabled: u === undefined }}
                  onPress={() => u !== undefined && onPick(u)}
                  style={{ flex: 1, height: 44, borderRadius: 12, borderWidth: 1, borderColor: u === undefined ? colors.butter : colors.ink, backgroundColor: on ? colors.ink : u === undefined ? colors.butter : colors.white, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Txt size={14} weight={600} color={on ? colors.white : u === undefined ? colors.gray350 : colors.ink} style={u === undefined ? { textDecorationLine: 'line-through' } : null}>{`:${m}`}</Txt>
                </Pressable>
              );
            })}
          </Row>
        </View>
      ) : null}
    </View>
  );
}

const PRESETS = { video: [30, 45, 60, 90, 120], meet: [60, 90, 120, 180, 240] };

/**
 * The length: common ones to tap, or any in 15-minute steps from `min` up to `max` (the longest that's free from the
 * start, at most 8 hours). Longer ones are crossed out.
 */
export function LengthPicker({ video, minutes, min, max, rate, onChange }: {
  video: boolean; minutes: number | null; min: number; max: number; rate: number; onChange: (m: number) => void;
}) {
  const go = (m: number) => onChange(Math.min(max, Math.max(min, m)));
  const priceOf = (m: number) => eur(Math.round((rate * 100 * m) / 60) / 100);
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {PRESETS[video ? 'video' : 'meet'].map((m) => {
          const on = minutes === m;
          const open = m >= min && m <= max;
          return (
            <Pressable
              key={m} accessibilityRole="radio" accessibilityState={{ checked: on, disabled: !open }} onPress={() => open && onChange(m)}
              style={{ width: '30%', flexGrow: 1, gap: 3, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1.5, borderColor: open ? colors.ink : colors.butter, backgroundColor: on ? colors.butter : open ? colors.white : colors.butter }}
            >
              <Txt size={15} weight={700} color={open ? colors.ink : colors.gray350} style={!open ? { textDecorationLine: 'line-through' } : null} numberOfLines={1}>{lengthLabel(m)}</Txt>
              <Txt size={13} color={!open ? colors.gray350 : on ? colors.ink : colors.gray600}>{priceOf(m)}</Txt>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: minutes && !PRESETS[video ? 'video' : 'meet'].includes(minutes) ? colors.butter : colors.white }}>
        <StepButton icon="minus" label="15 minutes shorter" on={!!minutes && minutes > min} onPress={() => go((minutes ?? min) - 15)} />
        <View style={{ flex: 1, minWidth: 0, alignItems: 'center' }}>
          <Txt size={12} weight={600} color={colors.gray600}>Your own length</Txt>
          <Txt size={17} weight={700} numberOfLines={1}>{minutes ? lengthLabel(minutes) : '15-minute steps'}</Txt>
          {minutes ? <Txt size={14} color={colors.gray600}>{priceOf(minutes)}</Txt> : null}
        </View>
        <StepButton icon="plus" label="15 minutes longer" on={(minutes ?? 0) < max} onPress={() => go(minutes ? minutes + 15 : min)} />
      </View>
    </View>
  );
}

function StepButton({ icon, label, on, onPress }: { icon: string; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={t(label)} accessibilityState={{ disabled: !on }} disabled={!on} hitSlop={6} onPress={onPress}
      style={{ width: 44, height: 44, borderRadius: 14, borderWidth: 2, borderColor: on ? colors.ink : colors.gray350, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon name={icon} size={18} color={on ? colors.ink : colors.gray350} />
    </Pressable>
  );
}

/** "18:15–20:15", the end with "(next day)" when it's after midnight. */
export function spanText(start: number, minutes: number, dst = false) {
  const end = start + minutes * 60;
  const next = localAt(end).date !== localAt(start).date && localAt(end).time !== '00:00';
  return `${timeOf(start, dst)}–${timeOf(end, dst)}${next ? ` ${t('(next day)')}` : ''}`;
}
