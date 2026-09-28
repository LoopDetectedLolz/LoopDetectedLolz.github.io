-- Academy questions and save codes. Run once, after schema.sql and schema-sandbox.sql:
--   wrangler d1 execute nfn-comments --remote --file=schema-academy.sql
-- Not idempotent: ADD COLUMN fails on a second run, so check PRAGMA table_info(comments) first.
--
-- The Cowork Q&A monitor writes to comments with plain SQL. Keep these names and values:
--   kind      comment | question | answer
--   state     held | live | hidden, and visible always equals (state = 'live')
--   parent_id an answer or a reply points at the row it answers
--   code_hash links a question to its asker's save code (HMAC of the code; the code itself is never stored)

ALTER TABLE comments ADD COLUMN kind      TEXT NOT NULL DEFAULT 'comment';
ALTER TABLE comments ADD COLUMN state     TEXT NOT NULL DEFAULT 'live';
ALTER TABLE comments ADD COLUMN parent_id INTEGER;
ALTER TABLE comments ADD COLUMN code_hash TEXT NOT NULL DEFAULT '';
UPDATE comments SET state = CASE visible WHEN 1 THEN 'live' ELSE 'hidden' END;
CREATE INDEX IF NOT EXISTS idx_comments_state  ON comments(state, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_code   ON comments(code_hash);

CREATE TABLE IF NOT EXISTS progress (
  code_hash  TEXT PRIMARY KEY,           -- hex HMAC-SHA256(CODE_SALT, normalised code)
  data       TEXT NOT NULL DEFAULT '{}', -- canonical JSON, see theme/progress-core.js
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,              -- last time the code was used at all; drives the 365-day expiry
  written_at TEXT NOT NULL               -- last time data changed; drives the once-a-minute write limit
);
CREATE INDEX IF NOT EXISTS idx_progress_updated ON progress(updated_at);

-- rate-limit bookkeeping only, pruned daily by the cron; the IP hash never goes on a progress row
CREATE TABLE IF NOT EXISTS code_misses (
  ip_hash    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_code_misses ON code_misses(ip_hash, created_at);
CREATE TABLE IF NOT EXISTS code_mints (
  ip_hash    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_code_mints ON code_mints(ip_hash, created_at);
