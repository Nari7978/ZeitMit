// Emails about money and bookings: an invoice after every payment, and a confirmation with a calendar file when a
// booking is confirmed (or a confirmed one moves). Tables with inline styles: the layout email apps show reliably.
import type { Env } from '../types';
import { ACT_LABEL, FREE_CANCEL_HOURS, VIDEO_ACT, type ActId } from '../types';
import { sendEmail } from './notify';
import { stripeOn } from './stripe';
import { lengthText } from './hours';
import { dateIn, DEFAULT_TZ } from './time';
import { now } from './util';

type Lang = 'en' | 'de';

/** The person's language setting, or the language their app shows when it follows the phone. */
export const mailLang = (p: { language: string | null; ui_lang: string | null }): Lang =>
  p.language === 'de' || p.language === 'en' ? p.language : p.ui_lang === 'de' ? 'de' : 'en';

const ACT_DE: Record<ActId, string> = {
  date: 'Date', plusone: 'Begleitung', family: 'Familienbesuch', call: 'Video-Date', coffee: 'Kaffee', dinner: 'Abendessen',
  walks: 'Stadtspaziergang', movies: 'Kino', gaming: 'Spiele', shopping: 'Shopping', sports: 'Sport', culture: 'Kultur', language: 'Sprache',
};
const actName = (a: ActId, l: Lang) => (l === 'de' ? ACT_DE[a] : ACT_LABEL[a]);

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const firstName = (n: string | null) => (n || '').trim().split(/\s+/)[0] || '';

const locale = (l: Lang) => (l === 'de' ? 'de-DE' : 'en-GB');
const money = (cents: number, l: Lang) => new Intl.NumberFormat(locale(l), { style: 'currency', currency: 'EUR' }).format(cents / 100);
/** Dates and times in the reader's own zone (Berlin when their app hasn't said). */
const fmt = (unix: number, l: Lang, o: Intl.DateTimeFormatOptions, tz = DEFAULT_TZ) =>
  new Intl.DateTimeFormat(locale(l), { timeZone: tz, ...o }).format(new Date(unix * 1000));
const longDate = (u: number, l: Lang, tz?: string) => fmt(u, l, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }, tz);
const shortDate = (u: number, l: Lang, tz?: string) => fmt(u, l, { weekday: 'short', day: 'numeric', month: 'short' }, tz);
const clock = (u: number, l: Lang, tz?: string) => fmt(u, l, { hour: '2-digit', minute: '2-digit', hour12: false }, tz);
const dayOnly = (u: number, l: Lang) => fmt(u, l, { day: 'numeric', month: 'long', year: 'numeric' });
/** "2½ hours", "1 hour 15 minutes"; "2½ Stunden", "1 Stunde 15 Minuten". */
const lengthLabel = (h: number, l: Lang) => {
  const min = Math.round(h * 60);
  if (l !== 'de') return lengthText(min);
  const hh = Math.floor(min / 60), mm = min % 60;
  if (hh && mm === 30) return `${hh}½ Stunden`;
  return [hh ? `${hh} ${hh === 1 ? 'Stunde' : 'Stunden'}` : '', mm ? `${mm} Minuten` : ''].filter(Boolean).join(' ');
};
const decimal = (h: number, l: Lang) => new Intl.NumberFormat(locale(l), { maximumFractionDigits: 2 }).format(h);

// ---------- Layout ----------

const C = { sun: '#FFE94D', ink: '#111111', muted: '#55516A', line: '#E8E4D6', pink: '#FF4F8B', lilac: '#E6DEFF', footer: '#3D3A2A' };
const FONT = "Helvetica,Arial,'Segoe UI',sans-serif";

type Block = { html: string; text: string };

/** Label and value rows. Values are plain text (escaped here); line breaks become <br>. */
function rows(items: [string, string][]): Block {
  const cell = 'padding:10px 0;border-top:1px solid ' + C.line + ';vertical-align:top';
  return {
    // Fixed columns line every section up; long values (an email address, the reference) wrap inside theirs.
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;margin:0 0 20px">${items.map(([k, v]) =>
      `<tr><td style="${cell};width:38%;padding-right:12px;color:${C.muted};font-size:13px">${esc(k)}</td><td style="${cell};font-weight:600;overflow-wrap:anywhere;word-break:break-word">${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('')}</table>`,
    text: items.map(([k, v]) => `${k}: ${v.replace(/\n/g, ', ')}`).join('\n'),
  };
}

