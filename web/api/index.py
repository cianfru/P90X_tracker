"""
P90X Logger — sync backend (FastAPI + PostgreSQL), single-file on purpose.

Endpoints (append-only, last-write-wins):
  GET  /health           liveness + config self-check
  POST /sync/push        upsert new/soft-deleted sessions + sets (by uuid)
  GET  /sync/pull?since  rows changed after a cursor

Multi-member: each person has their own bearer token; the token maps to an
`account` and every row is scoped to it, so members never see each other's
data. Configure with SYNC_TOKENS='{"tok":"name",...}' (or SYNC_TOKEN for a
single user, account "default").

Everything lives in this one module — schema DDL included — with NO sibling
imports and no bundled data files, because serverless builders don't reliably
ship those alongside the entrypoint. Runs unchanged as a Vercel Python
function and under `uvicorn index:app` on a long-running host.
"""

SCHEMA_SQL = """\
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
"""


import datetime
import json
import os
import urllib.parse

import asyncpg
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


# Accept whichever name the host injected. Vercel's Neon/Postgres integration
# provisions several; the plain pooled ones come first, and the non-pooling
# variants are last-resort fallbacks so a misconfigured project still connects.
_DSN_VARS = (
    "DATABASE_URL",
    "POSTGRES_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL_NON_POOLING",
)

# Query params libpq understands but asyncpg does not — Neon's copy-paste
# strings include channel_binding, which would otherwise raise on connect.
_DROP_PARAMS = {"channel_binding", "options"}


def _normalize_dsn(dsn: str) -> str:
    """Strip connection params asyncpg can't parse; leave everything else."""
    if not dsn:
        return dsn
    parts = urllib.parse.urlsplit(dsn)
    if not parts.query:
        return dsn
    kept = [
        (k, v)
        for k, v in urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
        if k not in _DROP_PARAMS
    ]
    return urllib.parse.urlunsplit(
        parts._replace(query=urllib.parse.urlencode(kept))
    )


def _database_url() -> str:
    for var in _DSN_VARS:
        val = os.environ.get(var, "").strip()
        if val:
            return _normalize_dsn(val)
    # Last resort: any env var holding a Postgres DSN. Hosting integrations let
    # you choose the variable prefix (Vercel's storage integrations default to
    # e.g. STORAGE_URL), so match on the value's scheme rather than its name.
    # Prefer a pooled endpoint if several are present.
    found = [
        v.strip()
        for v in os.environ.values()
        if v.strip().startswith(("postgres://", "postgresql://"))
    ]
    if found:
        pooled = [v for v in found if "-pooler." in v]
        return _normalize_dsn((pooled or found)[0])
    return ""


DATABASE_URL = _database_url()
CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "*").split(",")


def _load_tokens() -> tuple[dict[str, str], str]:
    """token -> account map, from SYNC_TOKENS (JSON) and/or SYNC_TOKEN (single).

    Never raises: this runs at import, and throwing here would take down every
    route — including /health — with an opaque platform-level crash. A bad
    value yields no tokens plus a message /health can report instead.
    """
    tokens: dict[str, str] = {}
    problem = ""
    raw = os.environ.get("SYNC_TOKENS", "").strip()
    if raw:
        try:
            parsed = json.loads(raw)
            if not isinstance(parsed, dict):
                problem = "SYNC_TOKENS must be a JSON object of token -> name"
            else:
                tokens.update({str(k): str(v) for k, v in parsed.items()})
        except ValueError as e:
            problem = f"SYNC_TOKENS is not valid JSON: {e}"
    single = os.environ.get("SYNC_TOKEN", "").strip()
    if single:
        tokens.setdefault(single, "default")
    return tokens, problem


TOKENS, TOKENS_PROBLEM = _load_tokens()

