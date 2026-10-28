// App state backed by the ZeitMit API. Navigation (which screen is open) lives in Expo Router;
// everything else lives here. Actions show a toast and return false when a request fails.
import { create } from 'zustand';
import { api, ApiError, setUnauthorizedHandler, tokenStore } from './api';
import { pickAndUpload } from './lib/photos';
import { askLocation, currentLocation } from './lib/location';
import { runCheckout } from './lib/checkout';
import { resolveLang, setLang } from './i18n';
import { berlinWeekday, eur, firstOpen, type ActId, type BookingStatus, type BTab, type Companion, type SORT, type Tone } from './data';

export type Filters = {
  type: 'all' | 'date';
  acts: ActId[];
  when: 'any' | 'today' | 'tomorrow' | 'weekend';
  max: number;
  langs: string[];
  rating: number;
  pref: 'any' | 'w' | 'm' | 'nb';
  lgbtq: boolean;
};
export const EMPTY_FILTERS: Filters = { type: 'all', acts: [], when: 'any', max: 60, langs: [], rating: 0, pref: 'any', lgbtq: false };

export type Pay = 'held' | 'released' | 'refunded';
export type Booking = {
  id: string; cid: string; companionName: string; hue: number; photoUrl?: string | null; creditUsed?: number; act: ActId; startsAt: number; day: string; time: string; full: string;
  dur: number; place: string; note?: string; status: BookingStatus; pay: Pay; total: number; otp?: string; reviewed: boolean;
};
export type Convo = {
  id: string; cid: string; customerId: string; name: string; hue: number; photoUrl?: string | null; bookingId: string | null; act: ActId | null; startsAt: number | null;
  status: BookingStatus | 'none'; last: { me: boolean; t: string } | null; lastAt: number; unread: number;
};
export type Notif = { id: string; icon: string; tone: Tone; title: string; body: string; go: string; read: number; created_at: number };
export type CompBooking = {
  id: string; who: string; customerId: string; avatarUrl?: string | null; act: ActId; startsAt: number; day: string; time: string; full: string;
  dur: number; place: string; note: string; status: BookingStatus; pay: Pay; payout: number;
};
export type SheetKind =
  | 'filter' | 'sort' | 'city' | 'chatmenu' | 'report' | 'review' | 'edit' | 'saved' | 'gift'
  | 'safety' | 'sos' | 'otp' | 'otpin' | 'delete' | 'redeem';
export type SortKey = keyof typeof SORT;
export type Prefs = {
  pushMessages: boolean; pushBookings: boolean; emailUpdates: boolean; marketing: boolean;
  showOnline: boolean; readReceipts: boolean; discoveryPref: 'any' | 'w' | 'm' | 'nb'; discoveryMaxRate: number;
};
export type Lang = 'auto' | 'en' | 'de';
export type User = {
  id: string; email: string; name: string; first: string; bio: string; ageConfirmed: boolean; createdAt: number;
  avatarUrl: string | null; credit: number; prefs: Prefs; language: Lang;
  /** ID check needed before the first booking. */
  idStatus: IdStatus; idNote: string | null;
};
export type IdStatus = 'none' | 'pending' | 'approved' | 'rejected';
export type CompanionStatus = 'none' | 'pending' | 'approved' | 'rejected';

export type NewBooking = { cid: string; act: ActId; date: string; time: string; dur: number; place: string; note: string; boundariesAgreed: boolean };
export type CompanionApplication = {
  name: string; showAge: boolean; about: string; interests: string[]; acts: ActId[]; ok: string[]; langs: string[];
  rate: number; days: string[]; wins: string[]; adult: boolean; rules: boolean; idPhotoId?: string; photoId?: string; tagline?: string;
  levels?: Record<string, string>; area?: string;
};

