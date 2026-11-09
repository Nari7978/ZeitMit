-- Flexible 24-hour availability and booking, with one calendar for in-person and video dates.
--
-- 1) Booking statuses: pending, confirmed, rejected, expired, conflicted, cancelled, completed. SQLite can't change a
--    CHECK, and rebuilding bookings would touch the chats, reviews, check-ins and feedback that point at it, so the
--    status column is swapped like duration_h was in 0012: copied aside, dropped with its indexes, added back with
--    the new rule. Requests that were declined or went unanswered before get their own statuses.
-- 2) End time, acceptance deadline (3 hours before the start), expiry (that, or 24 hours after the request, whichever
--    is sooner) and kind of date are worked out by the database from each booking's own start, length, creation time
--    and activity, so they can never disagree with them. (src/lib/hours.ts uses the same 3 and 24 hours.)
-- 3) One calendar: weekly hours and dates' own hours as clock-time ranges that can run past midnight, each open for
--    both kinds of date, in person only or video only, plus blocked periods. Converted from the four tables of fixed
--    morning / afternoon / evening windows (in-person and video, weekly and per date), keeping what each allowed.
-- 4) Time zones: a companion's hours are in their own zone (Berlin to start with); a person's own zone (sent by their app)
--    is used for the times in their notifications and emails.

-- 1) Statuses
ALTER TABLE bookings ADD COLUMN status_tmp TEXT;
UPDATE bookings SET status_tmp = CASE
  WHEN status = 'cancelled' AND cancelled_by = 'companion' AND cancel_note LIKE 'Declined%' THEN 'rejected'
  WHEN status = 'cancelled' AND cancelled_by = 'system' AND cancel_note LIKE 'No reply in time%' THEN 'expired'
  ELSE status END;
DROP INDEX IF EXISTS bookings_customer;
DROP INDEX IF EXISTS bookings_companion;
DROP INDEX IF EXISTS bookings_pending;
ALTER TABLE bookings DROP COLUMN status;
ALTER TABLE bookings ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired', 'conflicted', 'cancelled', 'completed'));
UPDATE bookings SET status = status_tmp;
ALTER TABLE bookings DROP COLUMN status_tmp;

-- When the companion accepted or declined, or the request expired or lost its time; and the booking that took it.
ALTER TABLE bookings ADD COLUMN decided_at INTEGER;
ALTER TABLE bookings ADD COLUMN conflict_with TEXT;

-- 2) Worked out from each booking's own fields
ALTER TABLE bookings ADD COLUMN ends_at INTEGER GENERATED ALWAYS AS (starts_at + CAST(ROUND(duration_h * 3600) AS INTEGER)) VIRTUAL;
ALTER TABLE bookings ADD COLUMN accept_by INTEGER GENERATED ALWAYS AS (starts_at - 10800) VIRTUAL;
ALTER TABLE bookings ADD COLUMN expires_at INTEGER GENERATED ALWAYS AS (MIN(created_at + 86400, starts_at - 10800)) VIRTUAL;
ALTER TABLE bookings ADD COLUMN kind TEXT GENERATED ALWAYS AS (CASE WHEN activity = 'call' THEN 'video' ELSE 'meet' END) VIRTUAL;

CREATE INDEX bookings_customer ON bookings (customer_id, status);
CREATE INDEX bookings_companion ON bookings (companion_id, status, starts_at);
CREATE INDEX bookings_pending ON bookings (status, created_at);

-- 4) Time zones
ALTER TABLE companions ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Europe/Berlin';
ALTER TABLE users ADD COLUMN timezone TEXT;

