// Free now for video dates, on the companion's Overview: a switch, for how long (1, 2 or 3 hours), and a notice when
// it switched itself off after missed requests.
import { useState } from 'react';
import { View } from 'react-native';
import { colors } from '../../theme';
import { useStore } from '../../store';
import { timeOf } from '../../lib/avail';
import { Icon } from '../../ui/Icon';
import { Box, Chip, Row, Toggle, Txt } from '../../ui/primitives';

const hoursLabel = (h: number) => (h === 1 ? '1 hour' : `${h} hours`);

export function FreeNowCard() {
  const freeNow = useStore((s) => s.comp.freeNow);
  const offersVideo = useStore((s) => s.comp.acts.includes('call'));
  const [hours, setHours] = useState(2);
  const [busy, setBusy] = useState(false);
  if (!freeNow || !offersVideo) return null;
  const on = !!freeNow.until && freeNow.until > Date.now() / 1000;
  const { setFreeNow, showToast } = useStore.getState();
  const turn = async (h: number | null) => {
    if (busy) return;
    setBusy(true);
    const ok = await setFreeNow(h);
    setBusy(false);
    const until = useStore.getState().comp.freeNow?.until;
    if (ok && h && until) showToast(`Free now until ${timeOf(until)}`);
  };
  const pick = (h: number) => {
    setHours(h);
    if (on) void turn(h); // on already: from now for that long
  };
  return (
    <>
      {!on && freeNow.paused ? (
        <Row style={{ gap: 12, padding: 16, borderRadius: 20, backgroundColor: colors.amberSoft, alignItems: 'flex-start' }}>
          <Icon name="info" size={20} color={colors.amberDeep} style={{ marginTop: 1 }} />
          <View style={{ flex: 1, gap: 4 }}>
            <Txt size={14} weight={700} color="#5E3D08">Free now is off</Txt>
            <Txt size={13} lh={1.45} color="#7A5413">You missed 3 video date requests in a row, so customers can’t book you right now. Turn it on again when you’re ready.</Txt>
          </View>
        </Row>
      ) : null}
      <Box shadow={4} shadowColor={on ? colors.greenDeep : colors.ink} style={{ padding: 16, borderRadius: 22, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, gap: 10 }}>
        <Row style={{ gap: 12 }}>
          <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: on ? colors.mintSoft : colors.shimmerA, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="video" size={20} color={on ? colors.greenDeep : colors.gray500} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt size={15} weight={700}>Free now for video dates</Txt>
            <Txt size={13} weight={600} color={on ? colors.greenDeep : colors.gray500}>{on ? `On until ${timeOf(freeNow.until!)}` : 'Off'}</Txt>
          </View>
          <Toggle on={on} label="Free now for video dates" onPress={() => void turn(on ? null : hours)} />
        </Row>
        <Txt size={13} lh={1.45} color={colors.gray600}>Customers can start a video date with you right away. Your phone rings, and you have 2 minutes to accept.</Txt>
        <Txt size={12} color={colors.gray600}>Stay free for</Txt>
        <Row style={{ gap: 8, flexWrap: 'wrap' }}>
          {freeNow.hours.map((h) => (
            <Chip key={h} label={hoursLabel(h)} on={h === hours} height={34} size={13} onPress={() => pick(h)} />
          ))}
        </Row>
        {on ? (
          <Row style={{ gap: 8 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.green }} />
            <Txt size={13} weight={600} color={colors.greenDeep}>Your profile shows “Free now”</Txt>
          </Row>
        ) : null}
      </Box>
    </>
  );
}