/** Invoice lines, the total (bold, under a rule) and how it was paid. */
function prices(lines: [string, string][], total: [string, string], paid: [string, string][]): Block {
  const row = (k: string, v: string, style = '') => `<tr><td style="padding:7px 0;${style}">${esc(k)}</td><td align="right" style="padding:7px 0;white-space:nowrap;${style}">${esc(v)}</td></tr>`;
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 20px">${lines.map(([k, v]) => row(k, v)).join('')}`
      + row(total[0], total[1], `border-top:2px solid ${C.ink};font-weight:800;font-size:17px;padding-top:12px`)
      + paid.map(([k, v]) => row(k, v, `color:${C.muted};font-size:13px`)).join('') + '</table>',
    text: [...lines, total, ...paid].map(([k, v]) => `${k}: ${v}`).join('\n'),
  };
}

const heading = (s: string): Block => ({ html: `<h2 style="margin:0 0 4px;font:700 16px/1.3 ${FONT}">${esc(s)}</h2>`, text: `\n${s.toUpperCase()}` });
const note = (paras: string[]): Block => ({
  html: `<div style="background:${C.lilac};border-radius:14px;padding:14px 16px;margin:0 0 6px;font-size:14px;line-height:1.55">${paras.map((p) => `<p style="margin:0 0 8px">${esc(p)}</p>`).join('')}</div>`,
  text: paras.join('\n'),
});