# ---- lazy, warm-reused connection pool (serverless-safe) -------------------
# A module global survives across warm invocations of the same function
# instance; the first request in a cold container builds it, later ones reuse
# it. Kept small because serverless fans out to many instances — lean on the
# server-side pooler (Neon -pooler) for real connection multiplexing.
_pool: asyncpg.Pool | None = None
_schema_ready = False


async def get_pool() -> asyncpg.Pool:
    global _pool, _schema_ready
    if _pool is None:
        if not DATABASE_URL:
            raise HTTPException(
                status_code=500,
                detail="No database configured — set DATABASE_URL (or connect "
                "a Postgres integration) in the deployment's env vars.",
            )
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=4)
    if not _schema_ready:
        async with _pool.acquire() as conn:
            await conn.execute(SCHEMA_SQL)
        _schema_ready = True
    return _pool


app = FastAPI(title="P90X Sync")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

router = APIRouter()


def account(authorization: str = Header(default="")) -> str:
    """Resolve the bearer token to its account, or 401. This is the tenant key."""
    token = authorization.removeprefix("Bearer ").strip()
    acct = TOKENS.get(token) if token else None
    if not acct:
        raise HTTPException(status_code=401, detail="bad token")
    return acct


# ---- payload models (snake_case wire format mirrors the SQL columns) ----
class Session(BaseModel):
    id: str
    date: str
    workout_id: str
    device_id: str
    created_at: int
    location: str | None = None
    lat: float | None = None
    lon: float | None = None
    form: float | None = None
    notes: str | None = None
    supplements: list[str] = []
    deleted: bool = False


class Set(BaseModel):
    id: str
    session_id: str
    exercise_id: str
    reps: int
    weight_kg: float | None = None
    round: int
    modifiers: list[str] = []
    struggle: bool = False
    logged_at: int
    deleted: bool = False


class PushBody(BaseModel):
    sessions: list[Session] = []
    sets: list[Set] = []


@router.get("/health")
async def health():
    """Liveness + a config self-check, so hitting this URL in a browser after a
    deploy tells you whether the env vars actually landed. Reports only
    presence, never the values."""
    out = {
        "ok": True,
        "db": "configured" if DATABASE_URL else "missing",
        "tokens": len(TOKENS),
    }
    if TOKENS_PROBLEM:
        out["config_error"] = TOKENS_PROBLEM
    return out


_SESSION_UPSERT = """
    INSERT INTO sessions (id, account_id, date, workout_id, device_id,
                          created_at, location, lat, lon, form, notes,
                          supplements, deleted, seq)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
            $12::jsonb, $13, nextval('sync_seq'))
    ON CONFLICT (id) DO UPDATE SET
      date = EXCLUDED.date,
      workout_id = EXCLUDED.workout_id,
      device_id = EXCLUDED.device_id,
      created_at = EXCLUDED.created_at,
      location = EXCLUDED.location,
      lat = EXCLUDED.lat,
      lon = EXCLUDED.lon,
      form = EXCLUDED.form,
      notes = EXCLUDED.notes,
      supplements = EXCLUDED.supplements,
      deleted = EXCLUDED.deleted,
      seq = nextval('sync_seq')
    WHERE sessions.account_id = EXCLUDED.account_id
"""

_SET_UPSERT = """
    INSERT INTO sets (id, account_id, session_id, exercise_id, reps,
                      weight_kg, round, modifiers, struggle, logged_at,
                      deleted, seq)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11, nextval('sync_seq'))
    ON CONFLICT (id) DO UPDATE SET
      reps = EXCLUDED.reps,
      weight_kg = EXCLUDED.weight_kg,
      round = EXCLUDED.round,
      modifiers = EXCLUDED.modifiers,
      struggle = EXCLUDED.struggle,
      logged_at = EXCLUDED.logged_at,
      deleted = EXCLUDED.deleted,
      seq = nextval('sync_seq')
    WHERE sets.account_id = EXCLUDED.account_id
"""

