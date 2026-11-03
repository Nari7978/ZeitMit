-- Bookings of any length from 1 to 8 hours in half-hour steps (was whole hours from 1 to 4). The API checks the length.
-- SQLite can't change a column's CHECK, but dropping a column drops its own CHECK with it, so duration_h is copied
-- aside, dropped and added back without the old rule. No table rebuild: conversations, reviews and check-ins point
-- at bookings, and dropping the bookings table would cascade into them.

ALTER TABLE bookings ADD COLUMN duration_tmp REAL;
UPDATE bookings SET duration_tmp = duration_h;
ALTER TABLE bookings DROP COLUMN duration_h;
ALTER TABLE bookings ADD COLUMN duration_h REAL NOT NULL DEFAULT 1;
UPDATE bookings SET duration_h = duration_tmp;
ALTER TABLE bookings DROP COLUMN duration_tmp;
