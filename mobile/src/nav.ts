// Navigation helpers mirroring the prototype's overlay transitions.
import { router } from 'expo-router';
import type { BTab } from './data';
import { useStore, type Filters } from './store';

export function openProfile(id: string) {
  useStore.getState().closeSheet();
  router.push({ pathname: '/profile/[id]', params: { id } });
}

export function openBooking(cid: string, day?: number) {
  router.push({ pathname: '/book/[cid]', params: day == null ? { cid } : { cid, day: String(day) } });
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

/** Message a companion, creating an empty conversation if needed. */
export async function messageCompanion(cid: string) {
  const id = await useStore.getState().openConversation(cid);
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

export function toCustomerMode() {
  useStore.setState({ sheet: null });
  router.dismissTo('/account');
}