type State = {
  session: 'loading' | 'out' | 'in';
  user: User | null;
  companionStatus: CompanionStatus;
  companions: Companion[];
  byId: Record<string, Companion>;
  loading: boolean;
  saved: string[]; bump: string | null; city: string;
  query: string; f: Filters; sort: SortKey;
  btab: BTab;
  bookings: Booking[];
  convos: Convo[];
  compConvos: Convo[];
  notifs: Notif[];
  toast: string | null;
  comp: { requests: CompBooking[]; upcoming: CompBooking[]; done: CompBooking[]; earnings: { held: number; released: number; releasedCount: number }; rate: number; acts: ActId[]; avail: string[] };
  edit: { name: string; bio: string } | null;
  review: { bid: string | null; stars: number; text: string };
  reportReason: string | null;
  /** User the report / block sheet refers to. */
  reportTarget: string | null;
  /** Conversation the chat menu refers to. */
  sheetChat: string | null;
  sheet: SheetKind | null;
  otpFor: string | null;
  otpIn: { uid: string | null; val: string; err: boolean; done: boolean; busy: boolean };
  gift: { amt: number; to: string; msg: string; done: boolean; code?: string };
  checkin: { id: string; name: string; next: string } | null;
  /** A booking waiting for its card payment (Stripe Checkout). */
  pendingCheckout: { key: string; id: string; url: string } | null;
  safety: { bid: string | null; share: boolean; every: number; contactName: string; contactPhone: string };
};

