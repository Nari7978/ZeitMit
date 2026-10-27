export type Env = {
  DB: D1Database;
  CHAT: DurableObjectNamespace;
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
};

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
