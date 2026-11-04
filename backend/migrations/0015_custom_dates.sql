-- Date-specific availability: on these dates a companion's own hours replace their weekly windows.
-- ranges: JSON [["HH:MM", "HH:MM"], …] in Berlin time (the end can be "24:00"); an empty list means a day off.
CREATE TABLE availability_dates (
  companion_id TEXT NOT NULL REFERENCES companions(user_id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  ranges TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (companion_id, date)
);
