// Static catalogue (activities, labels, colours) and pure helpers. Live data comes from the API (src/api.ts).
import { colors } from './theme';
import { locale, t } from './i18n';

export type Gender = 'w' | 'm' | 'nb';
export type ActId =
  | 'date' | 'plusone' | 'family' | 'call' | 'coffee' | 'dinner' | 'walks'
  | 'movies' | 'gaming' | 'shopping' | 'sports' | 'culture' | 'language';

export type Companion = {
  id: string;
  name: string;
  age: number | null;
  pron?: string;
  g: Gender;
  area: string;
  dist: string;
  rating: number | null;
  reviews: number;
  rate: number;
  verified: boolean;
  today: boolean;
  lgbtq: boolean;
  hue: number;
  photo: string;
  tagline: string;
  interests: string[];
  langs: [string, string][];
  acts: ActId[];
  ok: string[];
  bio: string;
  /** Weekdays with availability, 0 = Mon. */
  days: number[];
  photoUrl?: string | null;
};

export type Activity = { id: ActId; label: string; icon: string; desc: string };

export const A: Activity[] = [
  {id:'date',label:'Date',icon:'heart',desc:'A romantic-style date in public, no strings'},
  {id:'plusone',label:'Plus-one',icon:'party-popper',desc:'Weddings, parties and work events'},
  {id:'family',label:'Meet the family',icon:'users-round',desc:'Come along to a family lunch or visit'},
  {id:'call',label:'Video date',icon:'video',desc:'A relaxed date over video call'},
  {id:'coffee',label:'Coffee',icon:'coffee',desc:'Coffee and an unhurried conversation'},
  {id:'dinner',label:'Dinner',icon:'utensils',desc:'Try a restaurant together'},
  {id:'walks',label:'City Walks',icon:'footprints',desc:'Explore neighbourhoods on foot'},
  {id:'movies',label:'Movies',icon:'clapperboard',desc:'Cinema, screenings and film talk'},
  {id:'gaming',label:'Gaming',icon:'gamepad-2',desc:'Board games, arcades or consoles'},
  {id:'shopping',label:'Shopping',icon:'shopping-bag',desc:'Markets, vintage and second opinions'},
  {id:'sports',label:'Sports',icon:'dumbbell',desc:'Bouldering, a run or a match'},
  {id:'culture',label:'Culture',icon:'landmark',desc:'Museums, galleries and theatre'},
  {id:'language',label:'Language',icon:'languages',desc:'Practise a language over a drink'},
];
export const AM = Object.fromEntries(A.map((a) => [a.id, a])) as Record<ActId, Activity>;

export const ROM: ActId[] = ['date', 'plusone', 'family', 'call'];
export const NO = ['Kissing or intimacy','Private or home locations','Overnight or hotel plans','Meeting or paying off ZeitMit'];
export const OKOPTS = ['Holding hands','Arm in arm','Hug hello','Couple photos','Introduced as a partner'];

export const LANGS = ['German','English','French','Spanish','Italian','Turkish','Japanese'];
export const INTERESTS = ['Coffee','Art','Travel','Food','Music','Gaming','Language Exchange','Film','Books','Sports','Design','History'];
export const LEVEL: Record<string, number> = {Native:4,Fluent:3,Conversational:2,Intermediate:2,Basic:1};
export const USER_INT = ['Coffee','Art','Galleries','Cinema','Design','Film photography','Vinyl','Theatre'];
export const PREF = {any:'Anyone',w:'Women',m:'Men',nb:'Non-binary'} as const;
export const WHEN = {any:'Any time',today:'Today',tomorrow:'Tomorrow',weekend:'This weekend'} as const;
export const SORT = {recommended:'Recommended',price:'Price: low to high',rating:'Highest rated',soonest:'Available soonest'} as const;
export const WEEK = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
export const WIN: [string, string][] = [['am','Morning'],['pm','Afternoon'],['eve','Evening']];

