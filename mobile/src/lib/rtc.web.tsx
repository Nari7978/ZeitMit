// Video calls in the browser: WebRTC is built in. Same exports as rtc.tsx (phones).
import { useEffect, useRef } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

export type Stream = MediaStream;
export type Peer = RTCPeerConnection;
export type IceServer = RTCIceServer;

/** Laptops have one camera. */
export const canFlipCamera = false;

export const newPeer = (iceServers: IceServer[]): Peer => new RTCPeerConnection({ iceServers });
export const candidate = (c: object) => new RTCIceCandidate(c as RTCIceCandidateInit);
export const description = (d: object) => d as RTCSessionDescriptionInit;

/** Camera (HD, 30 frames a second) and microphone. The browser asks for permission the first time (it throws if refused). */
export async function openMedia(): Promise<Stream> {
  const s = await navigator.mediaDevices.getUserMedia({
    audio: true, video: { facingMode: 'user', width: { ideal: VIDEO.width }, height: { ideal: VIDEO.height }, frameRate: { ideal: VIDEO.fps } },
  });
  // Smooth motion over sharpness when the network is tight (browsers read this hint).
  for (const t of s.getVideoTracks()) { try { t.contentHint = 'motion'; } catch { /* older browser */ } }
  return s;
}

/** The video we send, as on phones (rtc.tsx). */
export const VIDEO = { width: 1280, height: 720, fps: 30, maxBitrate: 2_500_000 };

/** Once connected: the bitrate cap, 30 frames a second, and smooth motion over sharpness (see rtc.tsx). */
export async function tuneVideo(pc: Peer) {
  for (const s of pc.getSenders()) {
    if (s.track?.kind !== 'video') continue;
    try {
      const p = s.getParameters();
      if (!p.encodings?.length) continue;
      p.encodings[0].maxBitrate = VIDEO.maxBitrate;
      p.encodings[0].maxFramerate = VIDEO.fps;
      await s.setParameters(p);
    } catch { /* the browser's defaults */ }
    try {
      const p = s.getParameters() as RTCRtpSendParameters & { degradationPreference?: string };
      p.degradationPreference = 'maintain-framerate';
      await s.setParameters(p);
    } catch { /* the browser's default (contentHint above says the same) */ }
  }
}

export function flipCamera(_s: Stream) {
  // One camera.
}

/** A stream's video in a <video> element; your own preview is muted so you don't hear yourself. */
export function VideoView({ stream, mirror, muted, style }: { stream: Stream | null; mirror?: boolean; over?: boolean; muted?: boolean; style?: StyleProp<ViewStyle> }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v || v.srcObject === stream) return;
    v.srcObject = stream;
    void v.play().catch(() => { /* starts on the next tap */ });
  }, [stream]);
  if (!stream) return null;
  return (
    <View style={[{ overflow: 'hidden' }, style]}>
      <video
        ref={ref} autoPlay playsInline muted={muted} data-testid={muted ? 'self-video' : 'peer-video'}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', transform: mirror ? 'scaleX(-1)' : undefined }}
      />
    </View>
  );
}

export const callAudio = { start() {}, stop() {} };
