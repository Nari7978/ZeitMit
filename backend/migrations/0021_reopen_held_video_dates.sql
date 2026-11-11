-- Video dates the rules before 0020 left for a decision: both joined but had less than 10 minutes on the call together,
-- so the payment stayed held, `call_closed` was set and admins were alerted. They stayed `confirmed` for good, since the
-- new settlement only takes video dates nobody has closed. Reopened here, so they're settled by the new rules
-- (src/routes/bookings.ts settleVideoDate): with no record of who left, the companion is paid in full if the video
-- connected at all; if it never did, the customer gets everything back except the service fee.
UPDATE bookings SET call_closed = NULL
WHERE activity = 'call' AND status = 'confirmed' AND pay_status = 'held' AND paid = 1 AND call_closed IS NOT NULL
  AND ends_at <= unixepoch();
