// App state: a port of the prototype's Component state + actions. Navigation
// (which overlay/screen is open) lives in Expo Router; everything else lives here.
import { create } from 'zustand';
import {
  ActId, AM, BookingStatus, BTab, C, CM, DAYS, dayOpen, eur, firstOpen, REPLIES, ROM, SORT, Tone,
} from './data';

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
  id: string; cid: string; act: ActId; day: string; time: string; dur: number; status: BookingStatus;
  place: string; pay: Pay; otp?: string; note?: string; reviewed?: boolean;
};
export type Msg = { sep: string } | { me: boolean; t: string; time: string };
export type Convo = {
  cid?: string; side?: 'comp'; name?: string; hue?: number; ctx: string;
  status: BookingStatus | 'none'; bid?: string; unread: number; msgs: Msg[];
};
export type Notif = {
  id: string; g: 'Today' | 'Yesterday' | 'Earlier'; icon: string; tone: Tone; title: string; body: string;
  time: string; read: boolean; go: string;
};
export type CompBooking = { id: string; code: string; who: string; hue: number; act: ActId; day: string; time: string; dur: number; note?: string };
export type SheetKind =
  | 'filter' | 'sort' | 'city' | 'chatmenu' | 'report' | 'review' | 'edit' | 'saved' | 'gift'
  | 'safety' | 'sos' | 'otp' | 'otpin' | 'delete';
export type SortKey = keyof typeof SORT;
export type User = { name: string; first: string; bio: string };

export type NewBooking = { cid: string; act: ActId; day: number; time: string; dur: number; place: string };

type State = {
  saved: string[]; bump: string | null; loading: boolean; city: string;
  query: string; f: Filters; sort: SortKey;
  btab: BTab;
  bookings: Booking[];
  corder: string[]; convos: Record<string, Convo>; typing: string | null;
  notifs: Notif[];
  toast: string | null;
  compStatus: 'none' | 'review';
  user: User; edit: User | null;
  review: { bid: string | null; stars: number; text: string };
  reportReason: string | null;
  requests: CompBooking[]; cUpcoming: CompBooking[]; cDone: CompBooking[];
  avail: Record<string, boolean>; cRate: number; cActs: ActId[];
  sheet: SheetKind | null;
  /** Chat the open chat-menu / report sheet refers to. */
  sheetChat: string | null;
  otpFor: string | null;
  otpIn: { uid: string | null; val: string; err: boolean; done: boolean };
  gift: { amt: number; to: string; msg: string; done: boolean };
  checkin: { name: string; next: string } | null;
  safety: { bid: string | null; share: boolean; every: number };
};

type Actions = {
  set: (patch: Partial<State>) => void;
  showToast: (msg: string) => void;
  toggleSave: (id: string) => void;
  setF: (patch: Partial<Filters>) => void;
  clearAll: () => void;
  openSheet: (sheet: SheetKind, patch?: Partial<State>) => void;
  closeSheet: () => void;
  addBooking: (b: NewBooking) => void;
  cancelBooking: (id: string) => void;
  ensureConvo: (cid: string) => void;
  markConvoRead: (key: string) => void;
  sendMsg: (key: string, text: string) => void;
  readNotif: (id: string) => void;
  markAllRead: () => void;
  submitReview: () => void;
  simulateRelease: (bid: string) => void;
  acceptRequest: (id: string) => void;
  declineRequest: (id: string) => void;
  verifyOtp: () => void;
  submitCompanion: (rate: number, acts: ActId[]) => void;
  startCheckin: () => void;
};

