-- After a meet-up each side can tell the team privately how it went: whether they felt safe, how respectful the
-- other person was (1–5 stars), what stood out, and a note. Only admins see it. One answer per person per booking.
CREATE TABLE meet_feedback (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  from_id TEXT NOT NULL,
  about_id TEXT NOT NULL,
  role TEXT NOT NULL,                    -- the sender's side: 'customer' | 'companion'
  safe TEXT NOT NULL,                    -- 'yes' | 'unsure' | 'no'
  stars INTEGER NOT NULL,                -- how respectful the other person was, 1–5
  tags TEXT NOT NULL DEFAULT '[]',       -- JSON list of what stood out
  note TEXT NOT NULL DEFAULT '',
  concern INTEGER NOT NULL DEFAULT 0,    -- not clearly safe, 2 stars or fewer, or a concern ticked
  status TEXT NOT NULL DEFAULT 'open',   -- 'open' | 'reviewed'
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (booking_id, from_id)
);
CREATE INDEX meet_feedback_about ON meet_feedback (about_id);
CREATE INDEX meet_feedback_open ON meet_feedback (concern, status);

-- Set once both sides have been asked (after the meet-up ended).
ALTER TABLE bookings ADD COLUMN feedback_asked INTEGER NOT NULL DEFAULT 0;
