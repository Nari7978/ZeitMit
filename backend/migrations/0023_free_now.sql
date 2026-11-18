-- Free now: a companion who is free for a video date right now can be booked on the spot, like a ride.
-- 1) The companion's switch: on until free_now_until (unix; NULL = off). It only counts while their app has checked in
--    within the last 10 minutes (free_now_seen). free_now_misses counts the requests in a row they let run out:
--    at 3 it switches off, and free_now_paused says when, for the notice in their app.
ALTER TABLE companions ADD COLUMN free_now_until INTEGER;
ALTER TABLE companions ADD COLUMN free_now_seen INTEGER;
ALTER TABLE companions ADD COLUMN free_now_misses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companions ADD COLUMN free_now_paused INTEGER;

-- 2) A request to start a video date now (instant = 1): the companion has 2 minutes to answer, and the video date
--    starts when they accept (starts_at is set then). Every other request expires as before (migration 0022).
--    Must match expiryOf in src/lib/hours.ts.
ALTER TABLE bookings ADD COLUMN instant INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings DROP COLUMN expires_at;
ALTER TABLE bookings ADD COLUMN expires_at INTEGER GENERATED ALWAYS AS (CASE WHEN instant = 1 THEN created_at + 120 ELSE MAX(
  MIN(created_at + 86400, starts_at - 10800),
  CASE WHEN activity = 'call' THEN MIN(created_at + 600, starts_at - 600) ELSE MIN(created_at + 1800, starts_at - 3600) END
) END) VIRTUAL;
