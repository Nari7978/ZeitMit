-- Video dates have their own hours, apart from in-person dates: weekly windows and specific dates, as in
-- availability and availability_dates. One clock still holds: any booking blocks the companion for both.
CREATE TABLE availability_video (
  companion_id TEXT NOT NULL REFERENCES companions(user_id) ON DELETE CASCADE,
  day INTEGER NOT NULL CHECK (day BETWEEN 0 AND 6),
  win TEXT NOT NULL CHECK (win IN ('am', 'pm', 'eve')),
  PRIMARY KEY (companion_id, day, win)
);

CREATE TABLE availability_dates_video (
  companion_id TEXT NOT NULL REFERENCES companions(user_id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  ranges TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (companion_id, date)
);

-- Companions who already offer video dates keep the hours they have: their video hours start as a copy.
INSERT INTO availability_video (companion_id, day, win)
  SELECT a.companion_id, a.day, a.win FROM availability a JOIN companions c ON c.user_id = a.companion_id
  WHERE EXISTS (SELECT 1 FROM json_each(c.activities) WHERE value = 'call');

INSERT INTO availability_dates_video (companion_id, date, ranges, updated_at)
  SELECT d.companion_id, d.date, d.ranges, d.updated_at FROM availability_dates d JOIN companions c ON c.user_id = d.companion_id
  WHERE EXISTS (SELECT 1 FROM json_each(c.activities) WHERE value = 'call');
