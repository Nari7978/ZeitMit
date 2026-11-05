// The video date itself: the other person full screen, yourself in a corner, mute / camera / switch / end, report.
// Nothing is recorded; screenshots and screen recording are blocked on phones while it's open.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { allowScreenCaptureAsync, preventScreenCaptureAsync } from 'expo-screen-capture';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { useStore } from '../store';
import { goBack } from '../nav';
import { Icon } from '../ui/Icon';
import { Txt } from '../ui/primitives';
import { CircleButton, PrimaryButton, SecondaryButton } from '../ui/common';
import { canFlipCamera, flipCamera, VideoView } from '../lib/rtc';
import { useVideoCall, type Phase } from '../lib/videoCall';
import { locale, t } from '../i18n';

const NIGHT = '#101012';
const clock = (unix: number) => new Intl.DateTimeFormat(locale(), { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(unix * 1000));

export default function VideoCall() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const call = useVideoCall(id);
  const { info, phase } = call;
  // Phones: the screen stays on, and screenshots and screen recording are blocked. (Browsers keep the screen on while
  // a video plays, and can't block capture.)
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void activateKeepAwakeAsync('video-date').catch(() => {});
    void preventScreenCaptureAsync('video-date').catch(() => {});
    return () => {
      void deactivateKeepAwake('video-date').catch(() => {});
      void allowScreenCaptureAsync('video-date').catch(() => {});
    };
  }, []);
  // Once both have been on the call long enough, the server confirms the date (that releases the payment).
  const before = useRef<boolean | null>(null);
  useEffect(() => {
    if (!info) return;
    if (before.current === false && call.confirmed) {
      useStore.getState().showToast(info.side === 'customer' ? 'Your video date is confirmed. Enjoy!' : 'Video date confirmed. You’ll get paid.');
    }
    before.current = call.confirmed;
  }, [call.confirmed, info]);

  const leave = () => { call.hangUp(); goBack(); };

  if (phase === 'error' || phase === 'denied' || phase === 'ended') {
    const done = phase === 'ended';
    return (
      <View style={{ flex: 1, backgroundColor: colors.sun, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingBottom: insets.bottom, gap: 12 }}>
        <View style={{ width: 64, height: 64, borderRadius: 22, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
          <Icon name={done ? 'circle-check' : phase === 'denied' ? 'video-off' : 'video'} size={28} />
        </View>
        <Txt size={20} weight={700} align="center">{done ? 'Your video date has ended' : phase === 'denied' ? 'Camera and microphone needed' : 'Can’t join right now'}</Txt>
        <Txt size={14} lh={1.5} color={colors.gray800} align="center" style={{ maxWidth: 320 }}>
          {done
            ? call.confirmed ? 'Thanks for meeting on ZeitMit.' : 'You can see what happens next on the booking.'
            : phase === 'denied' ? 'Allow ZeitMit to use your camera and microphone in your phone’s settings, then join again.' : call.error}
        </Txt>
        <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 10 }}>
          {done && call.confirmed ? (
            <PrimaryButton label="How did it go?" icon="shield-check" height={50} radius={14} onPress={() => { goBack(); useStore.getState().openFeedback(id); }} />
          ) : null}
          {phase === 'denied' && Platform.OS !== 'web' ? <PrimaryButton label="Open settings" height={50} radius={14} onPress={() => void Linking.openSettings()} /> : null}
          <SecondaryButton label={done ? 'Done' : 'Back'} height={50} radius={14} onPress={() => goBack()} />
        </View>
      </View>
    );
  }

  const peer = info?.peer ?? '';
  const showThem = !!call.remote && !call.peerCamOff && phase === 'live';
  return (
    <View style={{ flex: 1, backgroundColor: NIGHT }}>
      <StatusBar style="light" />
      {showThem ? <VideoView stream={call.remote} style={StyleSheet.absoluteFill} /> : (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 14 }]}>
          {peer ? (
            <View style={{ width: 96, height: 96, borderRadius: 34, backgroundColor: colors.lilac, alignItems: 'center', justifyContent: 'center' }}>
              <Txt raw size={38} weight={700}>{peer.slice(0, 1).toUpperCase()}</Txt>
            </View>
          ) : null}
          <Centre phase={phase} peer={peer} endsAt={info?.endsAt} camOff={call.peerCamOff} />
        </View>
      )}
      {/* In a browser their sound plays through the video element, so it stays while the picture is hidden. */}
      {Platform.OS === 'web' && !showThem && call.remote ? <VideoView stream={call.remote} style={{ width: 1, height: 1, opacity: 0, position: 'absolute' }} /> : null}

      <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Txt raw size={18} weight={700} color={colors.white} numberOfLines={1} style={{ flexShrink: 1 }}>{peer}</Txt>
            {call.peerMuted && phase === 'live' ? <Icon name="mic-off" size={15} color={colors.white} /> : null}
            {call.confirmed ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 22, borderRadius: 11, backgroundColor: 'rgba(79,214,152,.25)' }}>
                <Icon name="check" size={12} color={colors.mint} />
                <Txt size={11} weight={700} color={colors.mint}>Confirmed</Txt>
              </View>
            ) : null}
          </View>
          {info ? <Status phase={phase} startsAt={info.startsAt} endsAt={info.endsAt} /> : null}
        </View>
        {info ? (
          <CircleButton icon="flag" label="Report" size={40} iconSize={18} bg="rgba(255,255,255,.14)" border={0} color={colors.white}
            onPress={() => useStore.getState().openSheet('report', { reportReason: null, reportTarget: info.peerId })} />
        ) : null}
      </View>

      {call.local ? (
        <View style={{ position: 'absolute', right: 16, top: insets.top + 64, width: 104, height: 148, borderRadius: 18, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,.85)', backgroundColor: '#26262A' }}>
          {call.camOff ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Icon name="video-off" size={20} color={colors.white} />
              <Txt size={11} color={colors.white}>Camera off</Txt>
            </View>
          ) : <VideoView stream={call.local} mirror over muted style={{ flex: 1 }} />}
        </View>
      ) : null}

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 26, flexDirection: 'row', justifyContent: 'center', gap: 16 }}>
        <Control icon={call.muted ? 'mic-off' : 'mic'} label={call.muted ? 'Unmute' : 'Mute'} on={call.muted} onPress={call.toggleMute} />
        <Control icon={call.camOff ? 'video-off' : 'video'} label={call.camOff ? 'Turn camera on' : 'Turn camera off'} on={call.camOff} onPress={call.toggleCamera} />
        {canFlipCamera ? <Control icon="switch-camera" label="Switch camera" onPress={() => { if (call.local) flipCamera(call.local); }} /> : null}
        <Control icon="phone-off" label="End call" danger onPress={leave} />
      </View>
    </View>
  );
}

