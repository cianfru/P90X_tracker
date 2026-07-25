# api — P90X Logger sync backend

FastAPI + PostgreSQL. Multi-member, append-only, last-write-wins. Mirrors the
Dexie tables (`sessions`, `sets`) and exposes two sync endpoints.

Runs unchanged on a **long-running host** (Railway/Render/Pi via `uvicorn`) and
on **Vercel Python serverless** (`index.py` + `vercel.json`) — the DB pool is
created lazily and reused while warm. **Recommended deploy: Vercel + Neon —
see [`../docs/deploy-vercel-neon.md`](../docs/deploy-vercel-neon.md).**

## Endpoints

| Method | Path                  | Auth   | Purpose                                    |
| ------ | --------------------- | ------ | ------------------------------------------ |
| POST   | `/sync/push`          | Bearer | Upsert new/soft-deleted sessions + sets    |
| GET    | `/sync/pull?since=N`  | Bearer | Rows with `seq > N` + new cursor           |
| GET    | `/health`             | —      | Liveness                                   |

- **Auth / members:** `Authorization: Bearer <token>`. `SYNC_TOKENS` is a JSON
  map of `token -> account`; every row is scoped to the caller's account so
  members are fully isolated. `SYNC_TOKEN` (single token → account `default`) is
  still accepted for a one-person setup.
- **Cursor:** a shared Postgres sequence stamps every insert/update with a
  strictly increasing `seq`. Each account pulls `seq > cursor AND its own
  account`, harmlessly skipping other accounts' seq values.
- **Append-only:** `sets` rows are inserted once; edits create a new row and the
  old one is re-pushed with `deleted = true`. Upsert is last-write-wins.

## Wire format

`push` body and `pull` response use snake_case mirroring the SQL columns
(`workout_id`, `weight_kg`, `logged_at`, `modifiers` as a JSON string array).
The web client maps to/from its camelCase Dexie models in `web/src/sync`.

## Run

```bash
pip install -r requirements.txt
export DATABASE_URL="postgresql://user:pass@host:5432/p90x"
export SYNC_TOKENS='{"a-long-random-token":"andrea","another":"wife"}'
export CORS_ORIGINS="https://p90xtracker.vercel.app"   # or * for local dev
uvicorn main:app --host 0.0.0.0 --port 8000
```

Schema is applied automatically on the first request (`schema.sql`, idempotent).
Deploy to **Vercel + Neon** (recommended — see
[`../docs/deploy-vercel-neon.md`](../docs/deploy-vercel-neon.md)), or to a
long-running host (Railway / Render / Raspberry Pi) with the same env vars.

## Client contract

The web app's `web/src/sync/syncClient.ts` implements the other half: an outbox
of unsynced rows, `push` on flush, `pull` since the stored cursor, applied back
into Dexie. See that module for the exact camelCase↔snake_case mapping.
