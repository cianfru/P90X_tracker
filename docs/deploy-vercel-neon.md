# Deploy the sync backend — Vercel + Neon

This is the recommended backend: **Neon** (free serverless Postgres) for
storage, the **FastAPI app in `/api`** deployed as a **Vercel Python function**
for compute. One ecosystem, free hobby tiers, nothing always-on to maintain, and
because storage lives on Neon the compute host is swappable later.

The web app talks to it via **Account → Sync server** (URL + a member token). No
rebuild of the web app is needed to switch backends.

---

## 1. Create the database (Neon)

1. Sign up at <https://neon.tech> and create a **Project** (pick the region
   closest to you). It creates a database — name it `p90x` if asked.
2. Open **Connection Details** and copy the **Pooled connection** string. It
   looks like:
   `postgresql://user:pass@ep-xxxx-pooler.<region>.aws.neon.tech/p90x?sslmode=require`
   - ⚠️ Use the **pooled** one (host contains `-pooler`). Serverless functions
     open many short connections; the pooler is what keeps Neon from running out.
3. That's it — the tables are created automatically on the first request (the
   app runs `schema.sql` on startup).

## 2. Make member tokens

One random token per person. Generate them locally:

```bash
openssl rand -hex 24   # run once per member
```

Build a JSON map of `token -> account name`, e.g.:

```json
{ "3f9a…": "andrea", "b71c…": "wife" }
```

Keep these secret — a token is the key to that member's data.

## 3. Deploy the API (Vercel)

The `/api` folder is self-contained (`index.py` exposes the app, `vercel.json`
routes all requests to it, `requirements.txt` lists deps).

1. In Vercel, **Add New → Project** and import this GitHub repo **again** (a
   second project alongside the web app).
2. Set **Root Directory** to `api`.
3. Add **Environment Variables** (Production):
   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | the Neon **pooled** string from step 1 |
   | `SYNC_TOKENS` | the JSON token→account map from step 2 |
   | `CORS_ORIGINS` | your web app origin, e.g. `https://p90xtracker.vercel.app` |
4. **Deploy.** You'll get a URL like `https://p90x-api.vercel.app`.
5. Sanity check: open `https://p90x-api.vercel.app/health` → `{"ok":true}`.

## 4. Connect the app

On each device, in the web app:

1. **Account → Sync server**.
2. Paste the API URL (`https://p90x-api.vercel.app`) and **that person's token**.
3. **Connect & back up** — it uploads everything on the device, then that server
   becomes the active backend (the header shows "Synced …"). Google Sheets is
   automatically paused while a server is connected.

Do the same on your wife's device with **her** token → her data lands in her own
account, fully isolated from yours.

## 5. Export / analysis

- **In-app:** Account → **Export CSV** downloads a denormalized `p90x-export.csv`
  (one row per set with its session context) — works offline, any backend.
- **External:** connect to Neon with `psql "$DATABASE_URL"` (or any client) and
  query with SQL, or `pg_dump` for a full backup. Add `AND account_id = 'andrea'`
  to scope to one member.

---

## Notes & alternatives

- **Cold starts:** a Vercel function that's been idle wakes in ~1s and Neon
  resumes from auto-suspend in ~0.5s. Sync runs in the background, so this is
  invisible in normal use.
- **Portability:** the same app runs unchanged on a long-running host. To move
  off Vercel later, deploy `/api` to Render (free web service) or Railway with
  `uvicorn main:app` (see `Procfile`/`Dockerfile`) and point it at the **same**
  Neon database — no data migration.
- **Local dev:**
  ```bash
  cd api
  pip install -r requirements.txt
  DATABASE_URL=postgres://… SYNC_TOKENS='{"dev":"me"}' CORS_ORIGINS='*' \
    uvicorn main:app --reload
  ```
