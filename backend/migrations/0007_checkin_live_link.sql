-- Private live page for the trusted contact (/t/<share_token>) and timestamps it shows.
ALTER TABLE checkins ADD COLUMN share_token TEXT;
ALTER TABLE checkins ADD COLUMN last_ok_at INTEGER;
ALTER TABLE checkins ADD COLUMN last_loc_at INTEGER;
ALTER TABLE checkins ADD COLUMN sos_at INTEGER;
ALTER TABLE checkins ADD COLUMN share_base TEXT; -- API origin, so the cron can link to the live page
CREATE UNIQUE INDEX checkins_share_token ON checkins (share_token);
