-- Removes the 8 demo companions from 0002 (accounts @demo.zeitmit.app) and everything linked to them.
-- For local testing, add them back with `npm run seed:demo:local`.

-- Gift credit spent on open bookings with them goes back to the customer.
UPDATE users SET credit = credit + COALESCE((
  SELECT SUM(b.credit_used) FROM bookings b
  WHERE b.customer_id = users.id AND b.status IN ('pending', 'confirmed')
    AND b.companion_id IN (SELECT id FROM users WHERE email LIKE '%@demo.zeitmit.app')
), 0)
WHERE email NOT LIKE '%@demo.zeitmit.app';

DELETE FROM conversations
WHERE companion_id IN (SELECT id FROM users WHERE email LIKE '%@demo.zeitmit.app')
   OR customer_id IN (SELECT id FROM users WHERE email LIKE '%@demo.zeitmit.app');
DELETE FROM messages WHERE sender_id IN (SELECT id FROM users WHERE email LIKE '%@demo.zeitmit.app');
DELETE FROM checkins
WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@demo.zeitmit.app')
   OR booking_id IN (
     SELECT id FROM bookings
     WHERE companion_id IN (SELECT id FROM users WHERE email LIKE '%@demo.zeitmit.app')
        OR customer_id IN (SELECT id FROM users WHERE email LIKE '%@demo.zeitmit.app'));
DELETE FROM reviews
WHERE companion_id IN (SELECT id FROM users WHERE email LIKE '%@demo.zeitmit.app')
   OR booking_id IN (
     SELECT id FROM bookings
     WHERE companion_id IN (SELECT id FROM users WHERE email LIKE '%@demo.zeitmit.app')
        OR customer_id IN (SELECT id FROM users WHERE email LIKE '%@demo.zeitmit.app'));
DELETE FROM bookings
WHERE companion_id IN (SELECT id FROM users WHERE email LIKE '%@demo.zeitmit.app')
   OR customer_id IN (SELECT id FROM users WHERE email LIKE '%@demo.zeitmit.app');
DELETE FROM reports
WHERE reporter_id IN (SELECT id FROM users WHERE email LIKE '%@demo.zeitmit.app')
   OR target_id IN (SELECT id FROM users WHERE email LIKE '%@demo.zeitmit.app');
UPDATE gifts SET redeemed_by = NULL WHERE redeemed_by IN (SELECT id FROM users WHERE email LIKE '%@demo.zeitmit.app');
DELETE FROM gifts WHERE sender_id IN (SELECT id FROM users WHERE email LIKE '%@demo.zeitmit.app');
DELETE FROM login_codes WHERE email LIKE '%@demo.zeitmit.app';
-- companions, availability, saved, blocks, notifications and photos cascade.
DELETE FROM users WHERE email LIKE '%@demo.zeitmit.app';
