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

## 1. Create the database — ~2 min

**Easiest: provision Neon from inside Vercel.** In your existing project →
**Storage** tab → **Create Database** → **Neon** → connect it to the project.
Vercel provisions the database and **injects `DATABASE_URL` automatically**, so
there's no connection string to copy by hand and no password to move around.

The API accepts whichever variable name the integration sets — it looks for
`DATABASE_URL`, then `POSTGRES_URL`, then the non-pooling variants — and strips
params asyncpg can't parse (e.g. Neon's `channel_binding`), so a pasted
copy-paste string works as-is.

_Manual alternative:_ sign up at <https://neon.tech>, create a project, and copy
the **Pooled** connection string (host contains **`-pooler`**) into a
`DATABASE_URL` env var yourself. Prefer pooled — serverless opens many short
connections.

Nothing to run either way: tables are created automatically on the first request.

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
| `DATABASE_URL` | **skip if you used the Storage integration** — it's already set |
| `SYNC_TOKENS` | the JSON token→account map from step 2 |

`CORS_ORIGINS` is not needed (same origin). Then **Deployments → Redeploy** so
the functions pick up the variables.

**Sanity check:** open `https://p90xtracker.vercel.app/api/health`. It reports
whether the config landed, without revealing any values:

```json
{ "ok": true, "db": "configured", "tokens": 2 }
```

- `"db": "missing"` → the database env var didn't reach this deployment.
- `"tokens": 0` → `SYNC_TOKENS` is missing or isn't valid JSON.
- **404 / the app's HTML instead of JSON** → the functions didn't deploy; check
  the build log for the Python build step.

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
