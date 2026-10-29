-- Companion payouts: companions request their available earnings, ZeitMit sends a bank transfer
-- and marks the request as paid (or rejects it, which returns the amount to their balance).

CREATE TABLE payout_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  holder_name TEXT NOT NULL,
  iban TEXT NOT NULL,                      -- normalised: upper case, no spaces
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE payouts (
  id TEXT PRIMARY KEY,
  companion_id TEXT NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK (amount > 0), -- cents
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'paid', 'rejected')),
  holder_name TEXT NOT NULL,               -- bank details as they were when requested
  iban TEXT NOT NULL,
  reference TEXT,                          -- transfer reference added by ZeitMit
  note TEXT,                               -- reason when rejected
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  decided_at INTEGER
);
CREATE INDEX payouts_companion ON payouts (companion_id, created_at);
CREATE INDEX payouts_status ON payouts (status, created_at);
-- At most one open request per companion.
CREATE UNIQUE INDEX payouts_one_open ON payouts (companion_id) WHERE status = 'requested';

-- When a booking's money was released to the companion (meet code or late cancellation):
-- earnings become withdrawable a short while after that.
ALTER TABLE bookings ADD COLUMN released_at INTEGER;
UPDATE bookings SET released_at = updated_at WHERE pay_status = 'released';
