-- Custom team image: the key of the 1x WebP in the image store (the 2x key is derived from it).
-- The key carries a random part, so replacing an image always yields a new URL (no stale caches).
ALTER TABLE teams ADD COLUMN image_key TEXT;
