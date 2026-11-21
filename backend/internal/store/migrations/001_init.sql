CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

-- token_hash is sha256 of the cookie value; the cookie itself is never stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires    INTEGER NOT NULL
);
CREATE INDEX sessions_expires ON sessions (expires);

-- The day copy lives in DATA_DIR/copies/<revision>.json; summary and revision
-- change in one statement so they always describe the same version.
CREATE TABLE days (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  summary    TEXT NOT NULL,
  revision   TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE home_visits (
  day    TEXT PRIMARY KEY,
  visits INTEGER NOT NULL
);
