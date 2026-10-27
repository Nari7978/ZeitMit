-- ZeitMit core schema (Cloudflare D1 / SQLite)

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  age_confirmed INTEGER NOT NULL DEFAULT 0,
  push_token TEXT,
  suspended INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE login_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE companions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  age INTEGER,
  show_age INTEGER NOT NULL DEFAULT 1,
  pronouns TEXT,
  gender TEXT NOT NULL DEFAULT 'nb' CHECK (gender IN ('w', 'm', 'nb')),
  area TEXT NOT NULL DEFAULT '',
  dist TEXT NOT NULL DEFAULT '',
  hue INTEGER NOT NULL DEFAULT 60,
  photo_note TEXT NOT NULL DEFAULT '',
  tagline TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  rate INTEGER NOT NULL CHECK (rate BETWEEN 15 AND 80),
  interests TEXT NOT NULL DEFAULT '[]',   -- JSON string[]
  languages TEXT NOT NULL DEFAULT '[]',   -- JSON [lang, level][]
  activities TEXT NOT NULL DEFAULT '[]',  -- JSON ActId[]
  boundaries TEXT NOT NULL DEFAULT '[]',  -- JSON string[]
  lgbtq INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  id_verified INTEGER NOT NULL DEFAULT 0,
  rating REAL,
  review_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Weekly availability: day 0=Mon..6=Sun, win 'am' | 'pm' | 'eve'
CREATE TABLE availability (
  companion_id TEXT NOT NULL REFERENCES companions(user_id) ON DELETE CASCADE,
  day INTEGER NOT NULL CHECK (day BETWEEN 0 AND 6),
  win TEXT NOT NULL CHECK (win IN ('am', 'pm', 'eve')),
  PRIMARY KEY (companion_id, day, win)
);

CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES users(id),
  companion_id TEXT NOT NULL REFERENCES companions(user_id),
  activity TEXT NOT NULL,
  starts_at INTEGER NOT NULL,           -- unix seconds
  duration_h INTEGER NOT NULL CHECK (duration_h BETWEEN 1 AND 4),
  place TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
  cancel_note TEXT,
  boundaries_agreed INTEGER NOT NULL DEFAULT 0,
  rate INTEGER NOT NULL,                -- euro cents per hour at booking time
  subtotal INTEGER NOT NULL,            -- cents
  fee INTEGER NOT NULL,                 -- cents (10%)
  total INTEGER NOT NULL,               -- cents
  pay_status TEXT NOT NULL DEFAULT 'held' CHECK (pay_status IN ('held', 'released', 'refunded')),
  meet_code TEXT NOT NULL,
  code_attempts INTEGER NOT NULL DEFAULT 0,
  reviewed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX bookings_customer ON bookings(customer_id, status);
CREATE INDEX bookings_companion ON bookings(companion_id, status);
CREATE INDEX bookings_pending ON bookings(status, created_at);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  booking_id TEXT UNIQUE REFERENCES bookings(id),
  companion_id TEXT NOT NULL REFERENCES companions(user_id),
  author_name TEXT NOT NULL,
  activity TEXT NOT NULL,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  text TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX reviews_companion ON reviews(companion_id, created_at);

CREATE TABLE saved (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  companion_id TEXT NOT NULL REFERENCES companions(user_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, companion_id)
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES users(id),
  companion_id TEXT NOT NULL REFERENCES companions(user_id),
  booking_id TEXT REFERENCES bookings(id),
  last_at INTEGER NOT NULL DEFAULT (unixepoch()),
  customer_unread INTEGER NOT NULL DEFAULT 0,
  companion_unread INTEGER NOT NULL DEFAULT 0,
  UNIQUE (customer_id, companion_id)
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  flagged INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX messages_conv ON messages(conversation_id, created_at);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  icon TEXT NOT NULL,
  tone TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  go TEXT NOT NULL DEFAULT '',
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX notifications_user ON notifications(user_id, created_at);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id),
  target_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE blocks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, blocked_id)
);

CREATE TABLE checkins (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  contact_name TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  share_location INTEGER NOT NULL DEFAULT 1,
  every_min INTEGER NOT NULL DEFAULT 30,  -- 0 = start & end only
  next_due INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'alerted', 'sos')),
  last_lat REAL,
  last_lng REAL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX checkins_due ON checkins(status, next_due);

CREATE TABLE gifts (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES users(id),
  recipient TEXT NOT NULL,
  amount INTEGER NOT NULL,                -- cents
  message TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL UNIQUE,
  redeemed_by TEXT REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
