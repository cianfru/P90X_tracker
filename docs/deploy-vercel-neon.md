# Deploy the sync backend — Neon (one Vercel project)

Storage is **Neon** (free serverless Postgres). Compute is the FastAPI app in
`web/api/`, which ships as **Python serverless functions inside the existing
web project** — so there is **only ONE Vercel project**, and the API answers on
the app's own domain under `/api`:

```
https://p90xtracker.vercel.app/          →  the PWA
https://p90xtracker.vercel.app/api/health →  the sync API
```

Same origin means **no CORS to configure and no URL to paste** — the app already
knows where its server is, and your Google sign-in is the only credential.

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

## 2. Tell the API which Google app you are

Add one environment variable in the same Vercel project
(**Settings → Environment Variables**, Production):

| Name | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | the same OAuth Client ID the web app uses |

This is what stops an access token issued for *some other* Google app being
accepted here — the server checks the token's audience against it.

`DATABASE_URL` is already set if you provisioned Neon from the Storage tab.
`CORS_ORIGINS` is not needed (same origin). There are **no tokens to issue**.

Then **Deployments → Redeploy** so the functions pick up the variables.

**Sanity check:** open `https://p90xtracker.vercel.app/api/health`:

```json
{ "ok": true, "db": "configured", "auth": "google" }
```

- `"db": "missing"` → the database variable didn't reach this deployment.
- `"auth": "google (client id not set)"` → `GOOGLE_CLIENT_ID` is missing.
- **The app's HTML instead of JSON** → the functions didn't deploy.

## 3. Sign in — that is the whole setup

**Account → Sign in with Google.** That's the entire setup — there is nothing
to paste. Signing in uploads whatever the device already has, then keeps it in
sync in the background (header shows "Synced …").

Anyone else signs in with *their* Google account and gets a private, isolated
account automatically. Signed out, the app still works fully; it just keeps
everything on the device ("Local only").

## 4. Export / analysis

- **In-app:** Account → **Export CSV** — one row per set with session context.
  Works offline, signed in or out.
- **External:** `psql "$DATABASE_URL"` for SQL, or `pg_dump` for a full backup.
  Scope to one person with `WHERE account_id = '<their Google user id>'`.

---

## Notes

- **Why one project:** a second project needed its own root directory, its own
  URL and CORS setup, and Vercel's Python detection expects functions in an
  `api/` folder *relative to the project root* — which a root-directory-of-`api`
  project doesn't satisfy, so it produced "No Production Deployment". Colocating
  as `web/api/` is the conventional layout and removes all of that.
- **Single file:** the whole API is one `api/index.py` with the schema DDL
  embedded as a string — no sibling imports and no bundled data files, because
  serverless builders don't reliably ship those next to the entrypoint. A
  missing sibling module surfaces as an opaque `FUNCTION_INVOCATION_FAILED`
  (the module fails to import, so even `/health` 500s), which is exactly the
  failure this layout removes.
- **Identity, not credentials:** the account key is the caller's Google user id,
  read back from Google for the access token the client already holds (result
  cached briefly per warm instance). Nothing is issued, stored or pasted, and
  the same sign-in on a new device reaches the same data.
- **Routes are mounted twice** — at `/` and at `/api` — so the same code serves
  a self-hosted origin (`https://myapi/health`) and the Vercel same-origin
  layout (`https://app/api/health`).
- **Cold starts:** an idle function wakes in ~1s and Neon resumes in ~0.5s. Sync
  runs in the background, so this is invisible in normal use.
- **Self-hosting** (Raspberry Pi / Render / Railway) still works from `web/api/`:
  ```bash
  cd web && pip install -r requirements.txt
  DATABASE_URL=postgres://… GOOGLE_CLIENT_ID=…apps.googleusercontent.com \
    uvicorn index:app --app-dir api --host 0.0.0.0 --port 8000
  ```
  Point the app at it with a `VITE_SYNC_URL` build env var.
