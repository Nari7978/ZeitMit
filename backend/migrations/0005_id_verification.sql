-- Customers verify their ID once before their first booking.
-- id_status: none → pending (photos uploaded) → approved | rejected. Photos are deleted after the decision.
ALTER TABLE users ADD COLUMN id_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE users ADD COLUMN id_doc_photo_id TEXT;
ALTER TABLE users ADD COLUMN id_selfie_photo_id TEXT;
ALTER TABLE users ADD COLUMN id_submitted_at INTEGER;
ALTER TABLE users ADD COLUMN id_note TEXT;

CREATE INDEX users_id_pending ON users (id_status, id_submitted_at);

-- Approved companions already passed an ID check.
UPDATE users SET id_status = 'approved' WHERE id IN (SELECT user_id FROM companions WHERE status = 'approved');