type Actions = {
  set: (patch: Partial<State>) => void;
  showToast: (msg: string) => void;
  boot: () => Promise<void>;
  requestCode: (email: string) => Promise<{ ok: boolean; devCode?: string }>;
  verifyCode: (email: string, code: string) => Promise<{ ok: boolean; isNew?: boolean }>;
  finishSignup: (name: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  loadCompanionSide: () => Promise<void>;
  toggleSave: (id: string) => void;
  setF: (patch: Partial<Filters>) => void;
  clearAll: () => void;
  openSheet: (sheet: SheetKind, patch?: Partial<State>) => void;
  closeSheet: () => void;
  addBooking: (b: NewBooking) => Promise<Booking | null>;
  cancelBooking: (id: string) => Promise<boolean>;
  openConversation: (cid: string) => Promise<string | null>;
  markConvoRead: (id: string) => void;
  readNotif: (id: string) => void;
  markAllRead: () => void;
  submitReview: () => Promise<void>;
  acceptRequest: (id: string) => Promise<void>;
  declineRequest: (id: string) => Promise<void>;
  verifyOtp: () => Promise<void>;
  submitCompanion: (a: CompanionApplication) => Promise<boolean>;
  submitVerification: (idPhotoId: string, selfiePhotoId: string) => Promise<boolean>;
  setAvail: (day: string, win: string, on: boolean) => void;
  setListing: (patch: { rate?: number; acts?: ActId[] }) => void;
  startCheckin: () => Promise<void>;
  checkinOk: () => Promise<void>;
  endCheckin: () => Promise<void>;
  sos: () => Promise<void>;
  sendLocation: () => Promise<void>;
  sendGift: () => Promise<void>;
  saveEdit: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  report: () => Promise<void>;
  block: (targetId: string) => Promise<boolean>;
  uploadAvatar: (source: 'library' | 'camera') => Promise<void>;
  savePrefs: (patch: Partial<Prefs>) => void;
  setLanguage: (lang: Lang) => void;
  redeemGift: (code: string) => Promise<boolean>;
  setPushToken: (token: string | null) => void;
};

export const priceOf = (b: Pick<Booking, 'total'>) => b.total / 100;

const EMPTY_COMP: State['comp'] = { requests: [], upcoming: [], done: [], earnings: { held: 0, released: 0, releasedCount: 0 }, rate: 25, acts: [], avail: [] };

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let bumpTimer: ReturnType<typeof setTimeout> | undefined;
let listingTimer: ReturnType<typeof setTimeout> | undefined;

const msg = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');

type MeResponse = { id: string; email: string; name: string; bio: string; age_confirmed: number; created_at: number; companionStatus: CompanionStatus; saved: string[]; avatarUrl: string | null; credit: number; prefs: Prefs; language: Lang; idStatus: IdStatus; idNote: string | null };

export const useStore = create<State & Actions>()((set, get) => {
  /** Runs a request, toasting the error on failure. */
  async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (e) {
      get().showToast(msg(e));
      return undefined;
    }
  }

  const applyMe = (me: MeResponse) => {
    setLang(resolveLang(me.language));
    // Discovery preferences pre-fill the search filters (until the user changes them).
    const f = get().f;
    if (f === EMPTY_FILTERS && me.prefs && (me.prefs.discoveryPref !== 'any' || me.prefs.discoveryMaxRate < 60)) {
      set({ f: { ...EMPTY_FILTERS, pref: me.prefs.discoveryPref, max: me.prefs.discoveryMaxRate } });
    }
    set({
      user: {
        id: me.id, email: me.email, name: me.name, first: (me.name || me.email.split('@')[0]).split(' ')[0], bio: me.bio, ageConfirmed: !!me.age_confirmed,
        createdAt: me.created_at, avatarUrl: me.avatarUrl, credit: me.credit, prefs: me.prefs, language: me.language, idStatus: me.idStatus ?? 'none', idNote: me.idNote ?? null,
      },
      companionStatus: me.companionStatus,
      saved: me.saved,
    });
  };

  return {
    session: 'loading', user: null, companionStatus: 'none',
    companions: [], byId: {}, loading: true,
    saved: [], bump: null, city: 'Berlin',
    query: '', f: EMPTY_FILTERS, sort: 'recommended',
    btab: 'upcoming',
    bookings: [], convos: [], compConvos: [], notifs: [],
    toast: null,
    comp: EMPTY_COMP,
    edit: null,
    review: { bid: null, stars: 5, text: '' },
    reportReason: null, reportTarget: null, sheetChat: null,
    sheet: null,
    otpFor: null, otpIn: { uid: null, val: '', err: false, done: false, busy: false },
    gift: { amt: 100, to: '', msg: '', done: false },
    checkin: null,
    pendingCheckout: null,
    safety: { bid: null, share: true, every: 30, contactName: '', contactPhone: '' },

    set: (patch) => set(patch),
    showToast: (m) => {
      clearTimeout(toastTimer);
      set({ toast: m });
      toastTimer = setTimeout(() => set({ toast: null }), 2600);
    },

    // ---------- session ----------
    boot: async () => {
      setUnauthorizedHandler(() => { void get().logout(); });
      const t = await tokenStore.load();
      if (!t) return set({ session: 'out' });
      try {
        applyMe(await api<MeResponse>('GET', '/me'));
        set({ session: 'in' });
        await get().refresh();
      } catch (e) {
        // Offline: keep the session and let the screens retry; expired: log out.
        if (e instanceof ApiError && e.status === 401) await get().logout();
        else set({ session: 'in' });
      }
    },
    requestCode: async (email) => {
      const r = await attempt(() => api<{ sent: boolean; devCode?: string }>('POST', '/auth/request-code', { email }));
      return r ? { ok: true, devCode: r.devCode } : { ok: false };
    },
    verifyCode: async (email, code) => {
      const r = await attempt(() => api<{ token: string; isNew: boolean }>('POST', '/auth/verify', { email, code }));
      if (!r) return { ok: false };
      await tokenStore.save(r.token);
      const me = await attempt(() => api<MeResponse>('GET', '/me'));
      if (!me) return { ok: false };
      applyMe(me);
      const needsProfile = !me.name || !me.age_confirmed;
      if (!needsProfile) {
        set({ session: 'in' });
        void get().refresh();
      }
      return { ok: true, isNew: needsProfile };
    },
    finishSignup: async (name) => {
      const ok = await attempt(() => api('PATCH', '/me', { name: name.trim(), ageConfirmed: true }));
      if (!ok) return false;
      applyMe(await api<MeResponse>('GET', '/me'));
      set({ session: 'in' });
      void get().refresh();
      return true;
    },
    logout: async () => {
      // Stop pushes to this phone before forgetting the session.
      if (tokenStore.get()) await api('PATCH', '/me', { pushToken: null }).catch(() => {});
      await tokenStore.save(null);
      set({ session: 'out', user: null, bookings: [], convos: [], compConvos: [], notifs: [], saved: [], comp: EMPTY_COMP, companionStatus: 'none', checkin: null, sheet: null });
    },

    refresh: async () => {
      const [list, me, bookings, convos, notifs] = await Promise.allSettled([
        api<Companion[]>('GET', '/companions'),
        api<MeResponse>('GET', '/me'),
        api<Booking[]>('GET', '/bookings'),
        api<Convo[]>('GET', '/conversations'),
        api<Notif[]>('GET', '/me/notifications'),
      ]);
      if (list.status === 'fulfilled') set({ companions: list.value, byId: Object.fromEntries(list.value.map((c) => [c.id, c])), loading: false });
      else if (get().loading) get().showToast(msg(list.reason));
      if (me.status === 'fulfilled') applyMe(me.value);
      if (bookings.status === 'fulfilled') set({ bookings: bookings.value });
      if (convos.status === 'fulfilled') set({ convos: convos.value });
      if (notifs.status === 'fulfilled') set({ notifs: notifs.value });
      if (get().companionStatus !== 'none') await get().loadCompanionSide();
    },
    loadCompanionSide: async () => {
      const [bk, profile, convos] = await Promise.allSettled([
        api<Pick<State['comp'], 'requests' | 'upcoming' | 'done' | 'earnings'>>('GET', '/companion/bookings'),
        api<Companion & { avail: string[] }>('GET', '/companion'),
        api<Convo[]>('GET', '/conversations?side=companion'),
      ]);
      set((s) => ({
        comp: {
          ...s.comp,
          ...(bk.status === 'fulfilled' ? bk.value : {}),
          ...(profile.status === 'fulfilled' && profile.value.rate ? { rate: profile.value.rate, acts: profile.value.acts, avail: profile.value.avail } : {}),
        },
        compConvos: convos.status === 'fulfilled' ? convos.value : s.compConvos,
      }));
    },

    // ---------- browse ----------
    toggleSave: (id) => {
      const was = get().saved.includes(id);
      set((s) => ({ saved: was ? s.saved.filter((x) => x !== id) : [...s.saved, id], bump: id }));
      clearTimeout(bumpTimer);
      bumpTimer = setTimeout(() => set({ bump: null }), 240);
      api(was ? 'DELETE' : 'PUT', `/me/saved/${id}`).catch((e) => {
        set((s) => ({ saved: was ? [...s.saved, id] : s.saved.filter((x) => x !== id) }));
        get().showToast(msg(e));
      });
    },
    setF: (patch) => set((s) => ({ f: { ...s.f, ...patch } })),
    clearAll: () => set({ f: EMPTY_FILTERS, query: '' }),
    openSheet: (sheet, patch) => set({ ...patch, sheet }),
    closeSheet: () => set({ sheet: null }),

    // ---------- bookings ----------
    addBooking: async (b) => {
      // Retrying after an unfinished payment reuses the same booking (its slot is held for ~30 min).
      const key = `${b.cid}|${b.act}|${b.date}|${b.time}|${b.dur}`;
      let pending = get().pendingCheckout;
      if (!pending || pending.key !== key) {
        const bk = await attempt(() => api<Booking & { checkoutUrl?: string }>('POST', '/bookings', {
          companionId: b.cid, act: b.act, date: b.date, time: b.time, dur: b.dur, place: b.place, note: b.note, boundariesAgreed: b.boundariesAgreed,
        }));
        if (!bk) return null;
        if (!bk.checkoutUrl) {
          set((s) => ({ bookings: [bk, ...s.bookings] }));
          void get().refresh();
          return bk;
        }
        pending = { key, id: bk.id, url: bk.checkoutUrl };
        set({ pendingCheckout: pending });
      }
      const outcome = await runCheckout(pending.url);
      try {
        const r = await api<{ paid: boolean; booking?: Booking }>('POST', `/bookings/${pending.id}/confirm-payment`);
        if (r.paid && r.booking) {
          set((s) => ({ pendingCheckout: null, bookings: [r.booking!, ...s.bookings.filter((x) => x.id !== r.booking!.id)] }));
          void get().refresh();
          return r.booking;
        }
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 402)) get().showToast(msg(e));
        else get().showToast(outcome === 'cancel' ? 'Payment cancelled. Your request wasn’t sent.' : 'Payment not finished yet. Tap Pay to continue.');
        return null;
      }
      get().showToast('Payment not finished yet. Tap Pay to continue.');
      return null;
    },
    cancelBooking: async (id) => {
      const r = await attempt(() => api<{ refunded: number }>('POST', `/bookings/${id}/cancel`));
      if (!r) return false;
      get().showToast('Request cancelled. ' + eur(r.refunded / 100) + ' refunded in full.');
      await get().refresh();
      return true;
    },
    submitReview: async () => {
      const { review } = get();
      const ok = await attempt(() => api('POST', `/bookings/${review.bid}/review`, { stars: review.stars, text: review.text }));
      if (!ok) return;
      set((s) => ({ sheet: null, bookings: s.bookings.map((b) => (b.id === review.bid ? { ...b, reviewed: true } : b)) }));
      get().showToast('Thanks! Your review is live.');
    },

    // ---------- chat ----------
    openConversation: async (cid) => {
      const existing = get().convos.find((c) => c.cid === cid);
      if (existing) return existing.id;
      const r = await attempt(() => api<{ id: string }>('POST', '/conversations', { companionId: cid }));
      if (!r) return null;
      void api<Convo[]>('GET', '/conversations').then((convos) => set({ convos })).catch(() => {});
      return r.id;
    },
    markConvoRead: (id) =>
      set((s) => ({
        convos: s.convos.map((c) => (c.id === id ? { ...c, unread: 0 } : c)),
        compConvos: s.compConvos.map((c) => (c.id === id ? { ...c, unread: 0 } : c)),
      })),

    // ---------- notifications ----------
    readNotif: (id) => {
      set((s) => ({ notifs: s.notifs.map((x) => (x.id === id ? { ...x, read: 1 } : x)) }));
      api('POST', '/me/notifications/read', { ids: [id] }).catch(() => {});
    },
    markAllRead: () => {
      set((s) => ({ notifs: s.notifs.map((n) => ({ ...n, read: 1 })) }));
      api('POST', '/me/notifications/read', {}).catch(() => {});
    },

    // ---------- companion side ----------
    acceptRequest: async (id) => {
      const r = get().comp.requests.find((x) => x.id === id);
      const ok = await attempt(() => api('POST', `/companion/bookings/${id}/accept`));
      if (!ok) return;
      get().showToast('Accepted. ' + (r?.who ?? 'The customer') + ' has been notified.');
      await get().loadCompanionSide();
    },
    declineRequest: async (id) => {
      const r = get().comp.requests.find((x) => x.id === id);
      const ok = await attempt(() => api('POST', `/companion/bookings/${id}/decline`));
      if (!ok) return;
      get().showToast('Declined. ' + (r?.who ?? 'The customer') + ' won’t be charged.');
      await get().loadCompanionSide();
    },
    verifyOtp: async () => {
      const { otpIn } = get();
      if (!otpIn.uid || otpIn.val.length < 4 || otpIn.busy) return;
      set({ otpIn: { ...otpIn, busy: true } });
      try {
        await api('POST', `/companion/bookings/${otpIn.uid}/verify-code`, { code: otpIn.val });
        set((s) => ({ otpIn: { ...s.otpIn, done: true, busy: false } }));
        await get().loadCompanionSide();
      } catch (e) {
        const wrong = e instanceof ApiError && e.status === 400;
        set((s) => ({ otpIn: { ...s.otpIn, err: wrong, busy: false } }));
        if (!wrong) get().showToast(msg(e));
      }
    },
    submitCompanion: async (a) => {
      const ok = await attempt(() => api('POST', '/companion/apply', a));
      if (!ok) return false;
      set({ companionStatus: 'pending', comp: { ...get().comp, rate: a.rate, acts: a.acts } });
      void get().loadCompanionSide();
      return true;
    },
    submitVerification: async (idPhotoId, selfiePhotoId) => {
      const ok = await attempt(() => api('POST', '/me/verification', { idPhotoId, selfiePhotoId }));
      if (!ok) return false;
      set((s) => ({ user: s.user ? { ...s.user, idStatus: 'pending', idNote: null } : s.user }));
      return true;
    },
    setAvail: (day, win, on) => {
      const key = day + '-' + win;
      set((s) => ({ comp: { ...s.comp, avail: on ? [...s.comp.avail, key] : s.comp.avail.filter((x) => x !== key) } }));
      api('PUT', '/companion/availability', { day, win, on }).catch((e) => {
        set((s) => ({ comp: { ...s.comp, avail: on ? s.comp.avail.filter((x) => x !== key) : [...s.comp.avail, key] } }));
        get().showToast(msg(e));
      });
    },
    setListing: (patch) => {
      set((s) => ({ comp: { ...s.comp, ...patch } }));
      clearTimeout(listingTimer);
      listingTimer = setTimeout(() => {
        const { rate, acts } = get().comp;
        api('PATCH', '/companion', { rate, acts }).catch((e) => get().showToast(msg(e)));
      }, 600);
    },

    // ---------- safety ----------
    startCheckin: async () => {
      const { bookings, safety } = get();
      const b = bookings.find((x) => x.id === safety.bid);
      if (!safety.contactName.trim() || !safety.contactPhone.trim()) return get().showToast('Add a trusted contact first.');
      const r = await attempt(() => api<{ id: string }>('POST', '/safety/checkins', {
        bookingId: safety.bid, contactName: safety.contactName, contactPhone: safety.contactPhone, share: safety.share, every: safety.every,
      }));
      if (!r) return;
      set({ sheet: null, checkin: { id: r.id, name: b?.companionName ?? 'your companion', next: safety.every ? 'in ' + safety.every + ' min' : 'at the end' } });
      if (safety.share && (await askLocation())) void get().sendLocation();
      get().showToast(`Check-in on. ${safety.contactName} will be alerted if you miss one.`);
    },
    checkinOk: async () => {
      const { checkin, safety } = get();
      if (!checkin) return;
      const loc = safety.share ? await currentLocation() : null;
      const ok = await attempt(() => api('POST', `/safety/checkins/${checkin.id}/ok`, loc ?? {}));
      if (ok) get().showToast('Thanks! Next check-in ' + (safety.every ? 'in ' + safety.every + ' min' : 'at the end') + '.');
    },
    endCheckin: async () => {
      const { checkin } = get();
      if (checkin) await api('POST', `/safety/checkins/${checkin.id}/end`).catch(() => {});
      set({ sheet: null, checkin: null });
      get().showToast('Check-in ended. Hope it was a good time!');
    },
    sendLocation: async () => {
      const { checkin, safety } = get();
      if (!checkin || !safety.share) return;
      const loc = await currentLocation();
      if (loc) await api('POST', `/safety/checkins/${checkin.id}/location`, loc).catch(() => {});
    },
    sos: async () => {
      const { checkin, safety } = get();
      if (!checkin) return;
      const loc = await currentLocation();
      const ok = await attempt(() => api('POST', `/safety/checkins/${checkin.id}/sos`, loc ?? {}));
      set({ sheet: null });
      if (ok) get().showToast(`Our safety team has your booking details and will contact ${safety.contactName || 'your trusted contact'}.`);
    },

    // ---------- account ----------
    sendGift: async () => {
      const { gift } = get();
      if (!gift.to.trim()) return;
      const r = await attempt(() => api<{ id: string; code?: string; checkoutUrl?: string }>('POST', '/gifts', { amount: gift.amt, to: gift.to, message: gift.msg }));
      if (!r) return;
      if (r.code) return set({ gift: { ...gift, done: true, code: r.code } });
      await runCheckout(r.checkoutUrl!);
      try {
        const c = await api<{ paid: boolean; code?: string }>('POST', `/gifts/${r.id}/confirm-payment`);
        if (c.paid && c.code) return set({ gift: { ...get().gift, done: true, code: c.code } });
      } catch {
        // 402: not paid
      }
      get().showToast('Payment not finished, so no gift was sent.');
    },
    saveEdit: async () => {
      const e = get().edit;
      if (!e) return;
      if (!e.name.trim()) return get().showToast('Name can’t be empty');
      const ok = await attempt(() => api('PATCH', '/me', { name: e.name.trim(), bio: e.bio }));
      if (!ok) return;
      set((s) => ({ user: s.user ? { ...s.user, name: e.name.trim(), first: e.name.trim().split(' ')[0], bio: e.bio } : s.user, sheet: null }));
      get().showToast('Profile updated');
    },
    deleteAccount: async () => {
      const ok = await attempt(() => api('DELETE', '/me'));
      if (!ok) return;
      set({ sheet: null });
      await get().logout();
      get().showToast('Account deleted. Your data is removed within 30 days.');
    },
    report: async () => {
      const { reportReason, reportTarget } = get();
      if (!reportReason || !reportTarget) return;
      const ok = await attempt(() => api('POST', '/me/reports', { targetId: reportTarget, reason: reportReason }));
      if (!ok) return;
      set({ sheet: null });
      get().showToast('Report sent. Our safety team reviews it within 24 hours.');
    },
    block: async (targetId) => {
      const ok = await attempt(() => api('POST', '/me/blocks', { targetId }));
      if (ok) get().showToast('Blocked. They can’t message or book you.');
      return !!ok;
    },
    uploadAvatar: async (source) => {
      const r = await attempt(() => pickAndUpload('avatar', source));
      if (!r) return;
      set((s) => ({ user: s.user ? { ...s.user, avatarUrl: r.url } : s.user }));
      get().showToast('Profile photo updated');
    },
    savePrefs: (patch) => {
      const prev = get().user?.prefs;
      set((s) => ({ user: s.user ? { ...s.user, prefs: { ...s.user.prefs, ...patch } } : s.user }));
      api('PATCH', '/me', { prefs: patch }).catch((e) => {
        set((s) => ({ user: s.user && prev ? { ...s.user, prefs: prev } : s.user }));
        get().showToast(msg(e));
      });
    },
    setLanguage: (lang) => {
      setLang(resolveLang(lang));
      set((s) => ({ user: s.user ? { ...s.user, language: lang } : s.user }));
      api('PATCH', '/me', { language: lang }).catch(() => {});
    },
    redeemGift: async (code) => {
      const r = await attempt(() => api<{ added: number; credit: number }>('POST', '/gifts/redeem', { code }));
      if (!r) return false;
      set((s) => ({ user: s.user ? { ...s.user, credit: r.credit } : s.user }));
      get().showToast(`${eur(r.added / 100)} added. It’s used automatically on your next booking.`);
      return true;
    },
    setPushToken: (token) => {
      api('PATCH', '/me', { pushToken: token }).catch(() => {});
    },
  };
});

