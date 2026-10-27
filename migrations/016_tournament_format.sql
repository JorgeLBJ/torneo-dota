-- Each tournament has a format, chosen when it is created and fixed afterwards. Every existing tournament is a
-- 'league_playoffs' one (round robin with a table, then semifinals and final). 'double_elimination' starts
-- directly in upper/lower brackets.
-- There is no CHECK on purpose: adding a format later would otherwise need a rebuild of `tournaments`, which
-- almost every table references with ON DELETE CASCADE. The application validates the key (domain/formats.ts).
-- Double elimination series are stored as ordinary playoff matches ('semifinal' 1..9, grand final 'final' 1);
-- domain/double-elimination.ts owns that mapping, so `matches` keeps its phase CHECK unchanged.

ALTER TABLE tournaments ADD COLUMN format TEXT NOT NULL DEFAULT 'league_playoffs';
