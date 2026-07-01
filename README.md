# P90X Logger

A local-first, offline-first PWA that replaces a 7-year P90X workout spreadsheet
with fast one-handed set logging at the gym and a client-side progress monitor.
Single-user, installable to the iPhone home screen, syncs to a personal backend
only when a connection is available.

- **~18,841 sets · 791 sessions · Jan 2019 → Jun 2026** imported so the
  dashboard is populated on day one.
- Works 100% offline; all reads/writes hit an on-device database (Dexie /
  IndexedDB) first and sync in the background.

## Structure

| Path       | What                                                        | Deploys to  |
| ---------- | ----------------------------------------------------------- | ----------- |
| `/web`     | Vite + React + TS + Tailwind PWA (Dexie, service worker)    | Vercel      |
| `/api`     | FastAPI sync endpoints + Postgres schema _(Phase 6)_        | Railway/Pi  |
| `/import`  | Python `xlsx → seed.json` importer (`import_p90x.py`)       | one-off     |
| `/assets`  | Source references (spreadsheet, UX prototype, dashboard)    | —           |
| `CLAUDE.md`| Project guide: data model, import rules, analytics, phases  | —           |

## Quick start

```bash
cd web
npm install
npm run dev      # http://localhost:5173 — installable + offline-capable
```

See [`CLAUDE.md`](./CLAUDE.md) for the data model, the settled spreadsheet import
rules, the analytics spec, and the phased build plan.

## Status

- ✅ **1 Scaffold** — installable, offline-capable PWA shell.
- ✅ **2 Data model** — Dexie schema + types; 145-exercise catalog + 9 templates.
- ✅ **3 Logger** — Home/Session, two-tap logging wired to Dexie.
- ✅ **4 History** — 7 years (18,088 clean sets) imported on first run.
- ✅ **5 Analytics** — Monitor: progression/PRs, harder-variant share, tonnage,
  consistency, struggle, movers.
- ✅ **6 Sync** — FastAPI + Postgres `/sync`; client outbox/reconcile; offline→online
  verified.
- 🚢 **7 Ship** — deploy runbook in [`docs/deploy.md`](./docs/deploy.md)
  (Vercel + Railway/Pi, Lighthouse, iPhone). Runs on your accounts.

See [`CLAUDE.md`](./CLAUDE.md) for details.
