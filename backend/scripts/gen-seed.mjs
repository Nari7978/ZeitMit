// Generates migrations/0002_seed_demo.sql from the mobile app's mock companions.
// Run: node scripts/gen-seed.mjs
import { writeFileSync } from 'node:fs';

const C = [
  {id:'lena',name:'Lena',age:29,g:'w',area:'Kreuzberg',dist:'1.8 km',rating:4.9,reviews:42,rate:28,verified:true,lgbtq:true,hue:60,photo:'portrait · café window light',tagline:'Second coffees and gallery Sundays',interests:['Coffee','Art','Film photography','Vinyl'],langs:[['German','Native'],['English','Fluent'],['Spanish','Conversational']],acts:['date','plusone','coffee','culture','walks'],ok:['Holding hands','Arm in arm','Hug hello'],bio:'I grew up in Kreuzberg and still think the best conversations happen over a second coffee. I work in a photo lab, collect records and know which galleries are worth a Sunday. Happy to show newcomers around, or just talk about anything from film cameras to the best Turkish breakfast.'},
  {id:'jonas',name:'Jonas',age:33,g:'m',area:'Mitte',dist:'3.2 km',rating:4.8,reviews:67,rate:32,verified:true,lgbtq:false,hue:235,photo:'street portrait · Museum Island',tagline:'Stories behind the buildings',interests:['History','Architecture','Cycling','Food'],langs:[['German','Native'],['English','Fluent']],acts:['plusone','family','walks','culture','dinner'],ok:['Arm in arm','Introduced as a partner'],bio:'Tour guide turned UX researcher. I love walking the city and telling the stories behind its buildings, from the Wall to the newest courtyards in Mitte. I keep a pace that suits you and always know a decent lunch spot on the way.'},
  {id:'amara',name:'Amara',age:27,g:'w',area:'Neukölln',dist:'2.4 km',rating:5.0,reviews:18,rate:26,verified:true,lgbtq:true,hue:30,photo:'candid · market stall, daylight',tagline:'Markets, food and patient language practice',interests:['Food','Markets','Music','Language Exchange'],langs:[['English','Native'],['German','Fluent'],['French','Fluent']],acts:['plusone','dinner','shopping','language','coffee'],ok:['Arm in arm','Introduced as a partner'],bio:'Food writer and language nerd. I can talk about markets, spice blends and grammar for hours. If you are practising German or French I am patient, and I will gently correct you if you want me to.'},
  {id:'mehmet',name:'Mehmet',age:31,g:'m',area:'Friedrichshain',dist:'4.1 km',rating:4.7,reviews:29,rate:24,verified:true,lgbtq:false,hue:155,photo:'candid · bouldering hall',tagline:'Rules explained, games enjoyed',interests:['Board games','Gaming','Bouldering','Football'],langs:[['German','Native'],['Turkish','Native'],['English','Fluent']],acts:['gaming','sports','movies'],ok:['Friendly hug hello'],bio:'Software tester by day, board game collector by night. I am the person who explains the rules so everyone actually enjoys the game. Also up for bouldering, a five-a-side match or a cinema night.'},
  {id:'kai',name:'Kai',age:null,pron:'they/them',g:'nb',area:'Schöneberg',dist:'2.9 km',rating:4.9,reviews:23,rate:30,verified:true,lgbtq:true,hue:310,photo:'candid · gallery opening',tagline:'The quieter side of Berlin culture',interests:['Theatre','Galleries','Vintage','Cinema'],langs:[['English','Native'],['German','Fluent']],acts:['date','plusone','culture','movies','shopping'],ok:['Holding hands','Hug hello'],bio:'Theatre technician who spends free evenings at openings and small stages. I like showing people the quieter side of Berlin culture, followed by a long chat about what we just saw.'},
  {id:'sofia',name:'Sofia',age:26,g:'w',area:'Prenzlauer Berg',dist:'3.6 km',rating:null,reviews:2,rate:22,verified:false,lgbtq:false,hue:95,photo:'portrait · park, golden hour',tagline:'Bookshops, brunch and Italian practice',interests:['Books','Brunch','Yoga','Coffee'],langs:[['Italian','Native'],['English','Fluent'],['German','Intermediate']],acts:['coffee','language','walks'],ok:['Friendly hug hello'],bio:'Moved here from Bologna two years ago. Bookshops, slow brunches and long walks in the park are my favourite way to spend a day. Glad to help with Italian or English practice.'},
  {id:'yuki',name:'Yuki',age:30,g:'w',area:'Charlottenburg',dist:'6.0 km',rating:4.8,reviews:35,rate:34,verified:true,lgbtq:true,hue:350,photo:'portrait · tea house interior',tagline:'Design shops and tea houses',interests:['Design','Tea','Film photography','Gaming'],langs:[['Japanese','Native'],['English','Fluent'],['German','Conversational']],acts:['date','call','culture','language','gaming','coffee'],ok:['Holding hands','Couple photos'],bio:'Product designer from Osaka, in Berlin since 2019. I enjoy design shops, tea houses and film photography walks. Also happy to play co-op games when the weather is grey.'},
  {id:'noah',name:'Noah',age:28,g:'m',area:'Wedding',dist:'5.2 km',rating:4.6,reviews:12,rate:20,verified:true,lgbtq:false,hue:205,photo:'candid · open-air cinema, dusk',tagline:'Films, hoops and new restaurants',interests:['Cinema','Basketball','Cooking','Podcasts'],langs:[['English','Native'],['German','Intermediate']],acts:['date','movies','sports','dinner'],ok:['Holding hands','Hug hello'],bio:'Originally from Toronto. I cook, play pickup basketball and never miss the open-air cinema in summer. Easy company for a film, a game or trying a new restaurant.'},
];
const RV = [
  ['Clara','Coffee','Easy to talk to from the first minute. We ended up staying an extra hour and I left with a list of places to try.'],
  ['Daniel','City Walks','Knew which spots were worth it and which were tourist traps. Felt like catching up with an old friend.'],
  ['Priya','Language','Patient with my German and curious about where I come from. Exactly what I hoped for after moving here.'],
  ['Marc','Culture','Punctual, friendly and clear about the plan beforehand. Would book again.'],
];
const WIN = ['am', 'pm', 'eve'];
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const j = (v) => q(JSON.stringify(v));

