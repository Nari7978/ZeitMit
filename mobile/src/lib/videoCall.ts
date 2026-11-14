// A video date: the video goes straight between the two phones (WebRTC); the server's call room only passes the setup
// between them and notes who is there when (the payment is settled from that after the booked end).
//
// Who starts: whoever joins while the other is already there sends the offer, so there's never a clash. A dropped
// connection to the server doesn't end a call that's still flowing; a phone that comes back fresh offers again.
import { useEffect, useRef, useState } from 'react';
import { api, wsUrl } from '../api';
import { callAudio, candidate, description, newPeer, openMedia, tuneVideo, type IceServer, type Peer, type Stream } from './rtc';

export type CallInfo = {
  bookingId: string; side: 'customer' | 'companion'; peer: string; peerId: string;
  startsAt: number; endsAt: number; iceServers: IceServer[];
  /** Seconds after which whoever waits alone for the other can leave without losing anything. */
  wait: number;
};
/** starting → waiting (alone) / connecting → live ⇄ reconnecting; left: they hung up (and may come back). */
export type Phase = 'starting' | 'waiting' | 'connecting' | 'live' | 'reconnecting' | 'left' | 'ended' | 'error' | 'denied';
/** Peer connection events (react-native-webrtc's types leave out the methods it has at runtime, like browsers). */
const listen = <E>(pc: Peer, type: string, fn: (e: E) => void) =>
  (pc as unknown as { addEventListener(t: string, f: (e: E) => void): void }).addEventListener(type, fn);
type Signal = { description?: { type: string; sdp?: string }; candidate?: object; session?: string; cam?: boolean; mic?: boolean };
type Side = CallInfo['side'];
type Msg = { type: string; peer?: boolean; bye?: boolean; data?: Signal; pingIn?: number; pingsLeft?: number; covered?: Side | null };
/** Pinging the other person while you wait: from when it can go out (this phone's clock, unix) and how many are left. */
export type PingState = { at: number; left: number };

