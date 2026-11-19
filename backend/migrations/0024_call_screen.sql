-- Android: incoming video dates ring full screen like phone calls with the app closed, and Free now stays online in
-- the background (app 1.3.8).
-- 1) users.push_calls: this person's app shows incoming video dates full screen by itself. Their phone also gets a
--    silent push that stops the ringing once a request is answered elsewhere, cancelled or has run out, or once the
--    one who rang has hung up.
ALTER TABLE users ADD COLUMN push_calls INTEGER NOT NULL DEFAULT 0;
-- 2) companions.free_now_bg: the last Free now check-in came from the background (the app closed, its ongoing
--    "Free now" notification on). It counts for 30 minutes instead of 10, since a sleeping phone checks in less often.
ALTER TABLE companions ADD COLUMN free_now_bg INTEGER NOT NULL DEFAULT 0;
