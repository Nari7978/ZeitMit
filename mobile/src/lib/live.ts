// Live updates from the API over a WebSocket (backend/src/lib/live.ts). Reconnects when the connection drops,
// closes while the app is in the background and reconnects when it's back.
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { wsUrl } from '../api';

export type LiveEvent = { type: string; [k: string]: unknown };

/**
 * Listens to a live room while the component is mounted (`path` null = not now). `onOpen` runs on every
 * (re)connect, so the caller can reload what it may have missed. Returns a ref that is true while connected.
 */
export function useLive(path: string | null, onEvent: (e: LiveEvent) => void, onOpen?: () => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const opened = useRef(onOpen);
  opened.current = onOpen;
  const connected = useRef(false);

  useEffect(() => {
    if (!path) return;
    let sock: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    let tries = 0;

    const connect = () => {
      clearTimeout(retry);
      if (sock || AppState.currentState === 'background') return;
      const s = new WebSocket(wsUrl(path));
      sock = s;
      s.onopen = () => {
        tries = 0;
        connected.current = true;
        // Mobile networks drop quiet connections; the server answers pings without waking up.
        ping = setInterval(() => { try { s.send('ping'); } catch { /* reconnects on close */ } }, 25000);
        opened.current?.();
      };
      s.onmessage = (m) => {
        if (m.data === 'pong') return;
        try {
          handler.current(JSON.parse(String(m.data)) as LiveEvent);
        } catch {
          // Not for us.
        }
      };
      s.onclose = () => {
        clearInterval(ping);
        if (sock !== s) return; // closed on purpose
        sock = null;
        connected.current = false;
        retry = setTimeout(connect, Math.min(30000, 1000 * 2 ** tries++));
      };
    };
    const disconnect = () => {
      clearTimeout(retry);
      clearInterval(ping);
      const s = sock;
      sock = null;
      connected.current = false;
      s?.close();
    };

    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') connect();
      else if (st === 'background') disconnect();
    });
    connect();
    return () => { sub.remove(); disconnect(); };
  }, [path]);

  return connected;
}
