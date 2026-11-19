-- Admin: a video date paid in full by ZeitMit, and companions' profile changes waiting for review.
-- 1) bookings.topup: cents ZeitMit pays the companion on top of what the customer paid (support's "Pay in full" for a
--    video date paid in part). It counts in the companion's earnings; the customer's amounts don't change.
ALTER TABLE bookings ADD COLUMN topup INTEGER NOT NULL DEFAULT 0;

-- 2) profile_changes: an approved companion's new About text, tagline, listing photo or more photos wait for review;
--    customers see the old version until then. `value` is the new text, the new photo's id, or the new gallery (JSON
--    ids, in order); `previous` what was live when it was sent. One waiting change per field: a newer one replaces it.
CREATE TABLE profile_changes (
  id TEXT PRIMARY KEY,
  companion_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field TEXT NOT NULL CHECK (field IN ('about', 'tagline', 'photo', 'gallery')),
  value TEXT NOT NULL,
  previous TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'replaced')),
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  decided_at INTEGER
);
CREATE INDEX profile_changes_status ON profile_changes (status, created_at);
CREATE UNIQUE INDEX profile_changes_one_waiting ON profile_changes (companion_id, field) WHERE status = 'pending';
