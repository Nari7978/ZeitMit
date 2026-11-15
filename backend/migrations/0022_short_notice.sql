-- Short-notice bookings: video dates from 20 minutes ahead, in person from 1½ hours, when the companion allows it.
-- 1) How far ahead each companion can be booked, per kind of date (minutes). The shortest by default; companions can
--    choose longer in their listing (src/lib/hours.ts NOTICE_OPTIONS).
ALTER TABLE companions ADD COLUMN notice_video INTEGER NOT NULL DEFAULT 20;
ALTER TABLE companions ADD COLUMN notice_meet INTEGER NOT NULL DEFAULT 90;

-- 2) Until when a request can be accepted. Sent well ahead: until 3 hours before the start, and within 24 hours of the
--    request (as before). Closer than that: within 10 minutes for a video date or 30 minutes in person, and at least
--    10 minutes (video) or an hour (in person) before the start. Must match expiryOf in src/lib/hours.ts.
--    (`accept_by`, the old "3 hours before the start", was never read: it goes.)
ALTER TABLE bookings DROP COLUMN expires_at;
ALTER TABLE bookings DROP COLUMN accept_by;
ALTER TABLE bookings ADD COLUMN expires_at INTEGER GENERATED ALWAYS AS (MAX(
  MIN(created_at + 86400, starts_at - 10800),
  CASE WHEN activity = 'call' THEN MIN(created_at + 600, starts_at - 600) ELSE MIN(created_at + 1800, starts_at - 3600) END
)) VIRTUAL;
