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
  /** Free today, for either kind of date. */
  today: boolean;
  /** When they're next free (unix, first open start in the next 7 days, bookings counted), or null: either kind. */
  next?: number | null;
  /** The same per kind they offer (null for a kind they don't offer): in person and video dates have their own hours. */
  free?: Record<Kind, Free | null>;
  lgbtq: boolean;
  hue: number;
  photo: string;
  tagline: string;
  interests: string[];
  langs: [string, string][];
  acts: ActId[];
  ok: string[];
  bio: string;
  /** Weekdays with availability, 0 = Mon (either kind). */
  days: number[];
  photoUrl?: string | null;
  /** More photos besides the profile photo, shown as slides on the profile. */
  gallery?: string[];
};

/** Video dates and in-person dates have their own hours and rules (one clock: a booking blocks both). */
export type Kind = 'meet' | 'video';
/** When someone is next free (unix or null), whether that's today, and the weekdays (0 = Mon) with open times. */
export type Free = { next: number | null; today: boolean; days: number[] };

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

const berlinDay = (unix: number) => fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-CA').format(new Date(unix * 1000));

/**
 * When a companion is free for what you're looking for: video dates only if the activities picked are just video
 * dates, in person only if they're all in person, otherwise either. `video` says which kind `next` is: in person
 * when it's free that same day, otherwise the sooner one.
 */
export function freeOf(c: Companion, acts: ActId[] = []): Free & { video: boolean } {
  if (!c.free) return { next: c.next ?? null, today: c.today, days: c.days, video: false };
  const want = acts.length ? kindsOf(acts) : (['meet', 'video'] as Kind[]);
  const meet = want.includes('meet') ? c.free.meet : null;
  const video = want.includes('video') ? c.free.video : null;
  const m = meet?.next ?? null, v = video?.next ?? null;
  const useVideo = v !== null && (m === null || berlinDay(v) < berlinDay(m));
  return {
    next: useVideo ? v : m,
    today: !!(meet?.today || video?.today),
    days: [...new Set([...(meet?.days ?? []), ...(video?.days ?? [])])],
    video: useVideo,
  };
}

/** When a companion is next free, for "Available soonest" (unix; companions with nothing open come last). */
export function firstOpen(c: Companion, acts: ActId[] = []) {
  const f = c.free ? Math.min(...(['meet', 'video'] as Kind[]).filter((k) => !acts.length || kindsOf(acts).includes(k)).map((k) => c.free![k]?.next ?? Number.MAX_SAFE_INTEGER)) : c.next;
  return f ?? Number.MAX_SAFE_INTEGER;
}

export const eur = (n: number) => {
  const v = Math.round(n * 100) / 100;
  return '€' + (Number.isInteger(v) ? v : v.toFixed(2));
};
export const memberSince = (unix: number) => 'Member since ' + new Date(unix * 1000).getFullYear();
export const hours = (d: number) => t(`${Math.floor(d)}${d % 1 ? '½' : ''} ${d === 1 ? 'hour' : 'hours'}`);
/** What stood out at a meet-up, for the private safety feedback (the server accepts the same lists). */
export const FEEDBACK_GOOD = ['Respectful', 'Kept to boundaries', 'On time', 'Friendly'];
export const FEEDBACK_CONCERNS = ['Pushy or rude', 'Crossed boundaries', 'Asked for contact details', 'Wanted to meet outside ZeitMit', 'Made me uncomfortable'];
/** Booking lengths: 1 to 8 hours in half-hour steps (the server allows the same). */
export const MIN_HOURS = 1;
export const MAX_HOURS = 8;
/** A booking's meeting place, or the reminder shown when it was left for the chat. */
export const placeOr = (place: string) => place || 'Agree on a place in the chat';
/** Video dates happen in the app: no meeting place, check-in or meet code. */
export const isVideo = (act: ActId) => act === 'call';
export const kindOf = (act: ActId): Kind => (isVideo(act) ? 'video' : 'meet');
/** The kinds a list of activities covers (in person first). */
export const kindsOf = (acts: ActId[]): Kind[] => (['meet', 'video'] as Kind[]).filter((k) => acts.some((a) => kindOf(a) === k));
/** How soon a booking can start (as on the server): video dates from 15 minutes ahead, in person from 2 hours. */
export const LEAD_MIN: Record<Kind, number> = { video: 15, meet: 120 };
/** An in-person request waits this long for the companion's answer, at the latest until an hour before the start. */
export const REPLY_HOURS = 2;
export const replyByFor = (startsAt: number, sentAt = Date.now() / 1000) => Math.min(sentAt + REPLY_HOURS * 3600, startsAt - 3600);
/** A video date is confirmed at once, so it can be cancelled for free this many minutes after booking. */
export const VIDEO_GRACE_MIN = 10;
/** The video call opens this long before the start (as on the server). */
export const CALL_OPENS_EARLY_S = 10 * 60;
export const placeFor = (act: ActId, place: string) => (isVideo(act) ? 'Video call in the app' : placeOr(place));
export const ageStr = (c: { age: number | null }) => (c.age ? ', ' + c.age : '');
export const ratingStr = (c: Companion) => (c.rating ? c.rating.toFixed(1) : 'New');
export const reviewsStr = (c: Companion) => (c.rating ? '(' + c.reviews + ')' : '');
export const isDateCompanion = (c: Companion) => c.acts.some((a) => ROM.includes(a));

/** Selected / unselected chip colours (`sel()` in the prototype). */
export const sel = (on: boolean) => ({ bg: on ? colors.blush : colors.white, fg: colors.ink, bd: colors.ink });
