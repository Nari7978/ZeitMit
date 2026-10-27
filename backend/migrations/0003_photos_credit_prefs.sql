-- Photos (stored in D1 to stay on the free plan; images are resized on the phone to ~100 KB),
-- account credit from gift codes, and per-user settings.

CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('avatar', 'companion', 'id')),
  mime TEXT NOT NULL DEFAULT 'image/jpeg',
  data TEXT NOT NULL,                     -- base64
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX photos_owner ON photos(owner_id, kind);

ALTER TABLE users ADD COLUMN avatar_id TEXT;
ALTER TABLE users ADD COLUMN credit INTEGER NOT NULL DEFAULT 0;          -- cents
ALTER TABLE users ADD COLUMN prefs TEXT NOT NULL DEFAULT '{}';         -- JSON settings
ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'auto';    -- 'auto' | 'en' | 'de'

ALTER TABLE companions ADD COLUMN photo_id TEXT;
ALTER TABLE companions ADD COLUMN id_photo_id TEXT;                    -- deleted after review

ALTER TABLE bookings ADD COLUMN credit_used INTEGER NOT NULL DEFAULT 0;  -- cents of gift credit applied
ALTER TABLE bookings ADD COLUMN payment_ref TEXT;                        -- Stripe PaymentIntent id

ALTER TABLE gifts ADD COLUMN redeemed_at INTEGER;