function layout(env: Env, o: { lang: Lang; subject: string; preheader: string; title: string; intro: string; blocks: Block[]; footer: string[] }) {
  const html = `<!doctype html><html lang="${o.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(o.subject)}</title></head>
<body style="margin:0;padding:0;background:${C.sun}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.sun}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 16px;font:800 27px/1 ${FONT};letter-spacing:-0.5px;color:${C.ink}">zeitmit<span style="color:${C.pink}">!</span></td></tr>
<tr><td style="background:#ffffff;border:2px solid ${C.ink};border-radius:20px;padding:26px 24px 20px;font:15px/1.55 ${FONT};color:${C.ink}">
<h1 style="margin:0 0 8px;font:800 26px/1.15 ${FONT};letter-spacing:-0.5px">${esc(o.title)}</h1>
<p style="margin:0 0 22px;color:${C.muted}">${esc(o.intro)}</p>
${o.blocks.map((b) => b.html).join('\n')}
</td></tr>
<tr><td style="padding:18px 6px 0;font:12px/1.6 ${FONT};color:${C.footer}">${o.footer.map(esc).join('<br>')}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [`${env.APP_NAME}`, '', o.title, '', o.intro, ...o.blocks.map((b) => '\n' + b.text), '', '--', ...o.footer].join('\n');
  return { subject: o.subject, html, text };
}

/** The seller block on invoices: INVOICE_DETAILS lines, or just the name until they're set. */
const seller = (env: Env) => {
  const lines = (env.INVOICE_DETAILS ?? '').split(/\r?\n|\\n|\s*\|\s*/).map((s) => s.trim()).filter(Boolean);
  return lines.length ? lines : [env.APP_NAME, 'Berlin'];
};

// ---------- Invoice numbers ----------

/** Gives a payment its invoice number, once. Null if it has one already, so an invoice is never emailed twice. */
async function newInvoice(env: Env, kind: 'booking' | 'gift', refId: string, userId: string, total: number) {
  const row = await env.DB.prepare('INSERT INTO invoices (kind, ref_id, user_id, total) VALUES (?, ?, ?, ?) ON CONFLICT (ref_id) DO NOTHING RETURNING seq, created_at')
    .bind(kind, refId, userId, total).first<{ seq: number; created_at: number }>();
  if (!row) return null;
  const year = fmt(row.created_at, 'en', { year: 'numeric' });
  const number = `ZM-${year}-${String(row.seq).padStart(5, '0')}`;
  await env.DB.prepare('UPDATE invoices SET number = ? WHERE seq = ?').bind(number, row.seq).run();
  return { number, issued: row.created_at };
}
const markSent = (env: Env, number: string) => env.DB.prepare('UPDATE invoices SET sent = 1 WHERE number = ?').bind(number).run();

// ---------- Bookings ----------

type BookingMail = {
  id: string; customer_id: string; companion_id: string; activity: ActId; starts_at: number; duration_h: number; place: string; status: string;
  rate: number; subtotal: number; fee: number; total: number; credit_used: number; resched_count: number; created_at: number;
  ends_at: number; expires_at: number;
  companion_name: string; customer_name: string | null; customer_email: string; customer_language: string | null; customer_ui_lang: string | null;
  companion_email: string; companion_language: string | null; companion_ui_lang: string | null; customer_tz: string | null; companion_tz: string | null;
};
const BOOKING_SQL = `SELECT b.*, c.display_name AS companion_name, cu.name AS customer_name, cu.email AS customer_email, cu.language AS customer_language,
  cu.ui_lang AS customer_ui_lang, co.email AS companion_email, co.language AS companion_language, co.ui_lang AS companion_ui_lang,
  cu.timezone AS customer_tz, COALESCE(co.timezone, c.timezone) AS companion_tz
  FROM bookings b JOIN companions c ON c.user_id = b.companion_id JOIN users cu ON cu.id = b.customer_id JOIN users co ON co.id = b.companion_id
  WHERE b.id = ?`;

/** "Tuesday, 10 November 2026 · 23:00–01:00" in the reader's zone (a booking can run past midnight). */
const whenText = (b: BookingMail, l: Lang, tz?: string) => `${longDate(b.starts_at, l, tz)} · ${clock(b.starts_at, l, tz)}–${clock(b.ends_at, l, tz)}`;
const isVideo = (b: Pick<BookingMail, 'activity'>) => b.activity === VIDEO_ACT;
const placeText = (b: BookingMail, l: Lang) =>
  isVideo(b) ? (l === 'de' ? 'Videoanruf in der ZeitMit-App' : 'Video call in the ZeitMit app') : b.place || (l === 'de' ? 'Treffpunkt im Chat absprechen' : 'Agree on a place in the chat');
/** How a video date works, for the confirmation emails (it has no meet code or meeting place). */
const videoNote = (l: Lang, then: string) => (l === 'de'
  ? [`Tritt über die Buchung in der App bei, ab 10 Minuten vor Beginn. ${then}`, 'Nichts wird aufgezeichnet. Du kannst den Anruf jederzeit beenden oder melden.']
  : [`Join from the booking in the app, from 10 minutes before the start. ${then}`, 'Nothing is recorded. You can end the call or report at any time.']);

/** "16:30" today, otherwise "Sat 8 Nov at 01:00", in the reader's zone. */
const untilText = (u: number, l: Lang, tz = DEFAULT_TZ) => (dateIn(u, tz) === dateIn(now(), tz) ? clock(u, l, tz) : `${shortDate(u, l, tz)} ${l === 'de' ? 'um' : 'at'} ${clock(u, l, tz)}`);

/** After the payment, when the request reaches the companion: the customer's invoice. */
export async function sendBookingInvoice(env: Env, bookingId: string) {
  const b = await env.DB.prepare(BOOKING_SQL).bind(bookingId).first<BookingMail>();
  if (!b) return;
  const inv = await newInvoice(env, 'booking', b.id, b.customer_id, b.total);
  if (!inv) return;
  const l = mailLang({ language: b.customer_language, ui_lang: b.customer_ui_lang });
  const de = l === 'de';
  const who = b.companion_name;
  const act = actName(b.activity, l);
  const card = b.total - b.credit_used;
  const name = (b.customer_name || '').trim();
  const thanks = de ? `Danke${firstName(name) ? `, ${firstName(name)}` : ''}.` : `Thanks${firstName(name) ? `, ${firstName(name)}` : ''}.`;
  const tz = b.customer_tz || DEFAULT_TZ;
  // Every request (in person or video) waits for the companion: until 24 hours after it, or 3 hours before the start.
  const until = untilText(b.expires_at, l, tz);
  const m = layout(env, {
    lang: l,
    subject: de ? `Rechnung ${inv.number} · ${money(b.total, l)} · ${act} mit ${who}` : `Invoice ${inv.number} · ${money(b.total, l)} · ${act} with ${who}`,
    preheader: isVideo(b)
      ? (de ? `Deine Anfrage ist bei ${who}. ZeitMit hält das Geld bis zu eurem Video-Date.` : `Your request is with ${who}. ZeitMit holds the money until your video date.`)
      : de ? `Deine Anfrage ist bei ${who}. ZeitMit hält das Geld, bis ihr euch trefft.` : `Your request is with ${who}. ZeitMit holds the money until you meet.`,
    title: de ? 'Deine Rechnung' : 'Your invoice',
    intro: de ? `${thanks} Deine Anfrage ist bei ${who}. ${who} hat bis ${until} Zeit, sie anzunehmen.` : `${thanks} Your request is with ${who}, who has until ${until} to accept it.`,
    blocks: [
      rows([
        [de ? 'Rechnungsnummer' : 'Invoice number', inv.number],
        [de ? 'Rechnungsdatum' : 'Invoice date', dayOnly(inv.issued, l)],
        [de ? 'Rechnung an' : 'Billed to', [name, b.customer_email].filter(Boolean).join('\n')],
      ]),
      heading(de ? 'Buchung' : 'Booking'),
      rows([
        [de ? 'Was' : 'What', `${act} ${de ? 'mit' : 'with'} ${who}`],
        [de ? 'Wann' : 'When', whenText(b, l, tz)],
        [de ? 'Dauer' : 'Length', lengthLabel(b.duration_h, l)],
        [de ? 'Treffpunkt' : 'Meeting place', placeText(b, l)],
        [de ? 'Buchungsnummer' : 'Booking reference', b.id],
      ]),
      heading(de ? 'Betrag' : 'Amount'),
      prices(
        [
          [`${act} ${de ? 'mit' : 'with'} ${who} · ${money(b.rate, l)}${de ? '/Std.' : '/h'} × ${decimal(b.duration_h, l)} ${de ? 'Std.' : 'h'}`, money(b.subtotal, l)],
          [de ? 'Servicegebühr (10 %)' : 'Service fee (10%)', money(b.fee, l)],
        ],
        [de ? 'Gesamt' : 'Total', money(b.total, l)],
        [
          ...(b.credit_used ? [[de ? 'Bezahlt mit Guthaben' : 'Paid with gift credit', money(b.credit_used, l)] as [string, string]] : []),
          ...(card > 0 ? [[de ? 'Bezahlt per Karte' : 'Paid by card', money(card, l)] as [string, string]] : []),
        ],
      ),
      note(!stripeOn(env) && card > 0
        ? [de ? 'Testmodus: Es wurde keine Karte belastet.' : 'Test mode: no card was charged.']
        : isVideo(b)
          ? de
            ? [`ZeitMit hält das Geld sicher bis zu eurem Video-Date: Es geht an ${who}, wenn ihr 10 Minuten zusammen im Anruf wart.`,
              `Lehnt ${who} ab, antwortet nicht rechtzeitig, tritt nicht bei oder stornierst du mindestens ${FREE_CANCEL_HOURS} Stunden vorher, bekommst du alles zurück.`]
            : [`ZeitMit holds the money until your video date: it goes to ${who} once you’ve been on the call together for 10 minutes.`,
              `If ${who} declines, doesn’t answer in time or doesn’t join, or you cancel at least ${FREE_CANCEL_HOURS} hours before, you get everything back.`]
          : de
            ? [`ZeitMit hält das Geld sicher, bis ihr euch trefft: Es geht erst an ${who}, wenn du beim Treffen deinen 4-stelligen Treffcode teilst.`,
              `Lehnt ${who} ab, antwortet nicht rechtzeitig oder stornierst du mindestens ${FREE_CANCEL_HOURS} Stunden vorher, bekommst du alles zurück.`]
            : [`ZeitMit holds the money until you meet: it only goes to ${who} when you share your 4-digit meet code at the meet-up.`,
              `If ${who} declines or doesn’t answer in time, or you cancel at least ${FREE_CANCEL_HOURS} hours before, you get everything back.`]),
    ],
    footer: [...seller(env), de ? `Gesendet an ${b.customer_email} für deine Buchung bei ZeitMit.` : `Sent to ${b.customer_email} for your booking on ZeitMit.`],
  });
  if (await sendEmail(env, b.customer_email, m.subject, m.text, { html: m.html })) await markSent(env, inv.number);
}

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsTime = (unix: number) => new Date(unix * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** Calendar lines are at most 75 bytes; longer ones continue on the next line after a space. */
function fold(line: string) {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ''; }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const base64 = (s: string) => { let bin = ''; for (const x of new TextEncoder().encode(s)) bin += String.fromCharCode(x); return btoa(bin); };

/** An .ics file for the booking. Its UID stays the same and SEQUENCE grows with every move, so calendars update it. */
function calendarFile(b: BookingMail, title: string, description: string) {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ZeitMit//Bookings//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${b.id}@zeitmit.app`, `SEQUENCE:${b.resched_count}`, `DTSTAMP:${icsTime(now())}`,
    `DTSTART:${icsTime(b.starts_at)}`, `DTEND:${icsTime(b.starts_at + b.duration_h * 3600)}`,
    `SUMMARY:${icsText(title)}`, ...(isVideo(b) ? ['LOCATION:ZeitMit app (video call)'] : b.place ? [`LOCATION:${icsText(b.place)}`] : []), `DESCRIPTION:${icsText(description)}`,
    'STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'END:VEVENT', 'END:VCALENDAR',
  ].map(fold).join('\r\n') + '\r\n';
}

