-- A public link to one day. Deleting the day removes the link; editing the
-- day keeps it (the new copy is verified again before it is served).
CREATE TABLE shares (
  slug       TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  day_id     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, day_id),
  FOREIGN KEY (user_id, day_id) REFERENCES days (user_id, id) ON DELETE CASCADE
);
