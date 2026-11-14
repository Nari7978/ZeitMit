// Video calls on phones, with react-native-webrtc (free, open source). Browsers have the same API built in, so the web
// build uses rtc.web.tsx instead. The call logic (videoCall.ts) only uses what both share.
import type { StyleProp, ViewStyle } from 'react-native';
import { mediaDevices, MediaStream, RTCIceCandidate, RTCPeerConnection, RTCSessionDescription, RTCView } from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';

export type Stream = MediaStream;
export type Peer = RTCPeerConnection;
export type IceServer = { urls: string | string[]; username?: string; credential?: string };

/** Phones have a front and a back camera. */
export const canFlipCamera = true;

export const newPeer = (iceServers: IceServer[]): Peer => new RTCPeerConnection({ iceServers });
export const candidate = (c: object) => new RTCIceCandidate(c as ConstructorParameters<typeof RTCIceCandidate>[0]);
export const description = (d: object) => new RTCSessionDescription(d as ConstructorParameters<typeof RTCSessionDescription>[0]);

/**
 * Front camera (HD, 30 frames a second, so it stays sharp full screen) and microphone. The first time, the phone asks
 * for permission (it throws if refused).
 */
export async function openMedia(): Promise<Stream> {
  return (await mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'user', width: VIDEO.width, height: VIDEO.height, frameRate: VIDEO.fps } })) as Stream;
}

/** The video we send: HD at 30 frames a second, at most 2.5 Mbps (what full HD needs; the bandwidth estimate goes lower when the network does). */
export const VIDEO = { width: 1280, height: 720, fps: 30, maxBitrate: 2_500_000 };

/**
 * Once connected: the bitrate cap and 30 frames a second, and when the network or the phone can't keep up, the picture
 * gets a little softer while motion stays smooth (WebRTC's default lowers the frame rate too, which stutters). A
 * sender that can't take a setting keeps WebRTC's default for it.
 */
export async function tuneVideo(pc: Peer) {
  for (const s of pc.getSenders()) {
    if (s.track?.kind !== 'video') continue;
    try {
      const p = s.getParameters();
      if (!p.encodings.length) continue;
      p.encodings[0].maxBitrate = VIDEO.maxBitrate;
      p.encodings[0].maxFramerate = VIDEO.fps;
      await s.setParameters(p);
    } catch { /* WebRTC's defaults */ }
    try {
      const p = s.getParameters();
      p.degradationPreference = 'maintain-framerate';
      await s.setParameters(p);
    } catch { /* WebRTC's default */ }
  }
}

export function flipCamera(s: Stream) {
  for (const t of s.getVideoTracks()) (t as unknown as { _switchCamera(): void })._switchCamera();
}

/** A stream's video. `over`: drawn above another video (the small self-view over the other person). */
export function VideoView({ stream, mirror, over, style }: { stream: Stream | null; mirror?: boolean; over?: boolean; muted?: boolean; style?: StyleProp<ViewStyle> }) {
  if (!stream) return null;
  return <RTCView streamURL={stream.toURL()} mirror={mirror} objectFit="cover" zOrder={over ? 1 : 0} style={style} />;
}

/** Sound through the loudspeaker (or headphones when plugged in): a video call isn't held to the ear. */
export const callAudio = {
  start() { try { InCallManager.start({ media: 'video' }); } catch { /* audio stays on the default route */ } },
  stop() { try { InCallManager.stop(); } catch { /* already stopped */ } },
};