/** A booking was confirmed (or a confirmed one moved): both sides get the details and a calendar file. */
export async function sendBookingConfirmation(env: Env, bookingId: string, moved = false) {
  const b = await env.DB.prepare(BOOKING_SQL).bind(bookingId).first<BookingMail>();
  if (!b || b.status !== 'confirmed') return;
  const guest = firstName(b.customer_name) || 'Customer';
  const free = b.starts_at - FREE_CANCEL_HOURS * 3600;
  const ctz = b.customer_tz || DEFAULT_TZ, htz = b.companion_tz || DEFAULT_TZ;

  const forCustomer = () => {
    const l = mailLang({ language: b.customer_language, ui_lang: b.customer_ui_lang });
    const de = l === 'de';
    const who = b.companion_name;
    const act = actName(b.activity, l);
    const at = `${shortDate(b.starts_at, l, ctz)} ${de ? 'um' : 'at'} ${clock(b.starts_at, l, ctz)}`;
    const m = layout(env, {
      lang: l,
      subject: de ? `${moved ? 'Neue Zeit' : 'Bestätigt'}: ${act} mit ${who}, ${at}` : `${moved ? 'New time' : 'Confirmed'}: ${act} with ${who}, ${at}`,
      preheader: de ? `${act} mit ${who}, ${whenText(b, l, ctz)}.` : `${act} with ${who}, ${whenText(b, l, ctz)}.`,
      title: de ? (moved ? 'Deine Buchung hat eine neue Zeit' : 'Deine Buchung ist bestätigt') : moved ? 'Your booking has a new time' : 'Your booking is confirmed',
      intro: de
        ? (moved ? `Sie ist jetzt am ${longDate(b.starts_at, l, ctz)} um ${clock(b.starts_at, l, ctz)}. Die Kalenderdatei im Anhang aktualisiert deinen Kalender.`
          : `${who} hat deine Anfrage angenommen. Mit der Datei im Anhang trägst du sie in deinen Kalender ein.`)
        : moved ? `It’s now on ${longDate(b.starts_at, l, ctz)} at ${clock(b.starts_at, l, ctz)}. The calendar file attached updates your calendar.`
          : `${who} accepted your request. Add it to your calendar with the file attached.`,
      blocks: [
        rows([
          [de ? 'Mit' : 'With', who],
          [de ? 'Was' : 'What', act],
          [de ? 'Wann' : 'When', whenText(b, l, ctz)],
          [de ? 'Dauer' : 'Length', lengthLabel(b.duration_h, l)],
          [de ? 'Treffpunkt' : 'Meeting place', placeText(b, l)],
          [de ? 'Bezahlt' : 'Paid', isVideo(b)
            ? (de ? `${money(b.total, l)} · ZeitMit hält es bis zu eurem Video-Date` : `${money(b.total, l)} · held by ZeitMit until your video date`)
            : de ? `${money(b.total, l)} · ZeitMit hält es, bis ihr euch trefft` : `${money(b.total, l)} · held by ZeitMit until you meet`],
          [de ? 'Buchungsnummer' : 'Booking reference', b.id],
        ]),
        note([
          ...(isVideo(b)
            ? videoNote(l, de ? `Wenn ihr 10 Minuten zusammen im Anruf wart, geht die Zahlung an ${who}.` : `Once you’ve been on the call together for 10 minutes, the payment goes to ${who}.`).slice(0, 1)
            : [de ? `Zeig ${who} beim Treffen deinen 4-stelligen Treffcode aus der App, nicht vorher. Damit geht die Zahlung an ${who}.` : `Show ${who} your 4-digit meet code from the app when you meet, not before. That releases the payment.`]),
          ...(free > now() ? [de ? `Kostenlos stornieren kannst du bis ${shortDate(free, l, ctz)} um ${clock(free, l, ctz)}.` : `You can cancel for free until ${shortDate(free, l, ctz)} at ${clock(free, l, ctz)}.`] : []),
          isVideo(b) ? videoNote(l, '')[1]
            : de ? 'Trefft euch an einem öffentlichen Ort. In der Buchung kannst du einen Live-Check-in mit einer Vertrauensperson teilen.' : 'Meet in a public place. From the booking you can share a live check-in with someone you trust.',
        ]),
      ],
      footer: [env.APP_NAME, de ? `Gesendet an ${b.customer_email} für deine Buchung bei ZeitMit.` : `Sent to ${b.customer_email} for your booking on ZeitMit.`],
    });
    const ics = calendarFile(b, `${act} ${de ? 'mit' : 'with'} ${who} (ZeitMit)`, isVideo(b)
      ? (de ? 'Gebucht über ZeitMit. Tritt dem Videoanruf über deine Buchung in der App bei.' : 'Booked on ZeitMit. Join the video call from your booking in the app.')
      : de ? 'Gebucht über ZeitMit. Zeig deinen Treffcode erst beim Treffen.' : 'Booked on ZeitMit. Show your meet code when you meet, not before.');
    return sendEmail(env, b.customer_email, m.subject, m.text, { html: m.html, attachments: [{ name: 'zeitmit-booking.ics', content: base64(ics) }] });
  };

  const forCompanion = () => {
    const l = mailLang({ language: b.companion_language, ui_lang: b.companion_ui_lang });
    const de = l === 'de';
    const act = actName(b.activity, l);
    const at = `${shortDate(b.starts_at, l, htz)} ${de ? 'um' : 'at'} ${clock(b.starts_at, l, htz)}`;
    const m = layout(env, {
      lang: l,
      subject: de ? `${moved ? 'Neue Zeit' : 'Bestätigt'}: ${act} mit ${guest}, ${at}` : `${moved ? 'New time' : 'Confirmed'}: ${act} with ${guest}, ${at}`,
      preheader: de ? `${act} mit ${guest}, ${whenText(b, l, htz)}.` : `${act} with ${guest}, ${whenText(b, l, htz)}.`,
      title: de ? (moved ? 'Diese Buchung hat eine neue Zeit' : 'Buchung bestätigt') : moved ? 'This booking has a new time' : 'Booking confirmed',
      intro: de
        ? (moved ? `Sie ist jetzt am ${longDate(b.starts_at, l, htz)} um ${clock(b.starts_at, l, htz)}. Die Kalenderdatei im Anhang aktualisiert deinen Kalender.`
          : `Du hast die Anfrage von ${guest} angenommen. Mit der Datei im Anhang trägst du sie in deinen Kalender ein.`)
        : moved ? `It’s now on ${longDate(b.starts_at, l, htz)} at ${clock(b.starts_at, l, htz)}. The calendar file attached updates your calendar.`
          : `You accepted ${guest}’s request. Add it to your calendar with the file attached.`,
      blocks: [
        rows([
          [de ? 'Mit' : 'With', guest],
          [de ? 'Was' : 'What', act],
          [de ? 'Wann' : 'When', whenText(b, l, htz)],
          [de ? 'Dauer' : 'Length', lengthLabel(b.duration_h, l)],
          [de ? 'Treffpunkt' : 'Meeting place', placeText(b, l)],
          [de ? 'Du verdienst' : 'You earn', money(b.subtotal, l)],
          [de ? 'Buchungsnummer' : 'Booking reference', b.id],
        ]),
        note(isVideo(b)
          ? videoNote(l, de ? `Nach 10 Minuten gemeinsam im Anruf verdienst du ${money(b.subtotal, l)}.` : `After 10 minutes on the call together, you earn ${money(b.subtotal, l)}.`)
          : [
            de ? `Frag ${guest} beim Treffen nach dem 4-stelligen Treffcode und gib ihn in der App ein. Dann verdienst du ${money(b.subtotal, l)}.` : `At the meet-up, ask ${guest} for their 4-digit meet code and enter it in the app. That’s when you earn ${money(b.subtotal, l)}.`,
            de ? 'Trefft euch an einem öffentlichen Ort. In der Buchung kannst du einen Live-Check-in mit einer Vertrauensperson teilen.' : 'Meet in a public place. From the booking you can share a live check-in with someone you trust.',
          ]),
      ],
      footer: [env.APP_NAME, de ? `Gesendet an ${b.companion_email} für deine Buchung bei ZeitMit.` : `Sent to ${b.companion_email} for your booking on ZeitMit.`],
    });
    const ics = calendarFile(b, `${act} ${de ? 'mit' : 'with'} ${guest} (ZeitMit)`, isVideo(b)
      ? (de ? 'Gebucht über ZeitMit. Tritt dem Videoanruf über die Buchung in der App bei.' : 'Booked on ZeitMit. Join the video call from the booking in the app.')
      : de ? 'Gebucht über ZeitMit. Gib den Treffcode beim Treffen in der App ein.' : 'Booked on ZeitMit. Enter the meet code in the app at the meet-up.');
    return sendEmail(env, b.companion_email, m.subject, m.text, { html: m.html, attachments: [{ name: 'zeitmit-booking.ics', content: base64(ics) }] });
  };

  await Promise.all([forCustomer(), forCompanion()]);
}

