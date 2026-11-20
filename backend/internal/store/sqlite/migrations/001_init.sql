CREATE TABLE days (
  id          TEXT PRIMARY KEY,
  owner_hash  BLOB NOT NULL,
  slug        TEXT UNIQUE,
  day_date    TEXT NOT NULL,
  title       TEXT NOT NULL,
  text        TEXT NOT NULL,
  audio_name  TEXT NOT NULL,
  scene_json  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX days_owner ON days (owner_hash, day_date DESC, id DESC);

CREATE TABLE media (
  key           TEXT PRIMARY KEY,
  day_id        TEXT NOT NULL REFERENCES days (id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('photo', 'audio', 'thumb')),
  position      INTEGER NOT NULL,
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  name          TEXT NOT NULL,
  last_modified INTEGER NOT NULL,
  UNIQUE (day_id, kind, position)
);
