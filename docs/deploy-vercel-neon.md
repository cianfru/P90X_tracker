# Deploy the sync backend — Neon (one Vercel project)

Storage is **Neon** (free serverless Postgres). Compute is the FastAPI app in
`web/api/`, which ships as **Python serverless functions inside the existing
web project** — so there is **only ONE Vercel project**, and the API answers on
the app's own domain under `/api`:

```
https://p90xtracker.vercel.app/          →  the PWA
https://p90xtracker.vercel.app/api/health →  the sync API
```

Same origin means **no CORS to configure and no second URL to paste** — the app
already knows where its server is. You only need a member token.

---

## 1. Create the database (Neon) — ~2 min

1. Sign up at <https://neon.tech>, create a **Project** (region nearest you).
2. Open **Connection Details** and copy the **Pooled** connection string — the
   host must contain **`-pooler`**. Serverless opens many short connections;
   the pooler is what keeps Neon from running out.
3. Nothing to run: the tables are created automatically on the first request.

## 2. Make member tokens

One random token per person:

```bash
openssl rand -hex 24   # run once per member
```

Build a JSON map of `token -> account name`:

```json
{ "3f9a…": "andrea", "b71c…": "wife" }
```

Treat these like passwords — a token is the key to that member's data.

## 3. Add env vars to the EXISTING Vercel project — ~2 min

> If you already created a separate project for `api/`, **delete it** — it is no
> longer used. Everything lives in the web project now.

In your existing project (the one serving `p90xtracker.vercel.app`) →
**Settings → Environment Variables**, add for **Production**:

| Name | Value |
| --- | --- |
| `DATABASE_URL` | the Neon **pooled** string from step 1 |
| `SYNC_TOKENS` | the JSON token→account map from step 2 |

`CORS_ORIGINS` is not needed (same origin). Then **Deployments → Redeploy** so
the functions pick up the variables.

Sanity check: open `https://p90xtracker.vercel.app/api/health` → `{"ok":true}`.

## 4. Connect the app — ~1 min per device

**Account → Sync server** → paste **just the member token** → **Connect & back
up**. It uploads everything on the device, then that server becomes the active
backend (header shows "Synced …") and Google Sheets is paused.

Repeat on your wife's device with **her** token → her own isolated account.

_(The "server URL" field is optional — leave it blank. Fill it only to point at
a self-hosted server on a different origin.)_

## 5. Export / analysis

- **In-app:** Account → **Export CSV** — one row per set with session context.
  Works offline, any backend.
- **External:** `psql "$DATABASE_URL"` for SQL, or `pg_dump` for a full backup.
  Scope to one member with `WHERE account_id = 'andrea'`.

---

## Notes

- **Why one project:** a second project needed its own root directory, its own
  URL and CORS setup, and Vercel's Python detection expects functions in an
  `api/` folder *relative to the project root* — which a root-directory-of-`api`
  project doesn't satisfy, so it produced "No Production Deployment". Colocating
  as `web/api/` is the conventional layout and removes all of that.
- **Underscore files:** Vercel turns every `.py` in `api/` into an endpoint,
  except files starting with `_`. Hence `index.py` (the endpoint) plus
  `_app.py` / `_schema.py` (libraries).
- **Routes are mounted twice** — at `/` and at `/api` — so the same code serves
  a self-hosted origin (`https://myapi/health`) and the Vercel same-origin
  layout (`https://app/api/health`).
- **Cold starts:** an idle function wakes in ~1s and Neon resumes in ~0.5s. Sync
  runs in the background, so this is invisible in normal use.
- **Self-hosting** (Raspberry Pi / Render / Railway) still works from `web/api/`:
  ```bash
  cd web && pip install -r requirements.txt
  DATABASE_URL=postgres://… SYNC_TOKENS='{"dev":"me"}' \
    uvicorn _app:app --app-dir api --host 0.0.0.0 --port 8000
  ```
  Then paste that origin into the app's optional "server URL" field.
