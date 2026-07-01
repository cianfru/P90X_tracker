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

- **Phase 1 — Scaffold**: ✅ installable PWA shell, offline app-shell caching
  verified (loads with no network), Train/Monitor frame.
- Phases 2–7: data model → logger UI → history import → analytics → backend sync
  → ship. See `CLAUDE.md`.