/** What's happening, in the middle of the screen while there's no video of them. */
function Centre({ phase, peer, endsAt, camOff }: { phase: Phase; peer: string; endsAt?: number; camOff: boolean }) {
  const until = endsAt ? clock(endsAt) : '';
  const [title, sub] = phase === 'starting' ? ['', '']
    : phase === 'waiting' ? [`Waiting for ${peer}…`, `We’ve let them know you’re here. The video date runs until ${until}.`]
      : phase === 'connecting' ? ['Connecting…', '']
        : phase === 'reconnecting' ? ['Reconnecting…', 'The video comes back when the connection does.']
          : phase === 'left' ? [`${peer} left the call`, `They can join again until ${until}.`]
            : camOff ? [`${peer} turned their camera off`, ''] : ['', ''];
  if (!title) return phase === 'starting' || phase === 'connecting' ? <ActivityIndicator color={colors.white} /> : null;
  return (
    <>
      <Txt size={19} weight={700} color={colors.white} align="center">{title}</Txt>
      {sub ? <Txt size={14} lh={1.45} color="rgba(255,255,255,.75)" align="center" style={{ maxWidth: 300 }}>{sub}</Txt> : null}
      {phase === 'connecting' || phase === 'reconnecting' ? <ActivityIndicator color={colors.white} /> : null}
    </>
  );
}

/** "Until 21:00", or the minutes left near the end; its own clock so the videos don't redraw every second. */
function Status({ phase, startsAt, endsAt }: { phase: Phase; startsAt: number; endsAt: number }) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(iv);
  }, []);
  const left = Math.ceil((endsAt - now) / 60);
  const line = phase === 'starting' ? 'Starting…'
    : phase === 'reconnecting' ? 'Reconnecting…'
      : now < startsAt ? `Starts at ${clock(startsAt)}`
        : left <= 1 ? 'Less than a minute left' : left <= 15 ? `${left} min left` : `Until ${clock(endsAt)}`;
  return <Txt size={13} color="rgba(255,255,255,.8)">{line}</Txt>;
}

function Control({ icon, label, on, danger, onPress }: { icon: string; label: string; on?: boolean; danger?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t(label)} accessibilityState={on !== undefined ? { selected: on } : undefined} onPress={onPress}
      style={({ pressed }) => ({
        width: danger ? 64 : 56, height: danger ? 64 : 56, borderRadius: 32, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1,
        backgroundColor: danger ? colors.red : on ? colors.white : 'rgba(255,255,255,.16)',
      })}>
      <Icon name={icon} size={danger ? 26 : 22} color={danger ? colors.white : on ? colors.ink : colors.white} />
    </Pressable>
  );
}
