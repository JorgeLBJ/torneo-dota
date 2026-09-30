-- A team's emblem is exclusive: a hero OR its own image (or neither). Where both were stored, the image wins, so the
-- hero stops being "taken" behind an image nobody sees it under.
UPDATE teams SET hero = NULL WHERE image_key IS NOT NULL AND hero IS NOT NULL;
