-- CX Sandbox usage events. Anonymous: a random per-browser id, the lesson, what happened.
-- Only rejected commands are stored (cmd), never the ones that worked. No IP, only its salted hash for the rate limit.
CREATE TABLE IF NOT EXISTS sandbox_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sid        TEXT    NOT NULL,             -- random id the browser made for itself, stored in localStorage
  page       TEXT    NOT NULL DEFAULT '',  -- path the embed lives on
  lesson     TEXT    NOT NULL,             -- lesson id, e.g. nac-03-mac-auth
  ev         TEXT    NOT NULL,             -- start | err | check | done | reset | jserror | hint | connect
  cmd        TEXT    NOT NULL DEFAULT '',  -- the rejected command (err) or the device id (connect)
  err        TEXT    NOT NULL DEFAULT '',  -- invalid | ambiguous | incomplete | scope | refused | message (jserror)
  n          INTEGER,                      -- checks passed (check/done)
  total      INTEGER,                      -- checks in the lesson (check/done)
  ip_hash    TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sb_time   ON sandbox_events(created_at);
CREATE INDEX IF NOT EXISTS idx_sb_lesson ON sandbox_events(lesson, ev, created_at);
CREATE INDEX IF NOT EXISTS idx_sb_ip     ON sandbox_events(ip_hash, created_at);