export type BookingStatus = 'confirmed' | 'pending' | 'completed' | 'cancelled';
export const ST: Record<BookingStatus, { l: string; bg: string; fg: string; dot: string }> = {
  confirmed:{l:'Confirmed',bg:'#E7F5EE',fg:'#12704E',dot:'#178A60'},
  pending:{l:'Awaiting reply',bg:'#FDF3E2',fg:'#8A5A0F',dot:'#E99A24'},
  completed:{l:'Completed',bg:'#FFF4B8',fg:'#2A2A2A',dot:'#4A4A4A'},
  cancelled:{l:'Cancelled',bg:'#FCEBEE',fg:'#A8304A',dot:'#D9435F'},
};
export type BTab = 'upcoming' | 'pending' | 'completed' | 'cancelled';
export const BTAB: Record<BTab, BookingStatus> = {upcoming:'confirmed',pending:'pending',completed:'completed',cancelled:'cancelled'};
export const BSTEPS = ['Activity','Date & time','Duration','Meeting place','Note','Review'];
export const CSTEPS = ['About you','Activities & languages','Rate & availability','Verification','Review'];
export type Tone = 'violet' | 'success' | 'warning' | 'error' | 'neutral';
export const TONE: Record<Tone, [string, string]> = {violet:['#FFD6E5','#111111'],success:['#E7F5EE','#178A60'],warning:['#FDF3E2','#B37112'],error:['#FCEBEE','#D9435F'],neutral:['#FFF4B8','#2A2A2A']};

// ---- Berlin date helpers (the service runs in Berlin time) ----

const fmt = (o: Intl.DateTimeFormatOptions, loc = locale()) => new Intl.DateTimeFormat(loc, { timeZone: 'Europe/Berlin', ...o });

/** Weekday index in Berlin, 0 = Mon. */
export function berlinWeekday(d = new Date()) {
  return WEEK.indexOf(fmt({ weekday: 'short' }, 'en-GB').format(d));
}

/** 'YYYY-MM-DD' slot dates from the API → labels for the day picker. */
export function slotDay(date: string, index: number) {
  const d = new Date(date + 'T12:00:00Z');
  const short = fmt({ weekday: 'short' }).format(d);
  return {
    date,
    d: short,
    n: String(d.getUTCDate()),
    full: fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(d).replace(/^([^\s,]+),?/, '$1,'),
    label: index === 0 ? 'Today' : index === 1 ? 'Tmrw' : short,
  };
}

/** "Tue 27 Oct, 14:00" for chat context lines. */
export function whenShort(unix: number) {
  const d = new Date(unix * 1000);
  return fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(d) + ', ' + fmt({ hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

/** Notification group + time label like the prototype ("Today · 09:42", "Yesterday", "12 Oct"). */
export function notifWhen(unix: number) {
  const day = (d: Date) => fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const d = new Date(unix * 1000);
  const now = new Date();
  const yest = new Date(Date.now() - 86400000);
  if (day(d) === day(now)) return { g: 'Today' as const, time: fmt({ hour: '2-digit', minute: '2-digit', hour12: false }).format(d) };
  if (day(d) === day(yest)) return { g: 'Yesterday' as const, time: fmt({ hour: '2-digit', minute: '2-digit', hour12: false }).format(d) };
  return { g: 'Earlier' as const, time: fmt({ day: 'numeric', month: 'short' }).format(d) };
}

/** Message timestamps: "09:41" today, otherwise "12 Oct". */
export function msgTime(unix: number) {
  return notifWhen(unix).time;
}

/** Days until a companion is next available (for "Available soonest"). */
export function firstOpen(c: Companion) {
  if (c.today) return 0;
  const t = berlinWeekday();
  for (let i = 1; i < 8; i++) if (c.days.includes((t + i) % 7)) return i;
  return 9;
}

export const eur = (n: number) => {
  const v = Math.round(n * 100) / 100;
  return '€' + (Number.isInteger(v) ? v : v.toFixed(2));
};
export const memberSince = (unix: number) => 'Member since ' + new Date(unix * 1000).getFullYear();
export const hours = (d: number) => t(d + (d === 1 ? ' hour' : ' hours'));
export const ageStr = (c: { age: number | null }) => (c.age ? ', ' + c.age : '');
export const ratingStr = (c: Companion) => (c.rating ? c.rating.toFixed(1) : 'New');
export const reviewsStr = (c: Companion) => (c.rating ? '(' + c.reviews + ')' : '');
export const isDateCompanion = (c: Companion) => c.acts.some((a) => ROM.includes(a));

/** Selected / unselected chip colours (`sel()` in the prototype). */
export const sel = (on: boolean) => ({ bg: on ? colors.blush : colors.white, fg: colors.ink, bd: colors.ink });
