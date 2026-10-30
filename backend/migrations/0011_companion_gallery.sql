-- More photos for companion profiles: besides the profile photo, a gallery of 3–6 photos
-- (photo ids, in order) shown as slides on the profile.
-- SQLite can't change the CHECK on photos.kind, so the photos table is rebuilt to allow 'gallery'.
-- Nothing references photos by foreign key; its own owner_id → users cascade stays as it was.

PRAGMA defer_foreign_keys = true;

CREATE TABLE photos_new (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('avatar', 'companion', 'gallery', 'id')),
  mime TEXT NOT NULL DEFAULT 'image/jpeg',
  data TEXT NOT NULL,                     -- base64
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO photos_new (id, owner_id, kind, mime, data, created_at)
  SELECT id, owner_id, kind, mime, data, created_at FROM photos;
DROP TABLE photos;
ALTER TABLE photos_new RENAME TO photos;
CREATE INDEX photos_owner ON photos(owner_id, kind);

ALTER TABLE companions ADD COLUMN gallery TEXT NOT NULL DEFAULT '[]';
