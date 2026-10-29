-- Customer profile details companions see when someone books them (all optional),
-- and moving a booking to another time (one open suggestion per booking).

ALTER TABLE users ADD COLUMN gender TEXT;                         -- 'w' | 'm' | 'nb'
ALTER TABLE users ADD COLUMN age INTEGER;                         -- 18–99, self-declared
ALTER TABLE users ADD COLUMN languages TEXT NOT NULL DEFAULT '[]';
ALTER TABLE users ADD COLUMN interests TEXT NOT NULL DEFAULT '[]';

-- A suggested new start time. It holds that time for others until it's accepted, declined or withdrawn.
ALTER TABLE bookings ADD COLUMN resched_at INTEGER;
ALTER TABLE bookings ADD COLUMN resched_by TEXT;                  -- 'customer' | 'companion'
ALTER TABLE bookings ADD COLUMN resched_asked INTEGER;            -- when it was suggested
ALTER TABLE bookings ADD COLUMN resched_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX bookings_resched ON bookings (companion_id, resched_at) WHERE resched_at IS NOT NULL;
