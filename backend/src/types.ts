export type Env = {
  DB: D1Database;
  CHAT: DurableObjectNamespace;
  /** One room per video date: connects the two phones and counts the time they're on the call together. */
  CALLS: DurableObjectNamespace;
  APP_NAME: string;
  ADMIN_EMAILS: string;
  EMAIL_FROM: string;
  /** Signs session tokens. Set as a Worker secret by the deploy workflow. */
  JWT_SECRET: string;
  /** Sends login codes by email. */
  RESEND_API_KEY?: string;
  /**
   * "true" returns login codes in the API response when email isn't configured.
   * Testing only: anyone could log in as any email, so admin access is disabled while it's on.
   */
  DEV_LOGIN_CODES?: string;
  /** Brevo transactional email (free 300/day). Sender must be verified in Brevo. */
  BREVO_API_KEY?: string;
  EMAIL_FROM_ADDRESS?: string;
  /** Stripe secret key (sk_test_… for test mode). Without it, payments are simulated. */
  STRIPE_SECRET_KEY?: string;
  /** Override for tests (mock Stripe server). */
  STRIPE_API_BASE?: string;
  /** Override for tests (mock Brevo server). */
  BREVO_API_BASE?: string;
  /** Seller details printed on every invoice (legal name, address, tax number or VAT ID), one per line or split by "|". */
  INVOICE_DETAILS?: string;
  /**
   * Optional Cloudflare TURN key (dashboard → Realtime → TURN): relays video dates on networks that block direct
   * connections. Free up to 1,000 GB a month. Without it, calls connect directly (most networks).
   */
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
  /** Seconds two people must be on a video date together before the payment is released (600; tests shorten it). */
  CALL_RELEASE_SECONDS?: string;
};

/** The activity that happens over video in the app (no meeting place, check-in or meet code). */
export const VIDEO_ACT = 'call';

export type AuthUser = { id: string; email: string; role: 'customer' | 'admin' };

export type AppEnv = { Bindings: Env; Variables: { user: AuthUser } };

export const ACTIVITIES = [
  'date', 'plusone', 'family', 'call', 'coffee', 'dinner', 'walks',
  'movies', 'gaming', 'shopping', 'sports', 'culture', 'language',
] as const;
export type ActId = (typeof ACTIVITIES)[number];

/** Date-style activities: require the customer to accept the companion's boundaries. */
export const ROMANTIC: ActId[] = ['date', 'plusone', 'family', 'call'];

export const ACT_LABEL: Record<ActId, string> = {
  date: 'Date', plusone: 'Plus-one', family: 'Meet the family', call: 'Video date', coffee: 'Coffee',
  dinner: 'Dinner', walks: 'City Walks', movies: 'Movies', gaming: 'Gaming', shopping: 'Shopping',
  sports: 'Sports', culture: 'Culture', language: 'Language',
};

export const NEVER_OFFERED = ['Kissing or intimacy', 'Private or home locations', 'Overnight or hotel plans', 'Meeting or paying off ZeitMit'];
export const BOUNDARY_OPTIONS = ['Holding hands', 'Arm in arm', 'Hug hello', 'Couple photos', 'Introduced as a partner', 'Friendly hug hello'];
export const LANGUAGES = ['German', 'English', 'French', 'Spanish', 'Italian', 'Turkish', 'Japanese'];
export const WINDOWS = ['am', 'pm', 'eve'] as const;
export const SERVICE_FEE = 0.1;
/** What stood out at a meet-up, for the private safety feedback (the app offers the same). */
export const FEEDBACK_GOOD = ['Respectful', 'Kept to boundaries', 'On time', 'Friendly'];
export const FEEDBACK_CONCERNS = ['Pushy or rude', 'Crossed boundaries', 'Asked for contact details', 'Wanted to meet outside ZeitMit', 'Made me uncomfortable'];

/** Customers cancel for free until this many hours before the start. */
export const FREE_CANCEL_HOURS = 24;
/** An in-person request waits this long for the companion's answer (at the latest until an hour before the start). */
export const REPLY_HOURS = 2;
/** Video dates are confirmed at once, so a customer can still cancel one for free this many minutes after booking it. */
export const VIDEO_GRACE_MIN = 10;
