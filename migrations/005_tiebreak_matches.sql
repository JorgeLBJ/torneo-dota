-- Extra games played to break a tie. They are group-phase matches flagged here so that the table
-- statistics and head-to-head ignore them and only the "extra" tiebreak criterion looks at them.
ALTER TABLE matches ADD COLUMN is_tiebreak INTEGER NOT NULL DEFAULT 0 CHECK (is_tiebreak IN (0, 1));
