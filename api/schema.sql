-- P90X Logger — sync backend schema (PostgreSQL).
--
-- Mirrors the Dexie tables. The sets table is append-only: rows are inserted
-- once and only ever flip `deleted` (soft-delete). A single shared sequence
-- gives every insert/update a strictly increasing `seq`, which is the sync
-- cursor: clients pull rows with seq > their last cursor.
--
-- Multi-member: every row carries an `account_id` (resolved from the caller's
-- bearer token). All reads/writes are scoped to it, so members are isolated
-- even though they share one sequence — each just pulls seq>cursor AND its own
-- account, harmlessly skipping other accounts' seq values.

CREATE SEQUENCE IF NOT EXISTS sync_seq;

CREATE TABLE IF NOT EXISTS sessions (
  id          UUID PRIMARY KEY,
  account_id  TEXT        NOT NULL DEFAULT 'default',
  date        DATE        NOT NULL,
  workout_id  TEXT        NOT NULL,
  device_id   TEXT        NOT NULL,
  created_at  BIGINT      NOT NULL,               -- client timestamp (ms)
  location    TEXT,                                -- where trained (city / IATA / "casa")
  lat         DOUBLE PRECISION,                    -- GPS captured at workout start
  lon         DOUBLE PRECISION,
  form        REAL,                                -- self-assessed readiness 1-10
  notes       TEXT,                                -- free-text day notes
  supplements JSONB       NOT NULL DEFAULT '[]',   -- typed: creatine/protein/maca
  deleted     BOOLEAN     NOT NULL DEFAULT FALSE,  -- soft-delete (wrong routine)
  seq         BIGINT      NOT NULL DEFAULT nextval('sync_seq')
);
-- Migrations for databases created before these columns existed.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS account_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS lon DOUBLE PRECISION;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS form REAL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS supplements JSONB NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS sessions_acct_seq_idx ON sessions (account_id, seq);

CREATE TABLE IF NOT EXISTS sets (
  id          UUID PRIMARY KEY,
  account_id  TEXT        NOT NULL DEFAULT 'default',
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
ALTER TABLE sets ADD COLUMN IF NOT EXISTS account_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS sets_acct_seq_idx ON sets (account_id, seq);
CREATE INDEX IF NOT EXISTS sets_session_idx ON sets (session_id);
