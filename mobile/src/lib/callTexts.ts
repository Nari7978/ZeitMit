// The texts the native Android side shows by itself (incoming video dates, the ongoing call, Free now), in the language
// the app shows. Kept apart from the store so both can use it.
import { nativeCalls } from '../../modules/zeitmit-calls';
import { t } from '../i18n';

/** English templates; `{…}` is filled in on the phone. */
const TEXTS: Record<string, string> = {
  instantTitle: 'Video date request from {who}',
  instantBody: '{length} · You earn {earn} · Answer within 2 minutes',
  ringJoinTitle: '{who} is waiting in your video date',
  ringPingTitle: '{who} is pinging you',
  ringBody: 'Join your video date now',
  accept: 'Accept', decline: 'Decline', join: 'Join now', notNow: 'Not now',
  channelIncoming: 'Incoming video dates', channelOngoing: 'Video date in progress', channelFreeNow: 'Free now',
  ongoingTitle: 'Video date with {who}', ongoingBody: 'Tap to go back to the call', hangUp: 'Hang up',
  freeNowTitle: 'Free now for video dates', freeNowBody: 'Until {time} · Your phone rings for requests', turnOff: 'Turn off',
  min: '{n} min', hour: '1 hour', hours: '{n} hours', halfHours: '{n}½ hours', hm: '{h} h {m} min',
};

/** Sends the notification texts in the language the app shows now. */
export function syncCallTexts() {
  if (!nativeCalls.available) return;
  nativeCalls.setTexts(Object.fromEntries(Object.entries(TEXTS).map(([k, v]) => [k, t(v)])));
}

