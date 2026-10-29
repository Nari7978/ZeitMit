// Companion payouts, paid by hand: companions save a bank account and request their available
// earnings; ZeitMit sends a SEPA transfer and marks the request as paid in the admin panel.
import { Hono } from 'hono';
import type { AppEnv, Env } from '../types';
import { alertAdmins, notify } from '../lib/notify';
import { euros, fail, newId, now } from '../lib/util';

/** Earnings become withdrawable this many days after the meet-up (time for complaints and refunds). */
export const PAYOUT_HOLD_DAYS = 2;
/** Smallest payout a companion can request, in cents. */
export const PAYOUT_MIN = 2000;

// IBAN lengths of the SEPA countries.
const IBAN_LENGTH: Record<string, number> = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24, FI: 18, FR: 27, GB: 22, GI: 23, GR: 27,
  HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24,
  SE: 24, SI: 19, SK: 24, SM: 27, VA: 22,
};

export const normalIban = (iban: string) => iban.replace(/\s+/g, '').toUpperCase();

/** Checks country, length and the ISO 13616 check digits (mod 97). */
export function validIban(raw: string) {
  const iban = normalIban(raw);
  const len = IBAN_LENGTH[iban.slice(0, 2)];
  if (!len || iban.length !== len || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1;
}

/** "DE89 •••• •••• •••• •••• 3000": enough to recognise the account, never the whole number. */
export const maskIban = (iban: string) => `${iban.slice(0, 4)} •••• ${iban.slice(-4)}`;
export const groupIban = (iban: string) => iban.replace(/(.{4})/g, '$1 ').trim();

/**
 * A companion's money, in cents. Earned = released bookings (meet code entered, or cancelled late).
 * Available = earned and past the hold, minus what's requested or paid. Refunds after a payout make it negative.
 */
export async function balanceOf(env: Env, companionId: string) {
  const cut = now() - PAYOUT_HOLD_DAYS * 86400;
  const earned = await env.DB.prepare(
    `SELECT COALESCE(SUM(CASE WHEN released_at <= ?1 THEN subtotal END), 0) AS ready,
            COALESCE(SUM(CASE WHEN released_at > ?1 THEN subtotal END), 0) AS pending,
            MIN(CASE WHEN released_at > ?1 THEN released_at END) AS next_release
     FROM bookings WHERE companion_id = ?2 AND pay_status = 'released'`,
  ).bind(cut, companionId).first<{ ready: number; pending: number; next_release: number | null }>();
  const out = await env.DB.prepare(
    `SELECT COALESCE(SUM(CASE WHEN status = 'requested' THEN amount END), 0) AS requested,
            COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0) AS paid
     FROM payouts WHERE companion_id = ?`,
  ).bind(companionId).first<{ requested: number; paid: number }>();
  const ready = earned?.ready ?? 0;
  const requested = out?.requested ?? 0;
  const paid = out?.paid ?? 0;
  return {
    available: ready - requested - paid,
    pending: earned?.pending ?? 0,
    requested,
    paid,
    /** When the oldest pending amount becomes available. */
    nextAvailableAt: earned?.next_release ? earned.next_release + PAYOUT_HOLD_DAYS * 86400 : null,
  };
}

/** True when a person still has earnings ZeitMit hasn't paid out (or a payout on its way). */
export async function owesPayout(env: Env, userId: string) {
  const b = await balanceOf(env, userId);
  return { owed: b.available + b.pending + b.requested > 0, ...b };
}

type PayoutRow = {
  id: string; companion_id: string; amount: number; status: 'requested' | 'paid' | 'rejected'; holder_name: string; iban: string;
  reference: string | null; note: string | null; created_at: number; decided_at: number | null;
};
const forCompanion = (p: PayoutRow) => ({
  id: p.id, amount: p.amount, status: p.status, ibanMasked: maskIban(p.iban), reference: p.reference, note: p.note, createdAt: p.created_at, decidedAt: p.decided_at,
});

export const payouts = new Hono<AppEnv>();

/** Balance, saved bank account (masked) and payout history. */
payouts.get('/', async (c) => {
  const u = c.get('user');
  const [balance, account, list] = await Promise.all([
    balanceOf(c.env, u.id),
    c.env.DB.prepare('SELECT holder_name, iban, updated_at FROM payout_accounts WHERE user_id = ?').bind(u.id).first<{ holder_name: string; iban: string; updated_at: number }>(),
    c.env.DB.prepare('SELECT * FROM payouts WHERE companion_id = ? ORDER BY created_at DESC LIMIT 100').bind(u.id).all<PayoutRow>(),
  ]);
  return c.json({
    balance,
    account: account ? { holderName: account.holder_name, ibanMasked: maskIban(account.iban), updatedAt: account.updated_at } : null,
    payouts: list.results.map(forCompanion),
    rules: { holdDays: PAYOUT_HOLD_DAYS, min: PAYOUT_MIN },
  });
});

/** Saves the bank account payouts go to. Locked while a payout is on its way. */
payouts.put('/account', async (c) => {
  const u = c.get('user');
  const { holderName, iban } = await c.req.json<{ holderName?: string; iban?: string }>();
  const name = (holderName ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 70) fail(400, 'Enter the account holder’s full name.');
  if (!validIban(iban ?? '')) fail(400, 'That IBAN doesn’t look right. Check it and try again.');
  const open = await c.env.DB.prepare("SELECT 1 FROM payouts WHERE companion_id = ? AND status = 'requested'").bind(u.id).first();
  if (open) fail(409, 'You have a payout on its way. You can change your bank account once it’s paid.');
  const had = await c.env.DB.prepare('SELECT 1 FROM payout_accounts WHERE user_id = ?').bind(u.id).first();
  const clean = normalIban(iban!);
  await c.env.DB.prepare(
    `INSERT INTO payout_accounts (user_id, holder_name, iban) VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET holder_name = excluded.holder_name, iban = excluded.iban, updated_at = unixepoch()`,
  ).bind(u.id, name, clean).run();
  // A changed account is worth knowing about if it wasn't you.
  if (had) await notify(c.env, u.id, { icon: 'wallet', tone: 'warning', title: 'Payout account changed', body: `Payouts now go to ${maskIban(clean)}. If this wasn’t you, contact support.`, go: 'payouts' }, c.executionCtx);
  return c.json({ holderName: name, ibanMasked: maskIban(clean) }, had ? 200 : 201);
});

/** Requests the whole available balance. */
payouts.post('/', async (c) => {
  const u = c.get('user');
  const account = await c.env.DB.prepare('SELECT holder_name, iban FROM payout_accounts WHERE user_id = ?').bind(u.id).first<{ holder_name: string; iban: string }>();
  if (!account) fail(400, 'Add the bank account your payouts should go to first.');
  const b = await balanceOf(c.env, u.id);
  if (b.requested > 0) fail(409, 'You already have a payout on its way.');
  if (b.available < PAYOUT_MIN) fail(409, `You can request a payout from ${euros(PAYOUT_MIN)}. Available now: ${euros(Math.max(0, b.available))}.`);
  const id = newId('po');
  try {
    await c.env.DB.prepare('INSERT INTO payouts (id, companion_id, amount, holder_name, iban) VALUES (?, ?, ?, ?, ?)')
      .bind(id, u.id, b.available, account!.holder_name, account!.iban).run();
  } catch {
    fail(409, 'You already have a payout on its way.'); // the one-open-request index caught a double tap
  }
  const who = await c.env.DB.prepare('SELECT u.email, COALESCE(cp.display_name, u.name) AS name FROM users u LEFT JOIN companions cp ON cp.user_id = u.id WHERE u.id = ?')
    .bind(u.id).first<{ email: string; name: string }>();
  c.executionCtx.waitUntil(alertAdmins(c.env, `Payout request: ${euros(b.available)} from ${who?.name || who?.email}`,
    `${who?.name} (${who?.email}) requested ${euros(b.available)}.\nAccount holder: ${account!.holder_name}\nIBAN: ${groupIban(account!.iban)}\nOpen the admin panel → Payouts to send it and mark it as paid.`,
    { icon: 'wallet', tone: 'violet' }));
  return c.json({ id, amount: b.available, status: 'requested', ibanMasked: maskIban(account!.iban) }, 201);
});