export const priceOf = (b: Booking) => CM[b.cid].rate * b.dur * 1.1;

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let bumpTimer: ReturnType<typeof setTimeout> | undefined;
let replyTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<State & Actions>()((set, get) => ({
  saved: ['lena', 'kai'], bump: null, loading: true, city: 'Berlin',
  query: '', f: EMPTY_FILTERS, sort: 'recommended',
  btab: 'upcoming',
  bookings: [
    {id:'b1',pay:'held',otp:'4827',cid:'jonas',act:'walks',day:'Tue, 27 Oct',time:'14:00',dur:2,status:'confirmed',place:'Bode-Museum entrance, Museum Island'},
    {id:'b2',pay:'held',otp:'6150',cid:'amara',act:'dinner',day:'Fri, 30 Oct',time:'19:30',dur:2,status:'pending',place:'Markthalle Neun'},
    {id:'b3',pay:'released',cid:'mehmet',act:'gaming',day:'Sat, 17 Oct',time:'16:00',dur:3,status:'completed',place:'Board game café, Boxhagener Platz',reviewed:false},
    {id:'b4',pay:'released',cid:'lena',act:'coffee',day:'Sat, 10 Oct',time:'11:00',dur:1,status:'completed',place:'Café at Paul-Lincke-Ufer',reviewed:true},
    {id:'b5',pay:'refunded',cid:'noah',act:'movies',day:'Mon, 12 Oct',time:'20:00',dur:2,status:'cancelled',place:'Open-air cinema, Wedding',note:'Cancelled by you · €44 refunded'},
  ],
  corder: ['jonas', 'amara', 'mehmet', 'lena'],
  convos: {
    jonas:{cid:'jonas',ctx:'City walk · Tue 27 Oct, 14:00',status:'confirmed',bid:'b1',unread:2,msgs:[{sep:'Yesterday'},{me:false,t:'Hi Mira! Looking forward to Tuesday.',time:'18:02'},{me:true,t:'Me too. Is Museum Island still a good place to start?',time:'18:10'},{sep:'Today'},{me:false,t:'Perfect. Let’s meet at the Bode-Museum entrance at 14:00.',time:'09:41'},{me:false,t:'I’ll bring a rough route and we can adjust as we go.',time:'09:42'}]},
    amara:{cid:'amara',ctx:'Dinner request · Fri 30 Oct',status:'pending',bid:'b2',unread:0,msgs:[{sep:'Saturday'},{me:true,t:'Hi Amara, I sent a request for Friday. Any Lebanese or Ethiopian place you love?',time:'15:20'},{me:false,t:'Hi! I saw it and will confirm tonight. I have two places in mind.',time:'15:48'}]},
    mehmet:{cid:'mehmet',ctx:'Board games · Sat 17 Oct',status:'completed',bid:'b3',unread:0,msgs:[{sep:'17 Oct'},{me:false,t:'That was fun. You picked up Cascadia fast!',time:'19:30'},{me:true,t:'Thanks for teaching me. Next time Wingspan?',time:'19:44'}]},
    lena:{cid:'lena',ctx:'Coffee · Sat 10 Oct',status:'completed',bid:'b4',unread:0,msgs:[{sep:'10 Oct'},{me:false,t:'Here’s the gallery I mentioned: it opens again on the 2nd.',time:'13:05'},{me:true,t:'Saved it, thank you!',time:'13:20'}]},
    sam:{side:'comp',name:'Sam',hue:120,ctx:'City walk · Thu 29 Oct, 17:00',status:'confirmed',unread:1,msgs:[{sep:'Today'},{me:false,t:'Hi! Could we start at Warschauer Straße instead?',time:'08:55'}]},
    tom:{side:'comp',name:'Tom',hue:20,ctx:'Coffee request · Wed 28 Oct',status:'pending',unread:0,msgs:[{sep:'Yesterday'},{me:false,t:'Hi Mira, I’m new to Berlin and would love some neighbourhood tips.',time:'20:14'}]},
  },
  typing: null,
  notifs: [
    {id:'n1',g:'Today',icon:'message-circle',tone:'violet',title:'New message from Jonas',body:'“Perfect. Let’s meet at the Bode-Museum entrance at 14:00.”',time:'09:42',read:false,go:'chat:jonas'},
    {id:'n2',g:'Today',icon:'alarm-clock',tone:'neutral',title:'Reminder: city walk on Tuesday',body:'With Jonas at 14:00, Museum Island.',time:'08:00',read:false,go:'tab:upcoming'},
    {id:'n3',g:'Yesterday',icon:'calendar-check',tone:'success',title:'Booking accepted',body:'Jonas accepted your city walk request.',time:'17:55',read:true,go:'tab:upcoming'},
    {id:'n4',g:'Yesterday',icon:'hourglass',tone:'warning',title:'Request sent to Amara',body:'Dinner on Fri 30 Oct. She has 24 hours to respond.',time:'15:12',read:true,go:'tab:pending'},
    {id:'n5',g:'Earlier',icon:'shield-check',tone:'success',title:'Age confirmation complete',body:'Your account is confirmed as 18+.',time:'Mon',read:true,go:''},
    {id:'n6',g:'Earlier',icon:'receipt',tone:'neutral',title:'Refund processed',body:'€44 for the cancelled movie night with Noah.',time:'13 Oct',read:true,go:'tab:cancelled'},
    {id:'n7',g:'Earlier',icon:'calendar-x',tone:'error',title:'Booking cancelled',body:'You cancelled Movies with Noah on 12 Oct.',time:'12 Oct',read:true,go:'tab:cancelled'},
  ],
  toast: null,
  compStatus: 'none',
  user: { name: 'Mira Hoffmann', first: 'Mira', bio: 'Designer, new-ish to Berlin. Into galleries, good coffee and long walks.' },
  edit: null,
  review: { bid: null, stars: 5, text: '' },
  reportReason: null,
  requests: [
    {id:'r1',code:'7260',who:'Tom',hue:20,act:'coffee',day:'Wed, 28 Oct',time:'10:00',dur:1,note:'New to Berlin, would love tips on neighbourhoods.'},
    {id:'r2',code:'1408',who:'Elif',hue:260,act:'culture',day:'Sat, 31 Oct',time:'14:00',dur:2,note:'Thinking Hamburger Bahnhof, then a coffee?'},
  ],
  cUpcoming: [{id:'u1',code:'3591',who:'Sam',hue:120,act:'walks',day:'Thu, 29 Oct',time:'17:00',dur:2}],
  cDone: [],
  avail: {'Tue-eve':true,'Wed-am':true,'Thu-eve':true,'Sat-am':true,'Sat-pm':true,'Sun-pm':true},
  cRate: 28, cActs: ['coffee', 'culture', 'walks'],
  sheet: null, sheetChat: null,
  otpFor: null, otpIn: { uid: null, val: '', err: false, done: false },
  gift: { amt: 100, to: '', msg: '', done: false },
  checkin: null,
  safety: { bid: null, share: true, every: 30 },

  set: (patch) => set(patch),
  showToast: (msg) => {
    clearTimeout(toastTimer);
    set({ toast: msg });
    toastTimer = setTimeout(() => set({ toast: null }), 2400);
  },
  toggleSave: (id) => {
    set((s) => ({ saved: s.saved.includes(id) ? s.saved.filter((x) => x !== id) : [...s.saved, id], bump: id }));
    clearTimeout(bumpTimer);
    bumpTimer = setTimeout(() => set({ bump: null }), 240);
  },
  setF: (patch) => set((s) => ({ f: { ...s.f, ...patch } })),
  clearAll: () => set({ f: EMPTY_FILTERS, query: '' }),
  openSheet: (sheet, patch) => set({ ...patch, sheet }),
  closeSheet: () => set({ sheet: null }),

  addBooking: (b) => {
    const c = CM[b.cid];
    const id = 'b' + Date.now();
    const day = DAYS[b.day];
    set((s) => ({
      bookings: [{ id, cid: b.cid, act: b.act, day: day.full, time: b.time, dur: b.dur, status: 'pending', place: b.place, pay: 'held', otp: String(1000 + Math.floor(Math.random() * 9000)) }, ...s.bookings],
      notifs: [{ id: 'n' + id, g: 'Today', icon: 'hourglass', tone: 'warning', title: 'Request sent to ' + c.name, body: AM[b.act].label + ' on ' + day.full + '. ' + c.name + ' has 24 hours to respond.', time: 'Now', read: false, go: 'tab:pending' }, ...s.notifs],
    }));
  },
  cancelBooking: (id) => {
    set((s) => ({
      bookings: s.bookings.map((y) => (y.id === id ? { ...y, status: 'cancelled', pay: 'refunded', note: 'Cancelled by you · ' + eur(priceOf(y)) + ' refunded in full' } : y)),
    }));
  },

  ensureConvo: (cid) => {
    const s = get();
    if (s.convos[cid]) {
      set({ convos: { ...s.convos, [cid]: { ...s.convos[cid], unread: 0 } } });
      return;
    }
    set({
      corder: [cid, ...s.corder],
      convos: { ...s.convos, [cid]: { cid, ctx: 'No booking yet', status: 'none', unread: 0, msgs: [{ sep: 'Today' }] } },
    });
  },
  markConvoRead: (key) => set((s) => (s.convos[key] ? { convos: { ...s.convos, [key]: { ...s.convos[key], unread: 0 } } } : {})),
  sendMsg: (key, text) => {
    const t = text.trim();
    if (!t) return;
    const push = (m: Msg) => set((s) => ({ convos: { ...s.convos, [key]: { ...s.convos[key], msgs: [...s.convos[key].msgs, m] } } }));
    push({ me: true, t, time: 'Now' });
    clearTimeout(replyTimer);
    replyTimer = setTimeout(() => {
      set({ typing: key });
      replyTimer = setTimeout(() => {
        set({ typing: null });
        push({ me: false, t: REPLIES[get().convos[key].msgs.length % 3], time: 'Now' });
      }, 1500);
    }, 600);
  },

  readNotif: (id) => set((s) => ({ notifs: s.notifs.map((x) => (x.id === id ? { ...x, read: true } : x)) })),
  markAllRead: () => set((s) => ({ notifs: s.notifs.map((n) => ({ ...n, read: true })) })),

  submitReview: () => {
    const { review } = get();
    set((s) => ({ sheet: null, bookings: s.bookings.map((b) => (b.id === review.bid ? { ...b, reviewed: true } : b)) }));
    get().showToast('Thanks! Your review is live.');
  },
  simulateRelease: (bid) => {
    const ob = get().bookings.find((x) => x.id === bid);
    if (!ob) return;
    const c = CM[ob.cid];
    set((s) => ({
      sheet: null, btab: 'completed', checkin: null,
      bookings: s.bookings.map((y) => (y.id === bid ? { ...y, status: 'completed', pay: 'released' } : y)),
      notifs: [{ id: 'nr' + bid, g: 'Today', icon: 'wallet', tone: 'success', title: 'Payment released to ' + c.name, body: 'Meet code confirmed. ' + eur(priceOf(ob)) + ' sent from ZeitMit.', time: 'Now', read: false, go: 'tab:completed' }, ...s.notifs],
    }));
    get().showToast('Code confirmed. ' + eur(priceOf(ob)) + ' released to ' + c.name + '.');
  },

  acceptRequest: (id) => {
    const r = get().requests.find((x) => x.id === id);
    if (!r) return;
    set((s) => ({ requests: s.requests.filter((y) => y.id !== id), cUpcoming: [...s.cUpcoming, r] }));
    get().showToast('Accepted. ' + r.who + ' has been notified.');
  },
  declineRequest: (id) => {
    const r = get().requests.find((x) => x.id === id);
    if (!r) return;
    set((s) => ({ requests: s.requests.filter((y) => y.id !== id) }));
    get().showToast('Declined. ' + r.who + ' won’t be charged.');
  },
  verifyOtp: () => {
    const { otpIn, cUpcoming } = get();
    const u = cUpcoming.find((x) => x.id === otpIn.uid);
    if (!u || otpIn.val.length < 4) return;
    if (otpIn.val !== u.code) {
      set({ otpIn: { ...otpIn, err: true } });
      return;
    }
    set((s) => ({ otpIn: { ...s.otpIn, done: true }, cUpcoming: s.cUpcoming.filter((y) => y.id !== u.id), cDone: [...s.cDone, u] }));
  },
  submitCompanion: (rate, acts) => set({ compStatus: 'review', cRate: rate, cActs: acts }),
  startCheckin: () => {
    const { bookings, safety } = get();
    const b = bookings.find((x) => x.id === safety.bid);
    const name = b ? CM[b.cid].name : 'your companion';
    set({ sheet: null, checkin: { name, next: safety.every ? 'in ' + safety.every + ' min' : 'at the end' } });
    get().showToast('Check-in on. Anna will be alerted if you miss one.');
  },
}));

