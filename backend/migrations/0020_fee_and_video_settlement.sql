-- 1) Once the companion has accepted a booking, ZeitMit keeps its service fee whatever happens. `total` stays the
--    price; what went back to the customer is kept in `refunded` (cents), so they paid `total - refunded`, and
--    `subtotal` becomes what the companion finally earned. (Bookings refunded before this have 0 here: they got their
--    whole `total` back.)
-- 2) Video dates are settled after the booked end by who was there: the companion earns the booked time minus any
--    time they weren't in the call while the customer was (src/lib/videoDate.ts). `billed_minutes` is how many minutes
--    they were paid for when that's less than the booked time.
ALTER TABLE bookings ADD COLUMN refunded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN billed_minutes INTEGER;
