-- 1) One chat thread per booking (was: one per customer–companion pair).
--    SQLite can't drop the old UNIQUE (customer_id, companion_id), so both chat tables are rebuilt.
--    Order matters: messages move to a table pointing at the new conversations first, so dropping
--    the old conversations table can't cascade-delete any message.
-- 2) Who cancelled a booking, and why.

PRAGMA defer_foreign_keys = true;

CREATE TABLE conversations_new (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES users(id),
  companion_id TEXT NOT NULL REFERENCES companions(user_id),
  booking_id TEXT UNIQUE REFERENCES bookings(id),
  last_at INTEGER NOT NULL DEFAULT (unixepoch()),
  customer_unread INTEGER NOT NULL DEFAULT 0,
  companion_unread INTEGER NOT NULL DEFAULT 0
);
INSERT INTO conversations_new (id, customer_id, companion_id, booking_id, last_at, customer_unread, companion_unread)
  SELECT id, customer_id, companion_id, booking_id, last_at, customer_unread, companion_unread FROM conversations;

CREATE TABLE messages_new (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations_new(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  flagged INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO messages_new (id, conversation_id, sender_id, body, flagged, created_at)
  SELECT id, conversation_id, sender_id, body, flagged, created_at FROM messages;

DROP TABLE messages;
DROP TABLE conversations;
ALTER TABLE conversations_new RENAME TO conversations;
ALTER TABLE messages_new RENAME TO messages;

CREATE INDEX messages_conv ON messages (conversation_id, created_at);
CREATE INDEX conversations_customer ON conversations (customer_id, last_at);
CREATE INDEX conversations_companion ON conversations (companion_id, last_at);

ALTER TABLE bookings ADD COLUMN cancelled_by TEXT; -- 'customer' | 'companion' | 'support' | 'system'
ALTER TABLE bookings ADD COLUMN cancel_reason TEXT;
