// Things in a companion's new text worth a second look before it goes live (admin → Profile changes). Phone numbers,
// emails and @handles never get this far (refused when saved: util.ts hasContactDetails); these are the softer signs.
// English and German. Pure (scripts/engine-check.ts).

const HINTS: [label: string, re: RegExp][] = [
  ['Social media or messenger', /\b(?:insta(?:gram)?|ig|snap(?:chat)?|tik ?tok|onlyfans|only fans|telegram|whats ?app|signal|facebook|fb|twitter|discord|dm me|add me|follow me|schreib mir privat)\b/gi],
  ['Payment outside ZeitMit', /\b(?:paypal|revolut|venmo|cash|barzahlung|bar bezahlen|in bar|bank ?transfer|iban|bitcoin|crypto|krypto|tip me)\b|überweis\w*/gi],
  ['Sexual content', /\b(?:sex\w*|nude\w*|naked|nackt\w*|erotic\w*|erotik\w*|escort\w*|kink\w*|fetish\w*|fetisch\w*|sugar ?(?:daddy|baby|mommy)|gfe|girlfriend experience|full service|lingerie|dessous|intim\w*|happy ending)\b/gi],
  // (Words starting with an umlaut sit outside the \b group: \b doesn't see ü as part of a word.)
  ['Meeting at home or in private', /\b(?:my place|your place|my flat|my apartment|zu mir nach hause|zu dir nach hause|meine wohnung|deine wohnung|hotel\w*|home visit|hausbesuch\w*|overnight)\b|übernacht\w*/gi],
];

/** What the check found in a text: per kind, the words that matched (lower case, each once). */
export function reviewHints(text: string) {
  const out: { label: string; words: string[] }[] = [];
  for (const [label, re] of HINTS) {
    const words = [...new Set([...text.matchAll(re)].map((m) => m[0].toLowerCase()))];
    if (words.length) out.push({ label, words });
  }
  return out;
}
