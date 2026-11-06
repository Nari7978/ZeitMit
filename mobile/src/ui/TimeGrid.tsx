// A day's open start times (every half hour), grouped into morning, afternoon and evening, four to a row.
import { Pressable, View } from 'react-native';
import { colors } from '../theme';
import { Txt } from './primitives';
import { t as tr } from '../i18n';

const GROUPS: [string, (m: number) => boolean][] = [
  ['Morning', (m) => m < 12 * 60],
  ['Afternoon', (m) => m < 17 * 60],
  ['Evening', () => true],
];
const mins = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);

/**
 * `isOpen`: whether a time can be picked (others are crossed out, e.g. too short for a booking being moved).
 * `isNow`: the booking's current time, marked "Now" (when moving a booking).
 */
export function TimeGrid({ times, selected, onPick, isOpen = () => true, isNow = () => false }: {
  times: string[]; selected: string | null; onPick: (t: string) => void; isOpen?: (t: string) => boolean; isNow?: (t: string) => boolean;
}) {
  const left = [...times];
  const groups = GROUPS.map(([label, test]) => {
    const mine: string[] = [];
    while (left.length && test(mins(left[0]))) mine.push(left.shift()!);
    return { label, times: mine };
  }).filter((g) => g.times.length);
  return (
    <View style={{ gap: 14 }}>
      {groups.map((g) => (
        <View key={g.label} style={{ gap: 8 }}>
          <Txt size={12} weight={600} color={colors.gray600}>{g.label}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {g.times.map((t) => {
              const open = isOpen(t);
              const now = isNow(t);
              const on = selected === t;
              return (
                <Pressable
                  key={t} accessibilityRole="button" accessibilityLabel={now ? tr(`${t}, current time`) : t} accessibilityState={{ selected: on, disabled: !open }}
                  onPress={() => open && onPick(t)}
                  style={{
                    width: '22.5%', flexGrow: 1, height: 46, borderRadius: 12, borderWidth: now ? 2 : 1, borderStyle: now ? 'dashed' : 'solid',
                    borderColor: on || open || now ? colors.ink : colors.butter, backgroundColor: on ? colors.ink : open ? colors.white : colors.butter,
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Txt size={14} weight={600} color={on ? colors.white : open || now ? colors.ink : colors.gray350} style={!open && !now ? { textDecorationLine: 'line-through' } : null}>{t}</Txt>
                  {now ? <Txt size={9.5} weight={600} color={colors.gray600}>Now</Txt> : null}
                </Pressable>
              );
            })}
            {/* A short last row keeps its tiles the same width as the rest. */}
            {Array.from({ length: (4 - (g.times.length % 4)) % 4 }, (_, k) => <View key={`pad${k}`} style={{ width: '22.5%', flexGrow: 1 }} />)}
          </View>
        </View>
      ))}
    </View>
  );
}
