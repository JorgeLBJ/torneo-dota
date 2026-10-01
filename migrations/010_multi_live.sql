-- Several games can be live at once: the mark moves from the tournament (009) to each match, and the tournament
-- optionally points at the one match whose game is on the stream. The 009 columns stay in place but unused (SQLite
-- cannot drop a column that carries a foreign key).
ALTER TABLE matches ADD COLUMN live_game_number INTEGER;
ALTER TABLE matches ADD COLUMN live_started_at TEXT;
ALTER TABLE tournaments ADD COLUMN stream_match_id INTEGER REFERENCES matches(id) ON DELETE SET NULL;

UPDATE matches
   SET live_game_number = (SELECT t.live_game_number FROM tournaments t WHERE t.live_match_id = matches.id),
       live_started_at  = (SELECT t.live_started_at  FROM tournaments t WHERE t.live_match_id = matches.id)
 WHERE id IN (SELECT live_match_id FROM tournaments WHERE live_match_id IS NOT NULL AND live_game_number IS NOT NULL AND live_started_at IS NOT NULL);

UPDATE tournaments SET live_match_id = NULL, live_game_number = NULL, live_started_at = NULL;
