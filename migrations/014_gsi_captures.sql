-- Latest Game State Integration payload per Dota match id, sent by an observer's client to /gsi.
-- Tournament games are private lobbies that Valve and OpenDota cannot return, so the observed state is the source.
-- Once a capture is final (POST_GAME) the application never overwrites it. state_json is the payload without
-- its auth block. The capture outlives its observer token: deleting the token only clears the reference.

CREATE TABLE gsi_captures (
  dota_match_id     INTEGER PRIMARY KEY CHECK (dota_match_id > 0),
  observer_token_id INTEGER REFERENCES observer_tokens(id) ON DELETE SET NULL,
  game_state        TEXT,
  is_final          INTEGER NOT NULL DEFAULT 0 CHECK (is_final IN (0, 1)),
  state_json        TEXT NOT NULL,
  first_received_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX gsi_captures_updated ON gsi_captures (updated_at DESC);
