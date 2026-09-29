-- One live stream link per tournament (a normal Kick/Twitch/YouTube page URL; the embed URL is derived).
ALTER TABLE tournaments ADD COLUMN stream_url TEXT;
