// Meet codes stay out of chat. The 4-digit code is what proves two people met (entering it releases the payment),
// so customers show it in person only. The same check runs on the server (backend/src/lib/meetCode.ts), which has the
// final say; this copy stops the message in the app straight away. Keep the two in step.

// Number words people spell a code out with (English and German).
const WORDS: Record<string, string> = {
  zero: '0', null: '0', one: '1', eins: '1', two: '2', zwei: '2', zwo: '2', three: '3', drei: '3', four: '4', vier: '4',
  five: '5', fünf: '5', fuenf: '5', six: '6', sechs: '6', seven: '7', sieben: '7', eight: '8', acht: '8', nine: '9', neun: '9',
};
// Times and dates ("18:30", "19.00", "6h30", "28.11.", "28.11.2026") are what people usually mean by numbers in a chat.
// Only whole ones: "3.5.6.8" isn't 3 May.
const TIME_DATE = /\b(?:(?:[01]?\d|2[0-4])[:.h][0-5]\d(?![.:]?\d)|(?:0?[1-9]|[12]\d|3[01])\.(?:0?[1-9]|1[0-2])\.(?:\d{4}|\d{2})?(?![.\d]))/gi;
const isDigit = (ch: string) => ch >= '0' && ch <= '9';
const isLetter = (ch: string) => ch.toLowerCase() !== ch.toUpperCase(); // a letter in any cased script

/**
 * Splits a message into digit runs: digits (or number words) with only spaces, symbols or emoji between them; any other
 * word ends a run. `lead`/`trail` are the runs at the very start and end, `whole` says the message is nothing but one run.
 */
export function scan(text: string) {
  let s = text;
  try { s = s.normalize('NFKC'); } catch { /* keep it as it is */ } // full-width and circled digits become 0–9
  s = s.toLowerCase().replace(TIME_DATE, ' x ');
  const segs = [''];
  const chars = Array.from(s); // by code point, so an emoji counts once
  for (let i = 0; i < chars.length; ) {
    if (isLetter(chars[i])) {
      let j = i + 1;
      while (j < chars.length && isLetter(chars[j])) j++;
      const w = WORDS[chars.slice(i, j).join('')];
      if (w === undefined) segs.push('');
      else segs[segs.length - 1] += w;
      i = j;
    } else {
      if (isDigit(chars[i])) segs[segs.length - 1] += chars[i];
      i++;
    }
  }
  return { runs: segs.filter(Boolean), lead: segs[0], trail: segs[segs.length - 1], whole: segs.length === 1 && segs[0] !== '' };
}

/**
 * Whether sending `text` would share `code`: in the message itself, however it's spaced or spelled, or as the end of a
 * code begun in the sender's previous messages (`previous`, newest first), like "35" and then "68".
 */
export function sharesCode(text: string, code: string, previous: string[] = []): boolean {
  if (!/^\d{4}$/.test(code)) return false;
  const cur = scan(text);
  if (cur.runs.some((r) => r.includes(code))) return true;
  let acc = cur.lead;
  if (!acc) return false;
  for (const p of previous) {
    const s = scan(p);
    acc = (s.whole ? s.runs[0] : s.trail) + acc;
    if (acc.includes(code)) return true;
    if (!s.whole) break;
  }
  return false;
}

/** Messages that ask for a code ("Give me the meet code", "Wie ist dein Code?"). */
export const asksForCode = (text: string) => /code|\botp\b/i.test(text);