// ---- derived selectors ----

export function filtered(query: string, f: Filters, sort: State['sort']) {
  const q = query.trim().toLowerCase();
  const r = C.filter((c) => {
    if (q) {
      const hay = [c.name, c.area, c.tagline, 'berlin', ...c.interests, ...c.langs.map((l) => l[0]), ...c.acts.map((a) => AM[a].label)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.type === 'date' && !c.acts.some((a) => ROM.includes(a))) return false;
    if (f.acts.length && !f.acts.some((a) => c.acts.includes(a))) return false;
    if (f.when === 'today' && !c.today) return false;
    if (f.when === 'tomorrow' && !dayOpen(c.id, 1)) return false;
    if (f.when === 'weekend' && !(dayOpen(c.id, 6) || c.today)) return false;
    if (c.rate > f.max) return false;
    if (f.langs.length && !f.langs.every((l) => c.langs.some((x) => x[0] === l))) return false;
    if (f.rating && !(c.rating && c.rating >= f.rating)) return false;
    if (f.pref !== 'any' && c.g !== f.pref) return false;
    if (f.lgbtq && !c.lgbtq) return false;
    return true;
  });
  if (sort === 'price') r.sort((a, b) => a.rate - b.rate);
  if (sort === 'rating') r.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  if (sort === 'soonest') r.sort((a, b) => firstOpen(a.id) - firstOpen(b.id));
  return r;
}

export const filterCount = (f: Filters) =>
  (f.type !== 'all' ? 1 : 0) + f.acts.length + (f.when !== 'any' ? 1 : 0) + (f.max < 60 ? 1 : 0) + f.langs.length + (f.rating ? 1 : 0) + (f.pref !== 'any' ? 1 : 0) + (f.lgbtq ? 1 : 0);

export const toggleIn = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