export function useVideoCall(bookingId: string) {
  const [info, setInfo] = useState<CallInfo | null>(null);
  const [phase, setPhase] = useState<Phase>('starting');
  const [error, setError] = useState('');
  const [local, setLocal] = useState<Stream | null>(null);
  const [remote, setRemote] = useState<Stream | null>(null);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [peerCamOff, setPeerCamOff] = useState(false);
  const [peerMuted, setPeerMuted] = useState(false);
  /** The video has been connected at some point (for "How did it go?" at the end). */
  const [wasLive, setWasLive] = useState(false);
  /** Since when (this phone's clock, unix) you've been in the call without the other person. */
  const [aloneSince, setAloneSince] = useState<number | null>(null);
  /**
   * Who had already waited long enough for the other when you came in (the server says; it holds until you're
   * together): you, so leaving costs you nothing, or them, so this time counts against you.
   */
  const [covered, setCovered] = useState<Side | null>(null);
  const [ping, setPing] = useState<PingState>({ at: 0, left: 1 });
  const r = useRef({
    pc: null as Peer | null, ws: null as WebSocket | null, stream: null as Stream | null, info: null as CallInfo | null,
    /** Our offer's id (offerer) or the one we answered: setup for any other session is old. */
    session: '', offerer: false,
    /** Their network addresses that came before their description, and ours before we sent our description. */
    pending: [] as object[], outbox: [] as object[], described: false,
    muted: false, camOff: false, done: false, retry: undefined as ReturnType<typeof setTimeout> | undefined,
  });

  /** Ends our side of the call (set by the effect below, which owns the connection). */
  const stopRef = useRef<(p: 'ended' | null) => void>(() => {});

  useEffect(() => {
    const c = r.current;
    let alive = true;
    const send = (m: object) => { if (c.ws?.readyState === 1) c.ws.send(JSON.stringify(m)); };
    const shareState = () => send({ type: 'signal', data: { cam: !c.camOff, mic: !c.muted } });
    const connected = () => c.pc?.connectionState === 'connected';

    const closePeer = () => {
      const pc = c.pc;
      c.pc = null;
      if (pc) try { pc.close(); } catch { /* closed */ }
      setRemote(null);
    };
    const makePeer = (session: string) => {
      closePeer();
      const pc = newPeer(c.info!.iceServers);
      Object.assign(c, { pc, session, pending: [], outbox: [], described: false });
      for (const t of c.stream!.getTracks()) pc.addTrack(t, c.stream!);
      listen<{ candidate?: object | null }>(pc, 'icecandidate', (e) => {
        if (!e.candidate || c.pc !== pc) return;
        const m = { type: 'signal', data: { candidate: e.candidate, session } };
        if (c.described) send(m); else c.outbox.push(m);
      });
      listen<{ streams?: readonly Stream[] }>(pc, 'track', (e) => { if (c.pc === pc && e.streams?.[0]) setRemote(e.streams[0]); });
      listen(pc, 'connectionstatechange', () => {
        if (c.pc !== pc || c.done) return;
        const s = pc.connectionState;
        if (s === 'connected') { setPhase('live'); setWasLive(true); send({ type: 'media', on: true }); shareState(); void tuneVideo(pc); }
        else if (s === 'disconnected' || s === 'failed') {
          setPhase('reconnecting');
          send({ type: 'media', on: false });
          if (s === 'failed' && c.offerer) void offer(); // try again with a fresh connection
        }
      });
      return pc;
    };
    const describe = (pc: Peer) => {
      send({ type: 'signal', data: { description: pc.localDescription, session: c.session } });
      c.described = true;
      for (const m of c.outbox.splice(0)) send(m);
    };
    const offer = async () => {
      c.offerer = true;
      const pc = makePeer(Math.random().toString(36).slice(2));
      setPhase('connecting');
      await pc.setLocalDescription(await pc.createOffer({}));
      if (c.pc === pc) describe(pc);
    };
    const onSignal = async (d: Signal) => {
      if (typeof d.cam === 'boolean') setPeerCamOff(!d.cam);
      if (typeof d.mic === 'boolean') setPeerMuted(!d.mic);
      if (d.description?.type === 'offer' && d.session) {
        // They joined (or came back): a fresh connection for their offer.
        c.offerer = false;
        const pc = makePeer(d.session);
        setPhase('connecting');
        await pc.setRemoteDescription(description(d.description));
        await pc.setLocalDescription(await pc.createAnswer());
        if (c.pc !== pc) return;
        describe(pc);
        for (const x of c.pending.splice(0)) await pc.addIceCandidate(candidate(x)).catch(() => {});
      } else if (d.description?.type === 'answer') {
        if (!c.pc || d.session !== c.session) return; // the answer to an older offer
        await c.pc.setRemoteDescription(description(d.description));
        for (const x of c.pending.splice(0)) await c.pc.addIceCandidate(candidate(x)).catch(() => {});
      } else if (d.candidate && d.session === c.session && c.pc) {
        if (!c.pc.remoteDescription) c.pending.push(d.candidate);
        else await c.pc.addIceCandidate(candidate(d.candidate)).catch(() => {});
      }
    };
    const onMessage = async (m: Msg) => {
      if (m.type === 'hello') {
        setCovered(m.peer ? null : m.covered ?? null);
        // Joining alone has just rung them: the next ping can go out a little later.
        if (typeof m.pingIn === 'number') setPing({ at: Date.now() / 1000 + m.pingIn, left: m.pingsLeft ?? 1 });
        if (connected()) { send({ type: 'media', on: true }); return; } // back on the server; the video never stopped
        if (m.peer) await offer(); else setPhase('waiting');
      } else if (m.type === 'peer-joined') {
        setCovered(null); // together again: nothing is held against anyone
        if (!connected()) setPhase('connecting'); // they send the offer
      } else if (m.type === 'signal') {
        await onSignal(m.data ?? {});
      } else if (m.type === 'peer-left') {
        if (m.bye) { closePeer(); setPhase('left'); } else if (!connected()) setPhase('left');
      } else if (m.type === 'ended') {
        stop('ended');
      } else if (m.type === 'replaced') {
        stop('error', 'You joined this video date on another device.');
      }
    };
    const connect = () => {
      if (c.done) return;
      const ws = new WebSocket(wsUrl(`/calls/${bookingId}/ws`));
      c.ws = ws;
      ws.onmessage = (e) => {
        let m: Msg;
        try { m = JSON.parse(String(e.data)); } catch { return; }
        void onMessage(m).catch(() => {});
      };
      ws.onclose = () => { if (c.ws === ws && !c.done) c.retry = setTimeout(connect, 2000); };
    };
    const stop = (p: Phase | null, msg = '') => {
      if (c.done) return;
      c.done = true;
      clearTimeout(c.retry);
      send({ type: 'bye' });
      try { c.ws?.close(); } catch { /* closed */ }
      closePeer();
      for (const t of c.stream?.getTracks() ?? []) t.stop();
      callAudio.stop();
      if (p) { setPhase(p); setError(msg); }
    };
    stopRef.current = stop;

    void (async () => {
      let joined: CallInfo;
      try {
        joined = await api<CallInfo>('POST', `/calls/${bookingId}`);
      } catch (e) {
        if (alive) { setError((e as Error).message); setPhase('error'); }
        return;
      }
      if (!alive) return;
      c.info = joined;
      setInfo(joined);
      try {
        c.stream = await openMedia();
      } catch {
        if (alive) setPhase('denied');
        return;
      }
      if (!alive) { for (const t of c.stream.getTracks()) t.stop(); return; }
      setLocal(c.stream);
      callAudio.start();
      connect();
    })();
    return () => { alive = false; stop(null); };
  }, [bookingId]);

  const setTracks = (kind: 'audio' | 'video', on: boolean) => {
    const s = r.current.stream;
    for (const t of (kind === 'audio' ? s?.getAudioTracks() : s?.getVideoTracks()) ?? []) t.enabled = on;
  };
  const tell = () => { if (r.current.ws?.readyState === 1) r.current.ws.send(JSON.stringify({ type: 'signal', data: { cam: !r.current.camOff, mic: !r.current.muted } })); };

  // Waiting alone (they haven't come, or left): the clock for leaving without losing anything starts. Back together
  // (or connecting with them), it stops.
  useEffect(() => {
    if (phase === 'waiting' || phase === 'left') setAloneSince((s) => s ?? Date.now() / 1000);
    else if (phase === 'connecting' || phase === 'live' || phase === 'reconnecting') setAloneSince(null);
  }, [phase]);

  return {
    info, phase, error, local, remote, muted, camOff, peerCamOff, peerMuted, wasLive, aloneSince, covered, ping,
    /** Rings the other person's phone again (they aren't in the call); throws with the reason when it can't. */
    async sendPing() {
      const res = await api<{ pingIn: number; pingsLeft: number }>('POST', `/calls/${bookingId}/ping`);
      setPing({ at: Date.now() / 1000 + res.pingIn, left: res.pingsLeft });
    },
    toggleMute() { r.current.muted = !r.current.muted; setTracks('audio', !r.current.muted); setMuted(r.current.muted); tell(); },
    toggleCamera() { r.current.camOff = !r.current.camOff; setTracks('video', !r.current.camOff); setCamOff(r.current.camOff); tell(); },
    /** Leaves the call; the other side is told at once. */
    hangUp() { stopRef.current(null); },
  };
}
