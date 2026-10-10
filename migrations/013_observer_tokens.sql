-- Observers are people who spectate a tournament lobby with a Game State Integration config file.
-- Each one has a secret token the Dota client sends to /gsi. Only the SHA-256 of the token is stored
-- (like session cookies), plus a short prefix so the admin can tell tokens apart in the list.
-- A revoked token stays in the table (history of who captured what) but is never accepted again.

CREATE TABLE observer_tokens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  token_hash    TEXT NOT NULL UNIQUE,
  token_prefix  TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT,
  revoked_at    TEXT
);
