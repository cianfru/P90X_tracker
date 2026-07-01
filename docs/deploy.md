# Deploy runbook (Phase 7)

Two deployments: the web PWA (Vercel) and the sync API (Railway, or a Raspberry
Pi via Cloudflare Tunnel). The app works **fully offline and local without the
API** — sync is optional and can be wired last.

Order: (1) ship the web app, (2) ship the API + Postgres, (3) wire sync, (4)
Lighthouse + iPhone test.

---

## 0. Generate a shared token (once)

```bash
openssl rand -hex 32
```

Use this identical value for the API's `SYNC_TOKEN` and the web app's
`VITE_SYNC_TOKEN`.

---

## 1. Web → Vercel

The app lives in `/web` (monorepo), so the Root Directory matters.

1. Vercel → **New Project** → import the GitHub repo.
2. **Settings → Build and Deployment → Root Directory → `web`.**
3. Confirm the auto-detected settings:
   - Framework Preset: **Vite**
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm install`
4. Deploy. Open the URL — you should see the logbook; on first load it imports
   the 7-year history into IndexedDB (a few seconds, with an "importing %" pill).
5. `web/vercel.json` already handles SPA routing (deep links → `index.html`,
   static files served directly).

Env vars (optional, add now or after the API is up — then **Redeploy**):

| Name              | Value                                   |
| ----------------- | --------------------------------------- |
| `VITE_SYNC_URL`   | the deployed API base URL (no trailing /) |
| `VITE_SYNC_TOKEN` | the token from step 0                   |

> Note: `VITE_*` vars are inlined into the client bundle, so `VITE_SYNC_TOKEN`
> is visible to anyone who has the app URL. That's the brief's accepted
> single-user model — the API is protected by "token + knowing the URL". Keep
> the URLs to yourself; rotate the token by changing it in both places.

---

## 2. API → Railway (+ Postgres)

1. Railway → **New Project → Deploy from GitHub repo**.
2. Set the service **Root Directory** to `api`.
3. Add a **Postgres** plugin to the project. Railway injects `DATABASE_URL`
   into the service automatically.
4. Service **Variables**:
   - `SYNC_TOKEN` = token from step 0
   - `CORS_ORIGINS` = your Vercel URL, e.g. `https://your-app.vercel.app`
   - (`DATABASE_URL` is provided by the Postgres plugin.)
5. Start command comes from `api/Procfile`
   (`uvicorn main:app --host 0.0.0.0 --port $PORT`). Nixpacks installs
   `requirements.txt` automatically.
6. Deploy, then verify:
   ```bash
   curl https://your-api.up.railway.app/health      # → {"ok":true}
   ```
   The schema (`schema.sql`) is applied automatically on startup.

### 2b. Alternative — Raspberry Pi + Cloudflare Tunnel

```bash
cd api
docker build -t p90x-api .
docker run -d --name p90x-api -p 8000:8000 \
  -e DATABASE_URL="postgresql://user:pass@localhost:5432/p90x" \
  -e SYNC_TOKEN="<token>" \
  -e CORS_ORIGINS="https://your-app.vercel.app" \
  p90x-api
# expose it:
cloudflared tunnel --url http://localhost:8000
```

Use the resulting `https://…trycloudflare.com` (or your named tunnel hostname)
as `VITE_SYNC_URL`.

---

## 3. Wire sync

1. Set `VITE_SYNC_URL` + `VITE_SYNC_TOKEN` in Vercel (step 1) and **Redeploy**.
2. Make sure the API's `CORS_ORIGINS` matches the exact Vercel origin.
3. Open the app, log a set → the header shows a brief sync spinner, then the
   pending count returns to 0. Confirm on the server:
   ```bash
   curl "https://your-api.up.railway.app/sync/pull?since=0" \
     -H "Authorization: Bearer <token>"    # → your session + sets
   ```

> The server syncs **new activity**, not the bundled 7-year history (every
> device already has that from `history.json`). Ask if you want a one-time
> history backfill to the server.

---

## 4. Lighthouse PWA pass

In Chrome DevTools → **Lighthouse** → categories: Performance + PWA → analyze
the Vercel URL. Expect green on installability. Already in place:

- [x] Web manifest with `id`, `name`, `short_name`, `start_url`, `display: standalone`
- [x] Icons 192 + 512 + a 512 **maskable**; `apple-touch-icon` for iOS
- [x] `theme_color` / `background_color`, portrait orientation
- [x] Service worker with app-shell precache + `navigateFallback` (loads offline)
- [x] Served over HTTPS (Vercel)

If Lighthouse flags "does not respond with 200 when offline", load the app once
online first (to install the SW), then re-run.

---

## 5. iPhone install + offline test

1. Open the Vercel URL in **Safari** on the iPhone.
2. Share → **Add to Home Screen** → the P90X mark + name appear.
3. Launch from the home screen — it opens standalone (no browser chrome), dark
   status bar, safe-area padded.
4. Enable **Airplane Mode** and reopen: the app shell + all data still load, and
   logging works. Turn signal back on → the header sync indicator flushes the
   queued sets (if sync is configured).

---

## Rollback / notes

- Web: Vercel keeps every deployment — promote a previous one to roll back.
- API: schema is additive/idempotent; redeploys are safe. No destructive
  migrations.
- To disable sync entirely, unset the two `VITE_SYNC_*` vars and redeploy — the
  app reverts to pure local-first.
