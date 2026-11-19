// Video dates on Android beyond the open app (modules/zeitmit-calls): the native side's texts in the app's language,
// and what to do when the app was opened from an incoming video date (Accept / open) or something happened in a
// notification (Decline, Turn off, a request that was called off).
import { useEffect } from 'react';
import { router } from 'expo-router';
import { nativeCalls, type CallAction, type LaunchedCall } from '../../modules/zeitmit-calls';
import { useStore } from '../store';
import { endRing, showRing, useRing } from './ring';
import { markInstantHandled } from '../ui/InstantRequest';
import { syncCallTexts } from './callTexts';

/** Answers a free-now request from its notification's Accept, then opens the call. */
async function acceptFromNotification(id: string) {
  markInstantHandled(id);
  const ok = await useStore.getState().acceptRequest(id);
  if (ok) router.push(`/call/${id}`);
  else nativeCalls.lockScreen(false);
}

function handleLaunch(c: LaunchedCall) {
  if (c.kind === 'instant') {
    if (c.action === 'accept') void acceptFromNotification(c.bookingId);
    else {
      // The request shows full screen, ringing in the app. Already over: back behind the lock screen.
      void useStore.getState().loadCompanionSide().then(() => {
        const open = useStore.getState().comp.requests.some((r) => r.id === c.bookingId && (r.expiresAt ?? 0) > Date.now() / 1000);
        if (!open) nativeCalls.lockScreen(false);
      });
    }
  } else if (c.kind === 'ring') {
    if (c.action === 'accept') {
      endRing(c.bookingId, c.at);
      router.push(`/call/${c.bookingId}`);
    } else {
      showRing({ ...c });
      if (!useRing.getState().ring) nativeCalls.lockScreen(false); // it had stopped ringing meanwhile
    }
  }
}

function handleAction(e: CallAction) {
  if (e.type === 'launch') {
    const c = nativeCalls.takeAction();
    if (c) handleLaunch(c);
  } else if (e.type === 'decline' && e.bookingId) {
    if (e.kind === 'instant') {
      markInstantHandled(e.bookingId);
      void useStore.getState().loadCompanionSide();
    } else endRing(e.bookingId);
  } else if (e.type === 'callOff' && e.bookingId) {
    endRing(e.bookingId);
    void useStore.getState().loadCompanionSide();
  } else if (e.type === 'freeNowOff') {
    void useStore.getState().loadCompanionSide();
  }
}

/** While signed in: picks up the incoming video date the app was opened for, and what notifications did meanwhile. */
export function useIncomingCalls() {
  useEffect(() => {
    if (!nativeCalls.available) return;
    syncCallTexts();
    // Opened from an incoming video date: once the screens exist (like a tap on a notification).
    const launch = setTimeout(() => handleAction({ type: 'launch' }), 300);
    const sub = nativeCalls.onAction(handleAction);
    return () => { clearTimeout(launch); sub.remove(); };
  }, []);
}
