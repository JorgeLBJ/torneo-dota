-- The game being played right now, marked by hand (there is no automatic signal for a private lobby).
-- At most one per tournament. The application clears it when that game gets its result, when the match or its
-- teams change, and so on; deleting the match clears it here (SET NULL).
ALTER TABLE tournaments ADD COLUMN live_match_id INTEGER REFERENCES matches(id) ON DELETE SET NULL;
ALTER TABLE tournaments ADD COLUMN live_game_number INTEGER;
ALTER TABLE tournaments ADD COLUMN live_started_at TEXT;
