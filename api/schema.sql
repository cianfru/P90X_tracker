-- P90X Logger — sync backend schema (PostgreSQL).
--
-- Mirrors the Dexie tables. The sets table is append-only: rows are inserted
-- once and only ever flip `deleted` (soft-delete). A single shared sequence
-- gives every insert/update a strictly increasing `seq`, which is the sync
-- cursor: clients pull rows with seq > their last cursor.

CREATE SEQUENCE IF NOT EXISTS sync_seq;

CREATE TABLE IF NOT EXISTS sessions (
  id          UUID PRIMARY KEY,
  date        DATE        NOT NULL,
  workout_id  TEXT        NOT NULL,
  device_id   TEXT        NOT NULL,
  created_at  BIGINT      NOT NULL,               -- client timestamp (ms)
  deleted     BOOLEAN     NOT NULL DEFAULT FALSE,  -- soft-delete (wrong routine)
  seq         BIGINT      NOT NULL DEFAULT nextval('sync_seq')
);
CREATE INDEX IF NOT EXISTS sessions_seq_idx ON sessions (seq);
-- Migration for databases created before sessions.deleted existed.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS deleted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS sets (
  id          UUID PRIMARY KEY,
  session_id  UUID        NOT NULL,
  exercise_id TEXT        NOT NULL,
  reps        INTEGER     NOT NULL,
  weight_kg   REAL,                                -- null for bodyweight moves
  round       INTEGER     NOT NULL,
  modifiers   JSONB       NOT NULL DEFAULT '[]',
  struggle    BOOLEAN     NOT NULL DEFAULT FALSE,
  logged_at   BIGINT      NOT NULL,                -- client timestamp (ms)
  deleted     BOOLEAN     NOT NULL DEFAULT FALSE,
  seq         BIGINT      NOT NULL DEFAULT nextval('sync_seq')
);
CREATE INDEX IF NOT EXISTS sets_seq_idx ON sets (seq);
CREATE INDEX IF NOT EXISTS sets_session_idx ON sets (session_id);
