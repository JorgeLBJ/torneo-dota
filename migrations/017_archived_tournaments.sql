-- A tournament can be archived so it stops appearing in the admin tournament selector; it is then listed apart in
-- Torneos ("Archivados") and can be restored or deleted. archived_at is the ISO 8601 UTC instant it was archived,
-- NULL while it is not. Archiving changes nothing else: the public link /t/<slug> keeps working.
-- The application keeps the rules: the active tournament cannot be archived and an archived one cannot be activated.

ALTER TABLE tournaments ADD COLUMN archived_at TEXT;
