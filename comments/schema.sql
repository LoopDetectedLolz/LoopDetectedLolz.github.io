-- Network Field Notes comments. One table, no ORM, no migration framework.
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT    NOT NULL,
  name       TEXT    NOT NULL DEFAULT '',
  email      TEXT    NOT NULL DEFAULT '',   -- never returned by the public endpoint
  body       TEXT    NOT NULL,
  is_author  INTEGER NOT NULL DEFAULT 0,
  visible    INTEGER NOT NULL DEFAULT 1,
  ip_hash    TEXT    NOT NULL DEFAULT '',   -- sha256(ip + salt), never the address itself
  ua         TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_slug ON comments(slug, visible, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_ip   ON comments(ip_hash, created_at);
