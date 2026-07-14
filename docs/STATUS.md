# Where we left off — session memory

_Working branch: `claude/eloquent-pasteur-o7drkn` (also fast-forwarded to `main`).
Latest commit at time of writing: `2ea3001`._

This is a running "where we are" note so work can resume cleanly. Newest context
at the top.

## ✅ Shipped recently (this session)

- **Aura rendering fixed** — the page-wide green aura was hidden by a solid
  `background-color` on `<body>` painting over the `z-index:-1` pseudo-element.
  Canvas now lives on `<html>` only. (Root-caused by rendering the page
  headless, not by reading CSS.)
- **First-run "blank logbook" chooser** — a fresh device asks "Load my history"
  vs "Start fresh". Your devices already have history so never see it; your wife
  taps **Start fresh** for an empty logbook + her own backup.
- **Google sign-in de-scoped** — now requests only `drive.file` (non-sensitive),
  so Google no longer shows the "unverified app" warning. You'll re-consent once.
- **Body Beast grid** — Dips on Bench corrected to 1 set; a logged set cell now
  fills solid with the program colour as a clear "done" cue.
- **Postgres sync backend (Vercel + Neon)** — see "Pending: your actions" below.
  Fully built + verified; needs your Neon/Vercel accounts to deploy.
- **Two bug fixes (just now):**
  - **Map ignored GPS** — the map only plotted sessions whose typed label
    matched a hardcoded gazetteer and ignored the real GPS coords captured at
    workout start. That's why **Nairobi didn't appear** (it wasn't sync — the
    data was safe locally). Fixed: the map now prefers the GPS fix; added
    Nairobi to the gazetteer. Verified end-to-end.
  - **Backup "system is busy"** — the sync's in-flight guard was a boolean a
    hung request (flaky connection, no timeout) could leave stuck forever,
    wedging every later backup. Fixed: the guard self-heals after 90s and
    requests now time out after 25s.

## ⏳ Pending: YOUR actions (away-from-computer to-do)

1. **Deploy the Postgres backend** — runbook: `docs/deploy-vercel-neon.md`.
   - Neon: create project → copy the **pooled** connection string.
   - Vercel: new project, Root Directory = `api`, env vars `DATABASE_URL`
     (Neon pooled), `SYNC_TOKENS` (`{"<tok>":"andrea","<tok>":"wife"}`),
     `CORS_ORIGINS=https://p90xtracker.vercel.app` → deploy.
   - In the app: **Account → Sync server** → paste URL + your token →
     **Connect & back up**.
   - _You said you might drop Railway; that's fine — Neon holds the data and the
     API can move to Render/Vercel free later with no migration._

2. **Get devices onto the new build** to receive the aura + map + busy fixes.
   Check the `Build …` stamp at the bottom of **Account** to confirm.

## ⏳ Pending: DECISION needed from you

- **Analytics verifier** — I proposed adding Vitest + an anchor test that
  reconciles `computeAnalytics()` to the known spreadsheet totals (791 sessions,
  18,088 sets, tonnage, struggle/year, etc.), so future analytics changes can't
  silently drift. Also flagged: the tonnage anchor is recorded in two places
  with two values — `CLAUDE.md` 2,223,414 (raw, 18,841 sets) vs `analytics.ts`
  2,223,734 (clean, 18,088 sets) — worth reconciling into named constants.
  **Waiting on your go-ahead to build it.**

## 📌 Notes / smaller open items

- **Your existing Nairobi session:** if GPS was granted when you logged it, it
  will plot as soon as you're on the new build. If location permission was
  _denied_ that day (no coords stored), open that session's location card and
  type/confirm **"Nairobi"** (now a recognized place) and it'll appear.
- **Body Beast set counts:** if any other workout shows the wrong number of set
  cells (like Dips did), send the workout name + exercise and it's a 1-line fix.
- **Backend precedence:** when a Sync server is connected it becomes the active
  backup and Google Sheets is paused (by design).

## Architecture quick-reference

- Local-first PWA (Vite+React+TS, Dexie/IndexedDB). Analytics run client-side
  over Dexie (`web/src/monitor/analytics.ts`, pure functions).
- Sync backends (pick one, server wins): **Google Sheets**
  (`web/src/sync/googleSheets.ts`) or **Postgres** (`api/` + `web/src/sync/
  syncClient.ts`). Same outbox drains whichever is active.
- CSV export (`web/src/lib/csv.ts`) is backend-independent (reads Dexie).
