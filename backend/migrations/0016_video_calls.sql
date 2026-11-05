-- Video dates happen in the app. The call room records when each side first joined and how long both were on the
-- call together (seconds); after the booked end the cron settles no-shows once (call_closed).
ALTER TABLE bookings ADD COLUMN call_customer_at INTEGER;
ALTER TABLE bookings ADD COLUMN call_companion_at INTEGER;
ALTER TABLE bookings ADD COLUMN call_together_s INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN call_closed INTEGER;
