// Mock data and pure helpers ported from the ZeitMit v3 prototype.
import { colors } from './theme';

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
};

export type Activity = { id: ActId; label: string; icon: string; desc: string };

const BASE: Omit<Companion, 'ok'>[] = [
  {id:'lena',name:'Lena',age:29,g:'w',area:'Kreuzberg',dist:'1.8 km',rating:4.9,reviews:42,rate:28,verified:true,today:true,lgbtq:true,hue:60,photo:'portrait · café window light',tagline:'Second coffees and gallery Sundays',interests:['Coffee','Art','Film photography','Vinyl'],langs:[['German','Native'],['English','Fluent'],['Spanish','Conversational']],acts:['coffee','culture','walks'],bio:'I grew up in Kreuzberg and still think the best conversations happen over a second coffee. I work in a photo lab, collect records and know which galleries are worth a Sunday. Happy to show newcomers around, or just talk about anything from film cameras to the best Turkish breakfast.'},
  {id:'jonas',name:'Jonas',age:33,g:'m',area:'Mitte',dist:'3.2 km',rating:4.8,reviews:67,rate:32,verified:true,today:false,lgbtq:false,hue:235,photo:'street portrait · Museum Island',tagline:'Stories behind the buildings',interests:['History','Architecture','Cycling','Food'],langs:[['German','Native'],['English','Fluent']],acts:['walks','culture','dinner'],bio:'Tour guide turned UX researcher. I love walking the city and telling the stories behind its buildings, from the Wall to the newest courtyards in Mitte. I keep a pace that suits you and always know a decent lunch spot on the way.'},
  {id:'amara',name:'Amara',age:27,g:'w',area:'Neukölln',dist:'2.4 km',rating:5.0,reviews:18,rate:26,verified:true,today:true,lgbtq:true,hue:30,photo:'candid · market stall, daylight',tagline:'Markets, food and patient language practice',interests:['Food','Markets','Music','Language Exchange'],langs:[['English','Native'],['German','Fluent'],['French','Fluent']],acts:['dinner','shopping','language','coffee'],bio:'Food writer and language nerd. I can talk about markets, spice blends and grammar for hours. If you are practising German or French I am patient, and I will gently correct you if you want me to.'},
  {id:'mehmet',name:'Mehmet',age:31,g:'m',area:'Friedrichshain',dist:'4.1 km',rating:4.7,reviews:29,rate:24,verified:true,today:true,lgbtq:false,hue:155,photo:'candid · bouldering hall',tagline:'Rules explained, games enjoyed',interests:['Board games','Gaming','Bouldering','Football'],langs:[['German','Native'],['Turkish','Native'],['English','Fluent']],acts:['gaming','sports','movies'],bio:'Software tester by day, board game collector by night. I am the person who explains the rules so everyone actually enjoys the game. Also up for bouldering, a five-a-side match or a cinema night.'},
  {id:'kai',name:'Kai',age:null,pron:'they/them',g:'nb',area:'Schöneberg',dist:'2.9 km',rating:4.9,reviews:23,rate:30,verified:true,today:false,lgbtq:true,hue:310,photo:'candid · gallery opening',tagline:'The quieter side of Berlin culture',interests:['Theatre','Galleries','Vintage','Cinema'],langs:[['English','Native'],['German','Fluent']],acts:['culture','movies','shopping'],bio:'Theatre technician who spends free evenings at openings and small stages. I like showing people the quieter side of Berlin culture, followed by a long chat about what we just saw.'},
  {id:'sofia',name:'Sofia',age:26,g:'w',area:'Prenzlauer Berg',dist:'3.6 km',rating:null,reviews:2,rate:22,verified:false,today:true,lgbtq:false,hue:95,photo:'portrait · park, golden hour',tagline:'Bookshops, brunch and Italian practice',interests:['Books','Brunch','Yoga','Coffee'],langs:[['Italian','Native'],['English','Fluent'],['German','Intermediate']],acts:['coffee','language','walks'],bio:'Moved here from Bologna two years ago. Bookshops, slow brunches and long walks in the park are my favourite way to spend a day. Glad to help with Italian or English practice.'},
  {id:'yuki',name:'Yuki',age:30,g:'w',area:'Charlottenburg',dist:'6.0 km',rating:4.8,reviews:35,rate:34,verified:true,today:false,lgbtq:true,hue:350,photo:'portrait · tea house interior',tagline:'Design shops and tea houses',interests:['Design','Tea','Film photography','Gaming'],langs:[['Japanese','Native'],['English','Fluent'],['German','Conversational']],acts:['culture','language','gaming','coffee'],bio:'Product designer from Osaka, in Berlin since 2019. I enjoy design shops, tea houses and film photography walks. Also happy to play co-op games when the weather is grey.'},
  {id:'noah',name:'Noah',age:28,g:'m',area:'Wedding',dist:'5.2 km',rating:4.6,reviews:12,rate:20,verified:true,today:true,lgbtq:false,hue:205,photo:'candid · open-air cinema, dusk',tagline:'Films, hoops and new restaurants',interests:['Cinema','Basketball','Cooking','Podcasts'],langs:[['English','Native'],['German','Intermediate']],acts:['movies','sports','dinner'],bio:'Originally from Toronto. I cook, play pickup basketball and never miss the open-air cinema in summer. Easy company for a film, a game or trying a new restaurant.'},
];

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
const EXTRA: Record<string, ActId[]> = {lena:['date','plusone'],jonas:['plusone','family'],kai:['date','plusone'],yuki:['date','call'],noah:['date'],amara:['plusone']};
const BOK: Record<string, string[]> = {lena:['Holding hands','Arm in arm','Hug hello'],jonas:['Arm in arm','Introduced as a partner'],kai:['Holding hands','Hug hello'],yuki:['Holding hands','Couple photos'],noah:['Holding hands','Hug hello'],amara:['Arm in arm','Introduced as a partner']};
export const NO = ['Kissing or intimacy','Private or home locations','Overnight or hotel plans','Meeting or paying off ZeitMit'];
export const OKOPTS = ['Holding hands','Arm in arm','Hug hello','Couple photos','Introduced as a partner'];

