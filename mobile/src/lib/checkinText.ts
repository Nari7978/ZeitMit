// What the trusted contact receives on WhatsApp, in the user's app language.
import type { Checkin } from '../store';
import { getLang } from '../i18n';

const when = (ck: Checkin) => {
  const de = getLang() === 'de';
  const f = (o: Intl.DateTimeFormatOptions, u: number) => new Intl.DateTimeFormat(de ? 'de-DE' : 'en-GB', { timeZone: 'Europe/Berlin', ...o }).format(new Date(u * 1000));
  const hm: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false };
  return `${f({ weekday: 'short', day: 'numeric', month: 'short' }, ck.startsAt)}, ${f(hm, ck.startsAt)}–${f(hm, ck.endsAt)}`;
};

/** Sent when the check-in starts: the private live link. */
export function shareMessage(ck: Checkin) {
  const link = ck.shareUrl ?? '';
  if (getLang() === 'de') {
    return `Hallo ${ck.contactName}, ich treffe ${ck.otherName} über ZeitMit: ${when(ck)}, ${ck.place}. ` +
      `Hier kannst du meine Check-ins${ck.share ? ' und meinen Standort' : ''} live sehen: ${link}\n` +
      'Wenn etwas nicht stimmt, schicke ich dir ein SOS.';
  }
  return `Hi ${ck.contactName}, I’m meeting ${ck.otherName} through ZeitMit: ${when(ck)}, ${ck.place}. ` +
    `You can follow my check-ins${ck.share ? ' and live location' : ''} here: ${link}\n` +
    'If something’s wrong I’ll send you an SOS.';
}

/** Sent from the SOS screen. */
export function sosMessage(ck: Checkin, me: string) {
  const link = ck.shareUrl ? ck.shareUrl : '';
  if (getLang() === 'de') {
    return `🆘 SOS von ${me}: Ich brauche Hilfe. Ich treffe ${ck.otherName} über ZeitMit, ${ck.place}.` +
      (link ? `\nMein Standort: ${link}` : '') + '\nBitte ruf mich an. Wenn du mich nicht erreichst, ruf 112.';
  }
  return `🆘 SOS from ${me}: I need help. I’m meeting ${ck.otherName} through ZeitMit at ${ck.place}.` +
    (link ? `\nMy location: ${link}` : '') + '\nPlease call me. If you can’t reach me, call 112.';
}
