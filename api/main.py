"""
P90X Logger — sync backend (FastAPI + PostgreSQL).

Two endpoints, single-user, append-only, last-write-wins:
  POST /sync/push        upsert new/soft-deleted sessions + sets (by uuid)
  GET  /sync/pull?since  rows changed after a cursor

Auth: a single static token in the SYNC_TOKEN env var, sent as
`Authorization: Bearer <token>`. See schema.sql for the tables.

Run:  DATABASE_URL=postgres://…  SYNC_TOKEN=…  uvicorn main:app
"""

import json
import os
from contextlib import asynccontextmanager

import asyncpg
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DATABASE_URL = os.environ.get("DATABASE_URL", "")
SYNC_TOKEN = os.environ.get("SYNC_TOKEN", "")
CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "*").split(",")

_pool: asyncpg.Pool | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _pool
    _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
    async with _pool.acquire() as conn:
        with open(os.path.join(os.path.dirname(__file__), "schema.sql")) as f:
            await conn.execute(f.read())
    yield
    await _pool.close()


app = FastAPI(title="P90X Sync", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def auth(authorization: str = Header(default="")) -> None:
    token = authorization.removeprefix("Bearer ").strip()
    if not SYNC_TOKEN or token != SYNC_TOKEN:
        raise HTTPException(status_code=401, detail="bad token")


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


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/sync/push", dependencies=[Depends(auth)])
async def push(body: PushBody):
    """Upsert by uuid; each affected row gets a fresh seq. Returns new cursor."""
    async with _pool.acquire() as conn:
        async with conn.transaction():
            for s in body.sessions:
                await conn.execute(
                    """
                    INSERT INTO sessions (id, date, workout_id, device_id, created_at,
                                          location, lat, lon, form, notes, supplements,
                                          deleted, seq)
                    VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb,
                            $12, nextval('sync_seq'))
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
                    """,
                    s.id, s.date, s.workout_id, s.device_id, s.created_at,
                    s.location, s.lat, s.lon, s.form, s.notes,
                    json.dumps(s.supplements), s.deleted,
                )
            for st in body.sets:
                await conn.execute(
                    """
                    INSERT INTO sets (id, session_id, exercise_id, reps, weight_kg,
                                      round, modifiers, struggle, logged_at, deleted, seq)
                    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10, nextval('sync_seq'))
                    ON CONFLICT (id) DO UPDATE SET
                      reps = EXCLUDED.reps,
                      weight_kg = EXCLUDED.weight_kg,
                      round = EXCLUDED.round,
                      modifiers = EXCLUDED.modifiers,
                      struggle = EXCLUDED.struggle,
                      logged_at = EXCLUDED.logged_at,
                      deleted = EXCLUDED.deleted,
                      seq = nextval('sync_seq')
                    """,
                    st.id, st.session_id, st.exercise_id, st.reps, st.weight_kg,
                    st.round, json.dumps(st.modifiers), st.struggle, st.logged_at,
                    st.deleted,
                )
            cursor = await conn.fetchval("SELECT last_value FROM sync_seq")
    return {"cursor": cursor}


@app.get("/sync/pull", dependencies=[Depends(auth)])
async def pull(since: int = 0):
    """Return sessions + sets with seq > since, plus the max seq as the cursor."""
    async with _pool.acquire() as conn:
        srows = await conn.fetch(
            "SELECT id, date, workout_id, device_id, created_at, "
            "location, lat, lon, form, notes, supplements, deleted, seq "
            "FROM sessions WHERE seq > $1 ORDER BY seq",
            since,
        )
        trows = await conn.fetch(
            "SELECT id, session_id, exercise_id, reps, weight_kg, round, "
            "modifiers, struggle, logged_at, deleted, seq "
            "FROM sets WHERE seq > $1 ORDER BY seq",
            since,
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
