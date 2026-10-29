// IBAN checks for the payout form (the API checks again). Same rules as backend/src/routes/payouts.ts.

const IBAN_LENGTH: Record<string, number> = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24, FI: 18, FR: 27, GB: 22, GI: 23, GR: 27,
  HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24,
  SE: 24, SI: 19, SK: 24, SM: 27, VA: 22,
};

export const normalIban = (iban: string) => iban.replace(/\s+/g, '').toUpperCase();

/** "DE89370400440532013000" → "DE89 3704 0044 0532 0130 00" while typing. */
export const groupIban = (iban: string) => normalIban(iban).replace(/(.{4})/g, '$1 ').trim();

export function validIban(raw: string) {
  const iban = normalIban(raw);
  const len = IBAN_LENGTH[iban.slice(0, 2)];
  if (!len || iban.length !== len || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1;
}

/** Why an IBAN isn't accepted yet, or null when it's fine (or still too short to judge). */
export function ibanProblem(raw: string) {
  const iban = normalIban(raw);
  if (iban.length < 4) return null;
  const len = IBAN_LENGTH[iban.slice(0, 2)];
  if (!len) return 'Use an IBAN from a SEPA country, e.g. DE…';
  if (iban.length < len) return null;
  if (iban.length > len) return `A ${iban.slice(0, 2)} IBAN has ${len} characters.`;
  return validIban(iban) ? null : 'That IBAN doesn’t look right. Check it and try again.';
}