// ---- derived selectors ----

export function filtered(list: Companion[], query: string, f: Filters, sort: SortKey) {
  const q = query.trim().toLowerCase();
  const today = berlinWeekday();
  const r = list.filter((c) => {
    if (q) {
      const hay = [c.name, c.area, c.tagline, 'berlin', ...c.interests, ...c.langs.map((l) => l[0]), ...c.acts].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.type === 'date' && !c.acts.some((a) => ['date', 'plusone', 'family', 'call'].includes(a))) return false;
    if (f.acts.length && !f.acts.some((a) => c.acts.includes(a))) return false;
    if (f.when === 'today' && !c.today) return false;
    if (f.when === 'tomorrow' && !c.days.includes((today + 1) % 7)) return false;
    if (f.when === 'weekend' && !(c.days.includes(5) || c.days.includes(6) || c.today)) return false;
    if (c.rate > f.max) return false;
    if (f.langs.length && !f.langs.every((l) => c.langs.some((x) => x[0] === l))) return false;
    if (f.rating && !(c.rating && c.rating >= f.rating)) return false;
    if (f.pref !== 'any' && c.g !== f.pref) return false;
    if (f.lgbtq && !c.lgbtq) return false;
    return true;
  });
  if (sort === 'price') r.sort((a, b) => a.rate - b.rate);
  if (sort === 'rating') r.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  if (sort === 'soonest') r.sort((a, b) => firstOpen(a) - firstOpen(b));
  return r;
}

export const filterCount = (f: Filters) =>
  (f.type !== 'all' ? 1 : 0) + f.acts.length + (f.when !== 'any' ? 1 : 0) + (f.max < 60 ? 1 : 0) + f.langs.length + (f.rating ? 1 : 0) + (f.pref !== 'any' ? 1 : 0) + (f.lgbtq ? 1 : 0);

export const toggleIn = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

/** Stable hue for a customer's initial avatar. */
export const hueOf = (id: string) => [...id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 360, 7);
