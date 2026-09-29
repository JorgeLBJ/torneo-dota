-- Tournament rules, calendar days, team heroes and stricter winner integrity.

ALTER TABLE tournaments ADD COLUMN game TEXT NOT NULL DEFAULT 'Dota 2';
ALTER TABLE tournaments ADD COLUMN points_win INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tournaments ADD COLUMN points_loss INTEGER NOT NULL DEFAULT 0;
-- Ordered CSV of tiebreak criteria (known values: kd, kills).
ALTER TABLE tournaments ADD COLUMN tiebreakers TEXT NOT NULL DEFAULT 'kd,kills';
ALTER TABLE tournaments ADD COLUMN group_legs INTEGER NOT NULL DEFAULT 1 CHECK (group_legs IN (1, 2));
ALTER TABLE tournaments ADD COLUMN rules_text TEXT NOT NULL DEFAULT '';
-- Exactly one tournament is active (shown at the site root); the partial unique index enforces at most one.
ALTER TABLE tournaments ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1));
CREATE UNIQUE INDEX idx_tournaments_active ON tournaments(is_active) WHERE is_active = 1;

CREATE TABLE schedule_days (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  date          TEXT NOT NULL,
  phase         TEXT NOT NULL CHECK (phase IN ('group', 'semifinal', 'final')),
  -- Ordered CSV of HH:MM start times.
  start_times   TEXT NOT NULL,
  slot_minutes  INTEGER NOT NULL DEFAULT 60 CHECK (slot_minutes > 0)
);

CREATE INDEX idx_schedule_days_tournament ON schedule_days(tournament_id, position);

ALTER TABLE teams ADD COLUMN hero TEXT;
CREATE UNIQUE INDEX idx_teams_hero ON teams(tournament_id, hero) WHERE hero IS NOT NULL;

-- 001's CHECK (winner_id IS NULL OR winner_id = team1_id OR winner_id = team2_id) evaluates to
-- NULL (passes) when a team slot is NULL. SQLite cannot alter CHECKs, so enforce with triggers.
CREATE TRIGGER matches_winner_valid_insert
BEFORE INSERT ON matches
WHEN NEW.winner_id IS NOT NULL
  AND (NEW.team1_id IS NULL OR NEW.team2_id IS NULL
       OR (NEW.winner_id <> NEW.team1_id AND NEW.winner_id <> NEW.team2_id))
BEGIN
  SELECT RAISE(ABORT, 'winner must be one of the two match teams');
END;

CREATE TRIGGER matches_winner_valid_update
BEFORE UPDATE ON matches
WHEN NEW.winner_id IS NOT NULL
  AND (NEW.team1_id IS NULL OR NEW.team2_id IS NULL
       OR (NEW.winner_id <> NEW.team1_id AND NEW.winner_id <> NEW.team2_id))
BEGIN
  SELECT RAISE(ABORT, 'winner must be one of the two match teams');
END;
