// Free now for video dates, on the companion's Overview: a switch, for how long (1, 2 or 3 hours), and a notice when
// it switched itself off after missed requests.
import { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { colors } from '../../theme';
import { useStore } from '../../store';
import { timeOf } from '../../lib/avail';
import { Icon } from '../../ui/Icon';
import { Box, Chip, Row, Toggle, Txt } from '../../ui/primitives';
import { TextButton } from '../../ui/common';
import { nativeCalls, type CallAccess } from '../../../modules/zeitmit-calls';

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
        {on && nativeCalls.available ? <ReachChecklist /> : null}
      </Box>
    </>
  );
}

/** Phone brands that stop apps in the background unless they're allowed to start by themselves ("Autostart"). */
const STRICT_BRANDS: Record<string, string> = {
  xiaomi: 'Xiaomi', redmi: 'Xiaomi', poco: 'Xiaomi', oppo: 'Oppo', realme: 'Realme', oneplus: 'OnePlus', vivo: 'Vivo',
  iqoo: 'Vivo', huawei: 'Huawei', honor: 'Honor', meizu: 'Meizu', tecno: 'Tecno', infinix: 'Infinix',
};

/**
 * Android: what the phone needs to allow so requests ring even with the app closed (full screen on the lock screen,
 * over other apps, not stopped to save battery). Checked again whenever the app comes back from the settings.
 */
function ReachChecklist() {
  const [access, setAccess] = useState<CallAccess | null>(() => nativeCalls.access());
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') setAccess(nativeCalls.access()); });
    return () => sub.remove();
  }, []);
  if (!access) return null;
  const brand = STRICT_BRANDS[access.brand] ?? null;
  const items: { key: string; label: string; open: 'overlay' | 'fullScreen' | 'battery' | 'app' }[] = [
    ...(!access.fullScreen ? [{ key: 'fullScreen', label: 'Ring full screen on the lock screen', open: 'fullScreen' as const }] : []),
    ...(!access.overlay ? [{ key: 'overlay', label: 'Show requests over other apps', open: 'overlay' as const }] : []),
    ...(!access.battery ? [{ key: 'battery', label: 'Don’t limit ZeitMit to save battery', open: 'battery' as const }] : []),
  ];
  return (
    <View testID="reach-checklist" style={{ gap: 8, marginTop: 4, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.hairline }}>
      {items.length ? (
        <>
          <Txt size={13} weight={700}>Make sure requests reach you</Txt>
          <Txt size={12.5} lh={1.45} color={colors.gray600}>So your phone rings even when ZeitMit is closed, allow this:</Txt>
          {items.map((it) => (
            <Row key={it.key} style={{ gap: 10, alignItems: 'center' }}>
              <Icon name="circle-alert" size={16} color={colors.amberDeep} />
              <Txt size={13} style={{ flex: 1 }}>{it.label}</Txt>
              <TextButton label="Allow" size={13} weight={700} onPress={() => nativeCalls.openSettings(it.open)} style={{ paddingVertical: 6 }} />
            </Row>
          ))}
        </>
      ) : (
        <Row style={{ gap: 8 }}>
          <Icon name="circle-check" size={16} color={colors.greenDeep} />
          <Txt size={13} weight={600} color={colors.greenDeep} style={{ flex: 1 }}>Requests ring even when ZeitMit is closed</Txt>
        </Row>
      )}
      {brand ? (
        <Row style={{ gap: 10, alignItems: 'center' }}>
          <Icon name="info" size={16} color={colors.gray600} />
          <Txt size={12.5} lh={1.45} color={colors.gray600} style={{ flex: 1 }}>{`On ${brand} phones, also allow Autostart for ZeitMit.`}</Txt>
          <TextButton label="Open settings" size={13} weight={700} onPress={() => nativeCalls.openSettings('app')} style={{ paddingVertical: 6 }} />
        </Row>
      ) : null}
    </View>
  );
}
