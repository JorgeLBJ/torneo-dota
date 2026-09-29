CREATE TABLE tournaments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  qualifiers INTEGER NOT NULL DEFAULT 4,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE teams (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  captain       TEXT,
  UNIQUE (tournament_id, code)
);

CREATE TABLE matches (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id  INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  phase          TEXT NOT NULL CHECK (phase IN ('group', 'semifinal', 'final')),
  round          INTEGER NOT NULL,
  match_number   INTEGER NOT NULL,
  scheduled_date TEXT,
  start_time     TEXT,
  end_time       TEXT,
  team1_id       INTEGER REFERENCES teams(id),
  team2_id       INTEGER REFERENCES teams(id),
  winner_id      INTEGER REFERENCES teams(id),
  team1_kills    INTEGER,
  team1_deaths   INTEGER,
  team2_kills    INTEGER,
  team2_deaths   INTEGER,
  CHECK (winner_id IS NULL OR winner_id = team1_id OR winner_id = team2_id),
  CHECK (team1_id IS NULL OR team2_id IS NULL OR team1_id <> team2_id)
);

CREATE INDEX idx_matches_tournament ON matches(tournament_id, phase, match_number);

CREATE TABLE admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  admin_id   INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
