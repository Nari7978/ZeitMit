-- Card payments (Stripe Checkout). Bookings and gifts start unpaid when a card payment is needed
-- and become visible to companions / redeemable only after the payment is confirmed.
ALTER TABLE bookings ADD COLUMN paid INTEGER NOT NULL DEFAULT 1;
ALTER TABLE bookings ADD COLUMN checkout_url TEXT;
ALTER TABLE gifts ADD COLUMN paid INTEGER NOT NULL DEFAULT 1;
ALTER TABLE gifts ADD COLUMN payment_ref TEXT;
CREATE INDEX bookings_unpaid ON bookings(paid, created_at);
