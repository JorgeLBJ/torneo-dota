-- A match is a series of games (group: best of 1 by default; semifinals best of 3; final best of 5).
-- matches.winner_id / team*_kills / team*_deaths stay as the DERIVED aggregate of the games, kept in step by the
-- application in the same transaction, so the table, the playoffs and the public page keep reading them as before.

ALTER TABLE tournaments ADD COLUMN group_games INTEGER NOT NULL DEFAULT 1 CHECK (group_games IN (1, 3, 5));
ALTER TABLE tournaments ADD COLUMN semifinal_games INTEGER NOT NULL DEFAULT 3 CHECK (semifinal_games IN (1, 3, 5));
ALTER TABLE tournaments ADD COLUMN final_games INTEGER NOT NULL DEFAULT 5 CHECK (final_games IN (1, 3, 5));

CREATE TABLE match_games (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id         INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  game_number      INTEGER NOT NULL CHECK (game_number >= 1),
  winner_id        INTEGER NOT NULL REFERENCES teams(id),
  team1_kills      INTEGER NOT NULL CHECK (team1_kills >= 0),
  team1_deaths     INTEGER NOT NULL CHECK (team1_deaths >= 0),
  team2_kills      INTEGER NOT NULL CHECK (team2_kills >= 0),
  team2_deaths     INTEGER NOT NULL CHECK (team2_deaths >= 0),
  -- Filled when the game was imported from a Dota match id.
  radiant_team_id  INTEGER REFERENCES teams(id),
  dota_match_id    INTEGER,
  dota_snapshot    TEXT,
  imported_at      TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (match_id, game_number)
);

-- Every result that exists today is game 1 of its match.
INSERT INTO match_games (match_id, game_number, winner_id, team1_kills, team1_deaths, team2_kills, team2_deaths)
SELECT id, 1, winner_id, team1_kills, team1_deaths, team2_kills, team2_deaths
FROM matches
WHERE winner_id IS NOT NULL AND team1_kills IS NOT NULL AND team1_deaths IS NOT NULL AND team2_kills IS NOT NULL AND team2_deaths IS NOT NULL;

-- A tournament whose playoffs were already played as single games keeps them that way: their results must not
-- turn into "1-0 in a best of 3".
UPDATE tournaments SET semifinal_games = 1
WHERE EXISTS (SELECT 1 FROM matches m WHERE m.tournament_id = tournaments.id AND m.phase = 'semifinal' AND m.winner_id IS NOT NULL);
UPDATE tournaments SET final_games = 1
WHERE EXISTS (SELECT 1 FROM matches m WHERE m.tournament_id = tournaments.id AND m.phase = 'final' AND m.winner_id IS NOT NULL);
