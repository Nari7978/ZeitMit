// Free alerts to the trusted contact: WhatsApp (or SMS) opens with the message ready, the user taps Send.
import { Linking, Platform } from 'react-native';

/** "0151 234 5678" → "491512345678" (German numbers without a country code get +49). */
export function intlNumber(phone: string) {
  let d = phone.trim().replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = '49' + d.slice(1);
  return d.replace(/\D/g, '');
}

/** Opens WhatsApp with the message to this number. Returns false if nothing could be opened. */
export async function sendWhatsApp(phone: string, text: string) {
  const url = `https://wa.me/${intlNumber(phone)}?text=${encodeURIComponent(text)}`;
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/** Opens the SMS app with the message (fallback when the contact doesn't use WhatsApp). */
export async function sendSms(phone: string, text: string) {
  const sep = Platform.OS === 'ios' ? '&' : '?';
  try {
    await Linking.openURL(`sms:+${intlNumber(phone)}${sep}body=${encodeURIComponent(text)}`);
    return true;
  } catch {
    return false;
  }
}
