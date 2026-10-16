-- Welcome banners: an image the public page opens as a dialog, per tournament. Several can exist, but the
-- application refuses to save an ACTIVE banner whose window overlaps another active one, so at most one is
-- showing at any moment. The two image keys point at WebP files in the image store (1920 px and 1280 px wide,
-- same aspect ratio, never cropped); widths are the real ones because small uploads are not enlarged.
-- starts_at/ends_at are ISO UTC instants ("2026-10-18T05:00:00Z", NULL = open ended) and the window is the
-- half-open interval [starts_at, ends_at). cta_tab uses the public page's own tab identifiers.
-- version grows with every change, so the browser can tell an updated banner from the one it already showed.

CREATE TABLE promo_banners (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id    INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name             TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  alt_text         TEXT NOT NULL CHECK (length(trim(alt_text)) BETWEEN 1 AND 200),
  image_key        TEXT NOT NULL,
  image_width      INTEGER NOT NULL CHECK (image_width > 0),
  image_height     INTEGER NOT NULL CHECK (image_height > 0),
  image_key_sm     TEXT NOT NULL,
  image_width_sm   INTEGER NOT NULL CHECK (image_width_sm > 0),
  cta_text         TEXT CHECK (cta_text IS NULL OR length(trim(cta_text)) BETWEEN 1 AND 40),
  cta_tab          TEXT CHECK (cta_tab IS NULL OR cta_tab IN ('partidos', 'envivo', 'posiciones', 'playoffs', 'reglas')),
  active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  starts_at        TEXT,
  ends_at          TEXT,
  version          INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX promo_banners_tournament ON promo_banners (tournament_id, active);