let sql = '-- Demo companions (generated by scripts/gen-seed.mjs). Remove before public launch.\n\n';
for (const c of C) {
  const uid = 'demo_' + c.id;
  sql += `INSERT INTO users (id, email, name, age_confirmed) VALUES (${q(uid)}, ${q(c.id + '@demo.zeitmit.app')}, ${q(c.name)}, 1);\n`;
  sql += `INSERT INTO companions (user_id, display_name, age, pronouns, gender, area, dist, hue, photo_note, tagline, bio, rate, interests, languages, activities, boundaries, lgbtq, status, id_verified, rating, review_count) VALUES (${[uid, c.name, c.age, c.pron ?? null, c.g, c.area, c.dist, c.hue, c.photo, c.tagline, c.bio, c.rate].map(q).join(', ')}, ${j(c.interests)}, ${j(c.langs)}, ${j(c.acts)}, ${j(c.ok)}, ${c.lgbtq ? 1 : 0}, 'approved', ${c.verified ? 1 : 0}, ${q(c.rating)}, ${c.reviews});\n`;
  // Deterministic spread of availability windows.
  for (let d = 0; d < 7; d++) for (let w = 0; w < 3; w++) {
    if ((c.id.charCodeAt(0) * 7 + c.id.charCodeAt(1) * 3 + d * 5 + w * 11) % 10 < 6) sql += `INSERT INTO availability VALUES (${q(uid)}, ${d}, '${WIN[w]}');\n`;
  }
  RV.slice(0, Math.min(4, c.reviews)).forEach(([n, a, t], i) => {
    sql += `INSERT INTO reviews (id, companion_id, author_name, activity, stars, text, created_at) VALUES (${q('rv_' + c.id + i)}, ${q(uid)}, ${q(n)}, ${q(a)}, 5, ${q(t)}, ${1790000000 - i * 1500000});\n`;
  });
  sql += '\n';
}
writeFileSync(new URL('../migrations/0002_seed_demo.sql', import.meta.url), sql);
console.log('wrote 0002_seed_demo.sql');
