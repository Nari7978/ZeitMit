// Navigation helpers mirroring the prototype's overlay transitions.
import { router } from 'expo-router';
import type { BTab } from './data';
import { useStore, type Filters } from './store';

export function openProfile(id: string) {
  useStore.getState().closeSheet();
  router.push({ pathname: '/profile/[id]', params: { id } });
}

/** Opens the booking flow, or the one-time ID check first if the customer isn't verified yet. */
export function openBooking(cid: string, day?: number) {
  if (useStore.getState().user?.idStatus !== 'approved') return openVerify(cid);
  router.push({ pathname: '/book/[cid]', params: day == null ? { cid } : { cid, day: String(day) } });
}

export function openVerify(next?: string) {
  useStore.getState().closeSheet();
  router.push({ pathname: '/verify', params: next ? { next } : {} });
}

/** "Book again": profile with the booking flow on top. */
export function bookAgain(cid: string) {
  openProfile(cid);
  openBooking(cid);
}

export function openChat(key: string) {
  const s = useStore.getState();
  s.markConvoRead(key);
  s.closeSheet();
  router.push({ pathname: '/chat/[id]', params: { id: key } });
}

/** Chat is unlocked by a paid booking that is still pending or confirmed (or recently completed). */
export function canMessage(cid: string, s = useStore.getState()) {
  return s.convos.some((c) => c.cid === cid && c.canSend) || s.bookings.some((b) => b.cid === cid && (b.status === 'pending' || b.status === 'confirmed'));
}

/** Message a companion you've booked; otherwise explain that chat opens after booking. */
export async function messageCompanion(cid: string, name?: string) {
  const s = useStore.getState();
  if (!canMessage(cid)) {
    s.showToast(name ? `You can message ${name} once you’ve booked. Add a note to your request instead.` : 'Chat opens once you’ve booked. Add a note to your request instead.');
    return;
  }
  const id = await s.openConversation(cid);
  if (id) openChat(id);
}

/** Jump to Search with filters applied (Discover shortcuts). */
export function searchWith(patch: Partial<Filters>) {
  useStore.getState().setF(patch);
  router.navigate('/search');
}

/** Close any overlays and land on the Bookings tab. */
export function toBookings(btab: BTab) {
  useStore.setState({ btab, sheet: null });
  router.dismissTo('/bookings');
}

export function toCompanionMode() {
  useStore.setState({ sheet: null });
  router.dismissTo('/companion');
}

/** Opens the screen a notification points to: "chat:<id>", "tab:<bookings tab>", "comp:<tab>". */
export function followGo(go: string) {
  if (go.startsWith('chat:')) {
    router.dismissTo('/messages');
    openChat(go.slice(5));
  } else if (go.startsWith('tab:')) {
    toBookings(go.slice(4) as BTab);
  } else if (go === 'verify') {
    openVerify();
  } else if (go.startsWith('comp:')) {
    const tab = go.slice(5);
    useStore.setState({ sheet: null });
    router.dismissTo(tab === 'overview' ? '/companion' : (`/companion/${tab}` as '/companion'));
  }
}

export function toCustomerMode() {
  useStore.setState({ sheet: null });
  router.dismissTo('/account');
}