# Index-friendly: two bounded MAX lookups instead of scanning every row of the
# account through a UNION.
_CURSOR_SQL = """
    SELECT GREATEST(
      (SELECT COALESCE(MAX(seq), 0) FROM sessions WHERE account_id = $1),
      (SELECT COALESCE(MAX(seq), 0) FROM sets     WHERE account_id = $1)
    )
"""


@router.post("/sync/push")
async def push(body: PushBody, acct: str = Depends(account)):
    """Upsert by uuid within the caller's account; each row gets a fresh seq.

    Rows are written with executemany, which pipelines the whole batch over one
    round-trip cycle. Executing them one at a time in a loop meant a network
    round-trip PER ROW to the database — fine for an incremental sync of a few
    sets, but the initial migration of ~18k rows blew the function time limit
    and returned 504.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            if body.sessions:
                await conn.executemany(
                    _SESSION_UPSERT,
                    [
                        (
                            s.id, acct, datetime.date.fromisoformat(s.date),
                            s.workout_id, s.device_id, s.created_at,
                            s.location, s.lat, s.lon, s.form, s.notes,
                            json.dumps(s.supplements), s.deleted,
                        )
                        for s in body.sessions
                    ],
                )
            if body.sets:
                await conn.executemany(
                    _SET_UPSERT,
                    [
                        (
                            st.id, acct, st.session_id, st.exercise_id, st.reps,
                            st.weight_kg, st.round, json.dumps(st.modifiers),
                            st.struggle, st.logged_at, st.deleted,
                        )
                        for st in body.sets
                    ],
                )
            cursor = await conn.fetchval(_CURSOR_SQL, acct)
    return {"cursor": cursor}


@router.get("/sync/pull")
async def pull(since: int = 0, acct: str = Depends(account)):
    """Return this account's sessions + sets with seq > since, plus a new cursor."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        srows = await conn.fetch(
            "SELECT id, date, workout_id, device_id, created_at, "
            "location, lat, lon, form, notes, supplements, deleted, seq "
            "FROM sessions WHERE account_id = $1 AND seq > $2 ORDER BY seq",
            acct, since,
        )
        trows = await conn.fetch(
            "SELECT id, session_id, exercise_id, reps, weight_kg, round, "
            "modifiers, struggle, logged_at, deleted, seq "
            "FROM sets WHERE account_id = $1 AND seq > $2 ORDER BY seq",
            acct, since,
        )
    cursor = since
    sessions = []
    for r in srows:
        cursor = max(cursor, r["seq"])
        supp = r["supplements"]
        sessions.append(
            {
                "id": str(r["id"]),
                "date": r["date"].isoformat(),
                "workout_id": r["workout_id"],
                "device_id": r["device_id"],
                "created_at": r["created_at"],
                "location": r["location"],
                "lat": r["lat"],
                "lon": r["lon"],
                "form": r["form"],
                "notes": r["notes"],
                "supplements": json.loads(supp) if isinstance(supp, str) else (supp or []),
                "deleted": r["deleted"],
            }
        )
    sets = []
    for r in trows:
        cursor = max(cursor, r["seq"])
        mods = r["modifiers"]
        sets.append(
            {
                "id": str(r["id"]),
                "session_id": str(r["session_id"]),
                "exercise_id": r["exercise_id"],
                "reps": r["reps"],
                "weight_kg": r["weight_kg"],
                "round": r["round"],
                "modifiers": json.loads(mods) if isinstance(mods, str) else mods,
                "struggle": r["struggle"],
                "logged_at": r["logged_at"],
                "deleted": r["deleted"],
            }
        )
    return {"cursor": cursor, "sessions": sessions, "sets": sets}


# Serve every route twice: at the root (self-hosted / long-running server, e.g.
# https://api.example.com/health) AND under /api (deployed as functions on the
# PWA's own origin, e.g. https://p90xtracker.vercel.app/api/health). Same-origin
# hosting means no CORS setup and no second URL to configure.
app.include_router(router)
app.include_router(router, prefix="/api")
