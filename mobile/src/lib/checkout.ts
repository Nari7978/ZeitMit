// Opens Stripe Checkout in a secure in-app browser and waits until it hands control back
// (the API's /payments/return page redirects to zeitmit://payment-done).
import * as WebBrowser from 'expo-web-browser';

export async function runCheckout(url: string) {
  try {
    const r = await WebBrowser.openAuthSessionAsync(url, 'zeitmit://payment-done');
    return r.type === 'success' ? (new URL(r.url).searchParams.get('status') === 'success' ? 'success' : 'cancel') : 'closed';
  } catch {
    return 'closed';
  }
}
