# P90X Logger — Build Brief

> The original mission brief that scoped this project, kept verbatim as the
> source of truth for intent. The distilled, working version (data model, import
> rules, analytics, phases) lives in [`/CLAUDE.md`](../CLAUDE.md).

## Mission

Replace a 7-year P90X workout spreadsheet with a local-first, offline PWA logger
plus a monitoring dashboard, in a clean GitHub repo. Logging happens at the gym
(often no signal, sometimes abroad), so the app must be fully usable offline and
sync to a personal backend only when a connection is available.

## What already exists

- **7 years of history** in `P90X.xlsx`: ~18,841 data points, 791 sessions,
  Jan 2019 → Jun 2026, across 9 workout sheets. Imported so the dashboard is
  populated on day one. (`/assets/P90X.xlsx`)
- **A working React prototype** (`workout-logger.jsx`) that nails the intended
  UX and data model — the design reference / starting point for the logger UI,
  not production code. (`/assets/workout-logger.jsx`)
- **A validated parser + analytics** in Python/JS. The parsing rules that took
  real effort to nail down are documented in `CLAUDE.md` → Import rules — do not
  re-derive them. (`/import/import_p90x.py`, `/assets/monitor-dashboard.html`)

## Goals / non-goals

**Goals**: fast one-handed set logging at the gym; works 100% offline;
installable to iPhone home screen; syncs to a personal backend; exact analytics
with no text parsing ever again; typed data model; single clean TypeScript repo.

**Non-goals** (keep it lean): multi-user accounts, social features, complex auth
(single-user — a static API token is fine), real-time collaboration, native app
store, CRDTs (single-user append-only is enough).

## Architecture — local-first with append-only sync

- Every logged set is an immutable, UUID'd fact (append-only). "Editing" a set =
  soft-delete + new row. Sync is "push new rows / pull rows since cursor" with
  last-write-wins — no conflict resolution for one user; can be offline for
  weeks (travel) and reconcile cleanly.
- Client keeps an outbox of unsynced rows; a sync service flushes to FastAPI
  when online and pulls anything newer. Stores a per-device id and a sync cursor.
- Analytics run client-side over Dexie so the Monitor works offline too.

## Feature scope

**Logger** (port from `workout-logger.jsx`): Home picks a workout template
(exercises in performed order) or resumes today's session. Session gives
per-exercise quick entry — pre-fill reps/weight from last time as the target;
big +/- steppers; modifier chips; struggle toggle; auto-incrementing rounds;
two-tap "Log set"; sets shown inline. Everything writes to Dexie immediately and
enqueues for sync.

**Monitor / analytics** (client-side over Dexie): per-exercise progression with
PR line; standard vs harder-variant split for pulls (baseline excludes
`L_sit`/`wide_X` harder and `band_travel` lighter; harder-variant share tracked
as its own signal — rose ~4% → 81% in 2026); consistency (sessions/month);
tonnage in kg; most-improved (clean standard entries only); struggle count/year.

## Build plan (in order, confirm between each)

1. Scaffold monorepo + `/web` PWA; verify dev server, install, offline.
2. Dexie schema + TS types; seed exercise catalog (aliases) + workout templates.
3. Logger UI: port the prototype, wired to Dexie (Home / Session / Monitor shell).
4. History import: Python parser → JSON → seed Dexie (and Postgres); validate counts.
5. Analytics: implement the Monitor computations over Dexie.
6. Backend sync: FastAPI endpoints + Postgres DDL + client outbox + reconcile.
7. Ship: deploy `/web` (Vercel), `/api` (Railway/Pi); Lighthouse PWA; iPhone test.
