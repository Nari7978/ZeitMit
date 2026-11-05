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

/** Camera and microphone. The browser asks for permission the first time (it throws if refused). */
export function openMedia(): Promise<Stream> {
  return navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } });
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