-- 3) One calendar
CREATE TABLE hours_week (
  companion_id TEXT PRIMARY KEY REFERENCES companions(user_id) ON DELETE CASCADE,
  ranges TEXT NOT NULL DEFAULT '[]', -- [[weekday 0=Mon, "HH:MM", "HH:MM", "both"|"meet"|"video"], …]; an end at or before the start is the next day
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE hours_days (
  companion_id TEXT NOT NULL REFERENCES companions(user_id) ON DELETE CASCADE,
  date TEXT NOT NULL,                -- YYYY-MM-DD in her zone; its ranges replace that weekday's weekly hours
  ranges TEXT NOT NULL DEFAULT '[]', -- [["HH:MM", "HH:MM", kind], …]; empty: a day off
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (companion_id, date)
);
CREATE INDEX hours_days_date ON hours_days (date);
CREATE TABLE hours_blocks (
  id TEXT PRIMARY KEY,
  companion_id TEXT NOT NULL REFERENCES companions(user_id) ON DELETE CASCADE,
  starts_at INTEGER NOT NULL,        -- unix; closed whatever the hours say, until she removes it
  ends_at INTEGER NOT NULL CHECK (ends_at > starts_at),
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX hours_blocks_companion ON hours_blocks (companion_id, ends_at);

-- Weekly windows → ranges. A window in both tables is for both kinds; one only in the in-person table is for both
-- when the companion offers no video dates (then it's simply her hours), otherwise in person only; one only in the
-- video table is for video only.
WITH wins(w, f, t) AS (VALUES ('am', '09:00', '12:00'), ('pm', '12:00', '17:00'), ('eve', '17:00', '24:00')),
offers(cid, video) AS (SELECT user_id, EXISTS (SELECT 1 FROM json_each(activities) WHERE value = 'call') FROM companions),
cells(cid, day, w, m, v) AS (
  SELECT companion_id, day, win, 1, 0 FROM availability
  UNION ALL SELECT companion_id, day, win, 0, 1 FROM availability_video
),
merged(cid, day, w, m, v) AS (SELECT cid, day, w, MAX(m), MAX(v) FROM cells GROUP BY cid, day, w)
INSERT INTO hours_week (companion_id, ranges)
SELECT merged.cid, json_group_array(json_array(merged.day, wins.f, wins.t,
    CASE WHEN merged.m = 1 AND merged.v = 1 THEN 'both' WHEN merged.m = 1 AND NOT offers.video THEN 'both' WHEN merged.m = 1 THEN 'meet' ELSE 'video' END))
FROM merged JOIN wins ON wins.w = merged.w JOIN offers ON offers.cid = merged.cid
GROUP BY merged.cid;

-- Dates' own hours → one list per date. The same hours for both kinds stay one list (for both); different ones are
-- kept per kind; a date that had own hours for one kind only keeps the other kind's weekly windows that day.
WITH wins(w, f, t) AS (VALUES ('am', '09:00', '12:00'), ('pm', '12:00', '17:00'), ('eve', '17:00', '24:00')),
offers(cid, video) AS (SELECT user_id, EXISTS (SELECT 1 FROM json_each(activities) WHERE value = 'call') FROM companions),
dm(cid, date, ranges) AS (SELECT companion_id, date, ranges FROM availability_dates),
dv(cid, date, ranges) AS (SELECT companion_id, date, ranges FROM availability_dates_video),
keys(cid, date) AS (SELECT cid, date FROM dm UNION SELECT cid, date FROM dv),
parts(cid, date, f, t, kind) AS (
  SELECT k.cid, k.date, json_extract(r.value, '$[0]'), json_extract(r.value, '$[1]'),
    CASE WHEN dv.ranges = dm.ranges OR NOT o.video THEN 'both' ELSE 'meet' END
  FROM keys k JOIN dm ON dm.cid = k.cid AND dm.date = k.date JOIN offers o ON o.cid = k.cid
    LEFT JOIN dv ON dv.cid = k.cid AND dv.date = k.date, json_each(dm.ranges) r
  UNION ALL
  SELECT k.cid, k.date, json_extract(r.value, '$[0]'), json_extract(r.value, '$[1]'), 'video'
  FROM keys k JOIN dv ON dv.cid = k.cid AND dv.date = k.date LEFT JOIN dm ON dm.cid = k.cid AND dm.date = k.date, json_each(dv.ranges) r
  WHERE dm.ranges IS NULL OR dm.ranges <> dv.ranges
  UNION ALL
  SELECT k.cid, k.date, wins.f, wins.t, 'video'
  FROM keys k JOIN dm ON dm.cid = k.cid AND dm.date = k.date LEFT JOIN dv ON dv.cid = k.cid AND dv.date = k.date
    JOIN availability_video av ON av.companion_id = k.cid AND av.day = (CAST(strftime('%w', k.date) AS INTEGER) + 6) % 7
    JOIN wins ON wins.w = av.win
  WHERE dv.ranges IS NULL
  UNION ALL
  SELECT k.cid, k.date, wins.f, wins.t, 'meet'
  FROM keys k JOIN dv ON dv.cid = k.cid AND dv.date = k.date LEFT JOIN dm ON dm.cid = k.cid AND dm.date = k.date
    JOIN availability a ON a.companion_id = k.cid AND a.day = (CAST(strftime('%w', k.date) AS INTEGER) + 6) % 7
    JOIN wins ON wins.w = a.win
  WHERE dm.ranges IS NULL
)
INSERT INTO hours_days (companion_id, date, ranges)
SELECT k.cid, k.date, (SELECT json_group_array(json_array(p.f, p.t, p.kind)) FROM parts p WHERE p.cid = k.cid AND p.date = k.date)
FROM keys k;

DROP TABLE availability;
DROP TABLE availability_video;
DROP TABLE availability_dates;
DROP TABLE availability_dates_video;
