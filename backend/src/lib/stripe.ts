// Minimal Stripe REST client (no SDK needed on Workers). Active only when STRIPE_SECRET_KEY is set.
import type { Env } from '../types';

export const stripeOn = (env: Env) => !!env.STRIPE_SECRET_KEY;

/** Flattens { a: { b: 1 } } into Stripe's form encoding: a[b]=1. */
function form(params: Record<string, unknown>, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripe<T>(env: Env, method: 'GET' | 'POST', path: string, params?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const base = env.STRIPE_API_BASE || 'https://api.stripe.com';
  const body = params ? form(params) : undefined;
  const url = method === 'GET' && body ? `${base}${path}?${body}` : `${base}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: method === 'POST' ? body?.toString() : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Stripe: ${data.error?.message ?? res.status}`);
  return data;
}

export type CheckoutSession = { id: string; url: string; status?: 'open' | 'complete' | 'expired'; payment_status: 'paid' | 'unpaid' | 'no_payment_required'; payment_intent: string | { id: string; status: string } | null };

/**
 * Hosted Checkout page. Bookings use manual capture (money is authorised and held, then captured
 * when the meet code is entered); gifts are charged immediately.
 */
export function createCheckout(env: Env, o: { amount: number; name: string; ref: string; kind: 'booking' | 'gift'; origin: string; email?: string }) {
  const ret = `${o.origin}/payments/return?kind=${o.kind}&id=${encodeURIComponent(o.ref)}`;
  return stripe<CheckoutSession>(env, 'POST', '/v1/checkout/sessions', {
    mode: 'payment',
    line_items: { 0: { quantity: 1, price_data: { currency: 'eur', unit_amount: o.amount, product_data: { name: o.name } } } },
    ...(o.kind === 'booking' ? { payment_intent_data: { capture_method: 'manual', metadata: { ref: o.ref } } } : {}),
    metadata: { ref: o.ref, kind: o.kind },
    customer_email: o.email,
    success_url: `${ret}&status=success`,
    cancel_url: `${ret}&status=cancel`,
    expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
  }, `checkout-${o.ref}`);
}

export const getSession = (env: Env, id: string) =>
  stripe<CheckoutSession>(env, 'GET', `/v1/checkout/sessions/${id}`, { expand: { 0: 'payment_intent' } });

/** Closes an open Checkout page so it can't be paid any more. Fails if it's already paid or expired. */
export const expireSession = (env: Env, id: string) =>
  stripe<{ status: string }>(env, 'POST', `/v1/checkout/sessions/${id}/expire`, {});

/** Takes the held money when the meet code is confirmed. */
export const capture = (env: Env, paymentIntent: string) =>
  stripe<{ status: string }>(env, 'POST', `/v1/payment_intents/${paymentIntent}/capture`, {}, `capture-${paymentIntent}`);

/** Releases a hold (customer is never charged). */
export const cancelIntent = (env: Env, paymentIntent: string) =>
  stripe<{ status: string }>(env, 'POST', `/v1/payment_intents/${paymentIntent}/cancel`, {}, `cancel-${paymentIntent}`);

/** Refunds money that was already taken (e.g. support refunds a completed or late-cancelled booking). */
export const refundPayment = (env: Env, paymentIntent: string) =>
  stripe<{ status: string }>(env, 'POST', '/v1/refunds', { payment_intent: paymentIntent }, `refund-${paymentIntent}`);

/** Status of the PaymentIntent behind a Checkout session: 'requires_capture' / 'succeeded' means paid. */
export function intentOf(s: CheckoutSession) {
  const pi = s.payment_intent;
  if (!pi) return null;
  return typeof pi === 'string' ? { id: pi, status: s.payment_status === 'paid' ? 'succeeded' : 'unknown' } : pi;
}
