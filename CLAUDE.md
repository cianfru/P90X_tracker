# P90X Logger

Local-first, offline PWA to log P90X workouts at the gym and monitor 7 years of
progression. **Single-user.** Replaces a 7-year `P90X.xlsx` spreadsheet
(~18,841 sets, 791 sessions, Jan 2019 → Jun 2026).

## Golden rules

- **Local-first**: every read/write hits Dexie (IndexedDB) first. The UI NEVER
  blocks on the network. Sync is a background process.
- **Append-only**: every `WorkoutSet` is an immutable, UUID'd fact. "Editing" a
  set = soft-delete (`deleted: true`) + insert a new row. Never mutate in place.
- **Sync is trivial**: push new/soft-deleted rows, pull rows since a cursor,
  last-write-wins. Single-user → no conflict resolution, no CRDTs.
- **Typed, never text**: `Modifier` is an enum. Exercise names are canonicalized
  through an alias map on import so data never fragments.
- **Offline-complete**: installable to iPhone home screen; app shell + data
  usable with zero signal. Analytics run client-side over Dexie.

## Stack (decided — do not re-litigate)

- **Web** (`/web`): Vite + React + TypeScript + Tailwind v4, `vite-plugin-pwa`
  (Workbox service worker + web manifest). Charts: Recharts. Icons: lucide-react.
  Lint: oxlint. Format: Prettier. → Vercel
- **On-device DB**: Dexie.js (IndexedDB).
- **API** (`/api`): FastAPI + PostgreSQL (Raspberry Pi via Cloudflare Tunnel /
  Railway). → Railway/Pi
- **Import** (`/import`): Python (openpyxl), one-off `xlsx → seed.json`.

## Repo layout

```
/web      Vite + React + TS PWA (Dexie, service worker, manifest)  → Vercel
/api      FastAPI sync endpoints + Postgres DDL/migrations         → Railway/Pi
/import   Python xlsx → normalized JSON seed (import_p90x.py, seed.json)
/assets   Source references: P90X.xlsx, workout-logger.jsx, monitor-dashboard.html
/docs     build-brief.md, data-model.md, this file lives at repo root
```

## Data model

```
Exercise        { id, name, canonicalName, type: 'bodyweight'|'weighted', aliases[] }
WorkoutTemplate { id, name, exerciseIds[]  // ordered as performed }
Session         { id, date (YYYY-MM-DD), workoutId, deviceId, createdAt }
WorkoutSet      { id (uuid), sessionId, exerciseId, reps,
                  weightKg | null,          // null for bodyweight moves
                  round,                     // 1,2,... within the session
                  modifiers: Modifier[],     // typed enum set, NOT free text
                  struggle,                  // the old 😓 flag
                  loggedAt (client ts), deleted }
```

`Modifier` enum: `no_kip`, `L_sit`, `wide_X`, `trx`, `full_rom` (first four are
HARDER than standard), `band_travel` (EASIER — elastic-band travel substitute).
This harder/easier split matters for analytics.

> The logger prototype (`/assets/workout-logger.jsx`) uses short modifier ids
> `full`/`band`. Production standardizes on the brief's enum: map `full → full_rom`,
> `band → band_travel`.

## Import rules (SETTLED — do not re-derive; see `/import/import_p90x.py`)

- Each sheet = one workout. Row 1 = dates across cols. Col A = exercises.
- Empty sheet (`GPT should & arms`) is skipped. In `chest & back` each exercise
  appears twice → round 1/2 (handled generically per (column, exercise)).
- **Dates**: `dd/mm/yy` strings parse day/month/year. Excel datetimes have day &
  month SWAPPED → recover with `date(year, cell.day, cell.month)`. Skip
  label/divider header columns. Clip any session dated after today.
- **Cells**: int → reps; `NxM` → reps × weight(kg); `a+b` → total reps a+b.
- **Modifier tokens**: `nk`→no_kip, `L`/`(l)`→L_sit, standalone `X`→wide_X,
  `trx`→trx, `full`→full_rom, `band`→band_travel. `😓`/`🥵`/`😤` → struggle.
  `💦` → round divider, ignore.
- `type` = weighted if the majority of an exercise's entries carry a weight.

**Validation targets** (parser reproduces these exactly): 791 sessions, 18,841
sets; struggle/year `[51,47,62,27,35,39,29,12]`; total tonnage 2,223,414 kg.
Distinct exercises = 152 after alias folding (the dashboard's 157 leaves aliases
un-merged).

## Analytics (client-side over Dexie — see `/assets/monitor-dashboard.html`)

- Per-exercise progression (best reps / top weight per session) + PR line.
- **Pulls**: "standard" baseline EXCLUDES `L_sit`/`wide_X` (harder) and
  `band_travel` (lighter). Track harder-variant share over time as its own
  progression signal (rose ~4% → 81% by 2026 — that's real progression, not decline).
- Consistency (sessions/month), tonnage (Σ reps×weightKg), most-improved
  (clean standard entries only), struggle count/year.

## Sync contract (Phase 6)

- `POST /sync/push` — array of new/soft-deleted sets + sessions; upsert by uuid.
- `GET  /sync/pull?since=<cursor>` — rows changed after cursor.
- Auth: one static API token in an env var.
- Postgres mirrors Dexie tables; sets table append-only (uuid PK, `deleted`,
  `logged_at`).

## Build phases (one at a time, confirm between)

1. ✅ **Scaffold** `/web` (PWA installs + loads offline).
2. ✅ **Data model**: Dexie schema + TS types; seeded catalog (145 exercises, aliases,
   official displayNames) + 9 templates.
3. ✅ **Logger UI**: Home / Session wired to Dexie (steppers, modifier chips, struggle,
   auto rounds, two-tap log, soft-delete).
4. ✅ **History import**: `history.json` → Dexie (chunked, resumable). 18,088 clean sets
   after removing meta rows + typo values (raw parse matched the reference at 18,841).
5. ✅ **Analytics**: Monitor over Dexie (progression + PR, harder-variant share, tonnage,
   consistency, struggle/year, movers, routines). KPIs validated.
6. ✅ **Backend sync**: FastAPI `/sync/push` + `/sync/pull` + Postgres; client outbox +
   reconcile; offline→online + soft-delete propagation verified.
7. 🚢 **Ship**: `/web` → Vercel, `/api` → Railway/Pi. See `docs/deploy.md` (runbook +
   Lighthouse checklist + iPhone test); needs the owner's accounts to execute.

## Dev

```
cd web
npm install
npm run dev        # Vite dev server (PWA enabled in dev for offline testing)
npm run build      # tsc -b && vite build  (emits dist/ + service worker)
npm run lint       # oxlint
npm run format     # prettier --write .
```

Regenerate PWA icons from `web/public/icon.svg` with sharp (dev-only, not a
committed dependency) if the mark changes.
