# api — P90X Logger sync backend

FastAPI + PostgreSQL. Single-user, append-only, last-write-wins. Mirrors the
Dexie tables (`sessions`, `sets`) and exposes two sync endpoints.

## Endpoints

| Method | Path                  | Auth   | Purpose                                    |
| ------ | --------------------- | ------ | ------------------------------------------ |
| POST   | `/sync/push`          | Bearer | Upsert new/soft-deleted sessions + sets    |
| GET    | `/sync/pull?since=N`  | Bearer | Rows with `seq > N` + new cursor           |
| GET    | `/health`             | —      | Liveness                                   |

- **Auth:** `Authorization: Bearer <SYNC_TOKEN>` (one static token).
- **Cursor:** a shared Postgres sequence stamps every insert/update with a
  strictly increasing `seq`. Clients persist the last cursor and pull `seq > cursor`.
- **Append-only:** `sets` rows are inserted once; edits create a new row and the
  old one is re-pushed with `deleted = true`. Upsert is last-write-wins (fine for
  one user).

## Wire format

`push` body and `pull` response use snake_case mirroring the SQL columns
(`workout_id`, `weight_kg`, `logged_at`, `modifiers` as a JSON string array).
The web client maps to/from its camelCase Dexie models in `web/src/sync`.

## Run

```bash
pip install -r requirements.txt
export DATABASE_URL="postgresql://user:pass@host:5432/p90x"
export SYNC_TOKEN="a-long-random-string"
export CORS_ORIGINS="https://your-app.vercel.app"   # or * for local dev
uvicorn main:app --host 0.0.0.0 --port 8000
```

Schema is applied automatically on startup (`schema.sql`, idempotent). Deploy to
Railway (or the Raspberry Pi via Cloudflare Tunnel); set the three env vars.

## Client contract

The web app's `web/src/sync/syncClient.ts` implements the other half: an outbox
of unsynced rows, `push` on flush, `pull` since the stored cursor, applied back
into Dexie. See that module for the exact camelCase↔snake_case mapping.