// ---------- Gift cards ----------

/** After a gift card is paid: the buyer's invoice. */
export async function sendGiftInvoice(env: Env, giftId: string) {
  const g = await env.DB.prepare(
    `SELECT g.id, g.sender_id, g.recipient, g.amount, g.expires_at, u.name, u.email, u.language, u.ui_lang FROM gifts g JOIN users u ON u.id = g.sender_id WHERE g.id = ? AND g.paid = 1`,
  ).bind(giftId).first<{ id: string; sender_id: string; recipient: string; amount: number; expires_at: number; name: string | null; email: string; language: string | null; ui_lang: string | null }>();
  if (!g) return;
  const inv = await newInvoice(env, 'gift', g.id, g.sender_id, g.amount);
  if (!inv) return;
  const l = mailLang(g);
  const de = l === 'de';
  const name = (g.name || '').trim();
  const m = layout(env, {
    lang: l,
    subject: de ? `Rechnung ${inv.number} · ${money(g.amount, l)} · ZeitMit-Geschenkkarte` : `Invoice ${inv.number} · ${money(g.amount, l)} · ZeitMit gift card`,
    preheader: de ? `Deine Geschenkkarte für ${g.recipient} ist bereit.` : `Your gift card for ${g.recipient} is ready.`,
    title: de ? 'Deine Rechnung' : 'Your invoice',
    intro: de
      ? `Danke${firstName(name) ? `, ${firstName(name)}` : ''}. Deine Geschenkkarte für ${g.recipient} ist bereit: Teile den Code aus der App.`
      : `Thanks${firstName(name) ? `, ${firstName(name)}` : ''}. Your gift card for ${g.recipient} is ready to share from the app.`,
    blocks: [
      rows([
        [de ? 'Rechnungsnummer' : 'Invoice number', inv.number],
        [de ? 'Rechnungsdatum' : 'Invoice date', dayOnly(inv.issued, l)],
        [de ? 'Rechnung an' : 'Billed to', [name, g.email].filter(Boolean).join('\n')],
      ]),
      heading(de ? 'Geschenkkarte' : 'Gift card'),
      rows([
        [de ? 'Für' : 'For', g.recipient],
        [de ? 'Gültig bis' : 'Valid until', dayOnly(g.expires_at, l)],
      ]),
      heading(de ? 'Betrag' : 'Amount'),
      prices([[de ? 'ZeitMit-Geschenkkarte' : 'ZeitMit gift card', money(g.amount, l)]], [de ? 'Gesamt' : 'Total', money(g.amount, l)],
        [[de ? 'Bezahlt per Karte' : 'Paid by card', money(g.amount, l)]]),
      ...(stripeOn(env) ? [] : [note([de ? 'Testmodus: Es wurde keine Karte belastet.' : 'Test mode: no card was charged.'])]),
    ],
    footer: [...seller(env), de ? `Gesendet an ${g.email} für deinen Kauf bei ZeitMit.` : `Sent to ${g.email} for your purchase on ZeitMit.`],
  });
  if (await sendEmail(env, g.email, m.subject, m.text, { html: m.html })) await markSent(env, inv.number);
}

/** Sends after the response when there is one (and waits otherwise). A failed email never fails what caused it. */
export async function inBackground(ctx: { waitUntil(p: Promise<unknown>): void } | undefined, job: () => Promise<unknown>) {
  const p = job().catch((e) => console.error('Email failed', e));
  if (ctx) ctx.waitUntil(p);
  else await p;
}