export const C: Companion[] = BASE.map((c) => ({
  ...c,
  acts: [...(EXTRA[c.id] || []), ...c.acts],
  ok: BOK[c.id] || ['Friendly hug hello'],
}));
export const CM = Object.fromEntries(C.map((c) => [c.id, c])) as Record<string, Companion>;

export type Day = { i: number; d: string; n: string; full: string; label: string };
export const DAYS: Day[] = [['Sun','25'],['Mon','26'],['Tue','27'],['Wed','28'],['Thu','29'],['Fri','30'],['Sat','31']]
  .map(([d, n], i) => ({ i, d, n, full: d + ', ' + n + ' Oct', label: i === 0 ? 'Today' : i === 1 ? 'Tmrw' : d }));
export const TIMES = ['09:30','11:00','12:30','14:00','15:30','17:00','18:30','20:00'];
export const LANGS = ['German','English','French','Spanish','Italian','Turkish','Japanese'];
export const INTERESTS = ['Coffee','Art','Travel','Food','Music','Gaming','Language Exchange','Film','Books','Sports','Design','History'];
export const LEVEL: Record<string, number> = {Native:4,Fluent:3,Conversational:2,Intermediate:2,Basic:1};
export const USER_INT = ['Coffee','Art','Galleries','Cinema','Design','Film photography','Vinyl','Theatre'];
export const RV = [
  {n:'Clara',m:'Sep 2026',a:'Coffee',t:'Easy to talk to from the first minute. We ended up staying an extra hour and I left with a list of places to try.'},
  {n:'Daniel',m:'Aug 2026',a:'City Walks',t:'Knew which spots were worth it and which were tourist traps. Felt like catching up with an old friend.'},
  {n:'Priya',m:'Aug 2026',a:'Language',t:'Patient with my German and curious about where I come from. Exactly what I hoped for after moving here.'},
  {n:'Marc',m:'Jul 2026',a:'Culture',t:'Punctual, friendly and clear about the plan beforehand. Would book again.'},
];
export const REPLIES = ['Sounds good, see you then.','Great idea. I will keep that in mind.','Perfect, thanks for letting me know!'];
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

// Deterministic mock availability, identical to the prototype.
export function isOpen(cid: string, di: number, ti: number) {
  const c = CM[cid];
  if (di === 0) {
    if (!c.today) return false;
    return ti >= 4 && (ti !== 5 || cid.length % 2 === 0);
  }
  return (cid.charCodeAt(0) * 7 + cid.charCodeAt(1) * 3 + di * 5 + ti * 11) % 10 < 5;
}
export const dayOpen = (cid: string, di: number) => TIMES.some((_, ti) => isOpen(cid, di, ti));
export const slots = (cid: string, di: number) => TIMES.filter((_, ti) => isOpen(cid, di, ti)).length;
export function firstOpen(cid: string) {
  for (let i = 0; i < 7; i++) if (dayOpen(cid, i)) return i;
  return 9;
}

export const eur = (n: number) => {
  const v = Math.round(n * 100) / 100;
  return '€' + (Number.isInteger(v) ? v : v.toFixed(2));
};
export const hours = (d: number) => d + (d === 1 ? ' hour' : ' hours');
export const ageStr = (c: { age: number | null }) => (c.age ? ', ' + c.age : '');
export const ratingStr = (c: Companion) => (c.rating ? c.rating.toFixed(1) : 'New');
export const reviewsStr = (c: Companion) => (c.rating ? '(' + c.reviews + ')' : '');
export const isDateCompanion = (c: Companion) => c.acts.some((a) => ROM.includes(a));

/** Selected / unselected chip colours (`sel()` in the prototype). */
export const sel = (on: boolean) => ({ bg: on ? colors.blush : colors.white, fg: colors.ink, bd: colors.ink });
