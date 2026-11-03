-- Every payment gets an invoice number in sequence (ZM-<year>-<seq>), emailed once. Kept when accounts are deleted:
-- invoices have to be kept, so user_id is a plain reference.
CREATE TABLE invoices (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,                     -- 'booking' | 'gift'
  ref_id TEXT NOT NULL UNIQUE,            -- the booking or gift it's for
  user_id TEXT NOT NULL,
  total INTEGER NOT NULL,                 -- cents
  sent INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- The language the app shows, for emails to people whose setting follows the phone ('auto').
ALTER TABLE users ADD COLUMN ui_lang TEXT;
