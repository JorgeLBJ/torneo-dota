-- Match times become UTC instants; each tournament gets the IANA zone its wall-clock inputs are read in.
ALTER TABLE tournaments ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/Lima';
ALTER TABLE matches ADD COLUMN starts_at TEXT;
ALTER TABLE matches ADD COLUMN ends_at TEXT;

-- Backfill. Every existing tournament has just received the default zone, America/Lima, which is UTC-5
-- all year (no daylight saving), so a fixed +5 hours is exact. (SQLite has no time zone database.)
UPDATE matches
   SET starts_at = strftime('%Y-%m-%dT%H:%M:00Z', scheduled_date || ' ' || start_time, '+5 hours')
 WHERE scheduled_date IS NOT NULL AND start_time IS NOT NULL;
UPDATE matches
   SET ends_at = strftime('%Y-%m-%dT%H:%M:00Z', scheduled_date || ' ' || end_time, '+5 hours')
 WHERE scheduled_date IS NOT NULL AND end_time IS NOT NULL;
-- An end time earlier than the start (a slot running past midnight) belongs to the next day.
UPDATE matches
   SET ends_at = strftime('%Y-%m-%dT%H:%M:00Z', ends_at, '+1 day')
 WHERE starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at <= starts_at;

-- The instants are now the only stored schedule: the old local columns would silently disagree with them
-- after a zone change, so they go. (A date with no start time cannot be represented and is not kept.)
ALTER TABLE matches DROP COLUMN scheduled_date;
ALTER TABLE matches DROP COLUMN start_time;
ALTER TABLE matches DROP COLUMN end_time;
