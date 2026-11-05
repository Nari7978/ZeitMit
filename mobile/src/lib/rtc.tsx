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

/** Front camera and microphone. The first time, the phone asks for permission (it throws if refused). */
export async function openMedia(): Promise<Stream> {
  return (await mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'user', width: 640, height: 480, frameRate: 24 } })) as Stream;
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
