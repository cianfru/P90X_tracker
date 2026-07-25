# Where we left off — session memory

_Working branch: `claude/eloquent-pasteur-o7drkn` (also fast-forwarded to `main`)._

This is a running "where we are" note so work can resume cleanly. Newest context
at the top.

## 🏋️ THE OWNER'S ACTUAL ROTATION (foundational — do not re-derive)

15 years on the program; knows the workouts by heart and swaps deliberately for
adaptability. P90X is the foundation, but the rotation is a **hybrid across all
four programs**. It is SLOT-BASED: each day is a training stimulus with several
interchangeable workouts, not a fixed title.

| Day | Stimulus | Interchangeable options |
| --- | --- | --- |
| 1 | Push / chest | paired with day 3 — see the pair table below |
| 2 | Plyo / legs | **Plyometrics** · **Plyocide** · `bb-bulk-legs` |
| 3 | Pull | determined by day 1 — see the pair table below |
| 4 | Total body / complex | X2 Total Body, **or** an X3 upper+lower PAIR — see below |
| 5 | Legs / base | `legs-and-back` · `p90x2-base-back` |
| 6 | **Flex** — light/fun by default, absorbs a missed workout when needed | Kenpo X · a short X3 + X3 abs · or a re-assigned missed workout |
| 7 | Recovery — or make-up for a missed day | — |

### Day 1 and Day 3 are a MATCHED PAIR, not independent slots

Picking day 1 determines day 3 — the standard P90X push/pull pairing, applied
across programs. The preference order runs over PAIRS:

| # | Day 1 (push) | Day 3 (pull) |
| - | --- | --- |
| 1 | `chest-and-back` | `shoulders-and-arms` |
| 2 | `chest-shoulders-tris` | `back-and-bis` |
| 3 | `x2-chest-back` | `x2-shoulders-arms` |
| 4 | `x2-chest-sh-tris` | `v-sculpt` |

(Mirrors the guide: Phase 1 = Chest&Back + Shoulders&Arms, Phase 2 =
Chest/Sh/Tris + Back&Bis. V-Sculpt is X2's back/bis equivalent.)

### A day can hold MORE THAN ONE workout

P90X3 sessions are short, so they are doubled up to match the duration of a
full-length workout. Day 4 is therefore one of:
- `p90x2-x2-total-body` (single), or
- `p90x3-eccentric-upper` **+** `p90x3-eccentric-lower`, or
- `p90x3-complex-upper` **+** `p90x3-complex-lower`

Day 6 is one X3 workout (complex or eccentric) **+** X3 abs.

→ The model must support a slot resolving to a LIST of workouts, and a session
   that contains two routines.

### A missed day SLIDES the queue (corrected)

The week is an ordered QUEUE, not fixed calendar slots. Missing a day does not
re-assign that workout somewhere specific — **everything moves forward by one
day**. The missed workout happens next, everything after it pushes back, and the
TAIL is what gets squeezed out.

Day 6 is "inherently a 50% workout" — light/fun by default (Kenpo X, a short X3
+ abs, Cardio X) — precisely so it is the first thing that can be sacrificed.

| Days missed | Day 6 | Day 7 |
| --- | --- | --- |
| 0 | light / fun | rest |
| 1 | **make-up** | light / fun (rest day lost) |
| 2 | **make-up** | **make-up** |

Consistent with the owner's "I recover it on Sunday": the week's committed work
still all lands by Sunday. Committed work (days 1-5) is never dropped, only
delayed. Encoded as `rotation.onMiss: "slide"`.

### Anchor slots, and the limits of what's logged

Not every slot is meant to rotate. **Day 5 is an anchor**: the owner prefers
`legs-and-back` over `p90x2-base-back` deliberately and is content to stay on
it. Anchors are marked `rotate: false` in the rotation data — they still report
what they're on, but are never flagged stale. A settled preference is not a rut.

⚠️ **The detector can only see what is logged.** Day 5 first appeared as "184x
in a row, never switched" — but the owner *does* use Base + Back, just doesn't
record it. Unlogged work is invisible to every analysis in this app, and the
same blind spot will affect the scheduler: it cannot know a session happened if
it was never written down. Treat any "never" result as "never recorded".

### How a slot resolves (confirmed by the owner)

Each slot holds an **ordered preference list, most → least favourite**. You stay
on the current option until it feels STALE ("if I feel I ran chest and back too
long"), then advance to the next. It is not rotation and not random. Day 1's
full order, given verbatim:

`chest-and-back` → `chest-shoulders-tris` → `x2-chest-back` → `x2-chest-sh-tris`

→ The app can DETECT staleness (consecutive sessions / weeks on one option) and
   suggest advancing, rather than requiring the owner to track it.

### Disruption rule (confirmed)

A long work day means the day is **SKIPPED, not slid** — and **made up on
Sunday** to keep the week consistent. So:
- the weekly slot order is preserved; the cycle does NOT shift;
- **Sunday (day 7) is the make-up slot**: recovery if nothing was missed,
  otherwise it absorbs the missed workout.

### No recovery week (confirmed)

The owner does NOT take the guide's 3:1 deload week — "that was many years ago,
now I just go". Weekly recovery is day 7 only. Build to this; do not reintroduce
deload weeks. (An optional, data-driven fatigue signal — rising struggle rate or
falling performance — would be additive, not a schedule rule.)

- **Abs are thrown in randomly**, not fixed to a slot.
- **Every few months: a Body Beast block of 4–6 weeks** replaces the cycle
  entirely, to change the stimulus.
- **Flying schedule disrupts plans** — adaptability is a hard requirement, not a
  nice-to-have. The cycle must slide, not break.

⚠️ **Not in `catalog.json`:** Plyometrics, Plyocide, P90X3 abs (also Yoga X,
Kenpo X, X Stretch, Cardio X). The catalog was built from the spreadsheet, which
only recorded rep-based resistance work. A scheduler must reference workouts
that are never logged, so these need catalog entries (possibly flagged as
non-logging / schedule-only).

### What the P90X Fitness Guide actually specifies (read 2026-07-25)

- 90 days = 3 training blocks; each block = **3 weeks hard + 1 week recovery**
  (Adaptive → Mastery → Recovery). The 3:1 ratio is the load-bearing rule.
- **"Day 1–7" are relative days, not weekdays** — a rolling 7-day cycle. This is
  what makes scheduling around a roster tractable.
- Recovery weeks are structurally different (Yoga / Core Syn / Kenpo / X Stretch),
  not just lighter.
- **Phase 3 alternates weekly** between the Phase-1 and Phase-2 layouts.
- Doubles adds AM Cardio X 3x/wk (phase 2) then 4x/wk (phase 3). Lean swaps
  resistance for cardio/core.
- The guide itself sanctions backing off when overtrained, and flags a rising
  resting heart rate as the signal.

## 📌 Wanted next (owner's requests)

- **Better map quality — evaluate Mapbox** in place of the current CARTO raster
  tiles in `web/src/monitor/TravelMap.tsx` (needs a Mapbox token; vector tiles,
  nicer styling, retina).
- **Schedule generator** (phase 2): upload a work roster → generate a monthly
  schedule from the rotation above, designed so exhaustion/flight changes slide
  the cycle rather than break it.

## ✅ WORKING: sign in with Google, data persists to your account

The architecture, finally settled:

- **No sign-in** → app fully usable, everything local ("Local only"). Anyone can
  use it; nothing to configure.
- **Sign in with Google** → history persists to your own account, reachable from
  any device you sign in on. Nothing to paste, ever.
- **Your Google user id IS the account key.** A new person signing in gets a
  private, isolated account with zero setup.

Stack: PWA (Dexie, local-first) → `web/api/index.py` (FastAPI, one file, Vercel
Python functions at `/api` on the app's own origin) → Neon Postgres.

Vercel env vars: `DATABASE_URL` (auto from the Neon Storage integration) and
`GOOGLE_CLIENT_ID` =
`263131716163-qb9qeodvseeff1l776ge27asfbcl6lcl.apps.googleusercontent.com`
(public, already hardcoded in `web/src/sync/googleAuth.ts`). Check with
`/api/health` → `{"ok":true,"db":"configured","auth":"google"}`.

**Removed:** the Google Sheets backend, and the pasted-token scheme. Both were
second paths to the same thing and caused most of the pain below.

### What cost us a day, so it isn't repeated

1. **Don't add config during an incident.** `//` comment keys in `vercel.json`
   fail its strict schema and get the deployment *rejected before any build* —
   which looks exactly like a broken webhook. `git` is also not in the
   documented property list. When stuck, revert config to the last version that
   demonstrably deployed and change one variable at a time.
2. **Serverless bundling:** sibling modules next to the entrypoint aren't
   reliably shipped → `ModuleNotFoundError` → opaque `FUNCTION_INVOCATION_FAILED`
   on every route. The API is one self-contained file for this reason.
3. **Vercel "Redeploy" replays that deployment's own commit** — it can never
   pick up a newer fix. Push, or use a Deploy Hook (Settings → Git).
4. **100 deployments/24h, shared across projects.** Don't push the same commit
   to two branches; production is `main`.
5. **Service worker:** `registerType:'autoUpdate'` did NOT imply skipWaiting +
   clientsClaim — set them explicitly, or an installed PWA never updates. Also
   `navigateFallbackDenylist: [/^\/api\//]` or the shell answers API URLs.
6. **Batch DB writes.** One INSERT per row = one network round-trip per row;
   18k rows blew the function limit (504). Use `executemany`.

## ✅ Shipped recently (this session)

- **Google connect/sync fixed (was: "PWA unusable")** — root cause: the earlier
  de-scoping to `drive.file` cut off access to the OLD spreadsheet (created
  under the broad grant), so every sync 403'd against the cached sheet id, and
  the stale grant made silent token refreshes fail with no visible recovery.
  Fix (keeps the no-warning win): (1) scope-migration guard — a grant made
  under different scopes is forgotten on boot, so the app shows the amber
  **"Not backed up" → tap → Sign in** path (one fresh consent, no scary
  screen); (2) `ensureSpreadsheet` validates the cached sheet id and on a
  definitive 403/404 drops it + cursors and finds/creates a reachable sheet;
  (3) reconnect auto-recovery — an empty sheet on an already-migrated account
  triggers a full re-upload automatically (sign-in path shows progress; the
  background sync path does it silently). The OLD "P90X Logbook" in Drive
  becomes a stale archive — safe to delete/rename after the new one populates.
  **What the owner does: update the app, open Account, tap Sign in, wait for
  the re-upload. Same once for the wife's device.**

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

## 🔧 Deploying the API — gotchas already hit (so we don't re-hit them)

The sync API is Python serverless functions in `web/api/`, inside the SAME
Vercel project as the PWA (`/api/*` on the app's own origin). Four failures we
worked through, in order:

1. **"No Production Deployment"** — a separate Vercel project with Root
   Directory = `api` can't work: Vercel looks for functions in an `api/` dir
   *relative to the project root*. Fixed by colocating as `web/api/`.
2. **`/api/health` opened the app instead of JSON** — the service worker's
   `navigateFallback` answered any typed URL with the cached app shell. Fixed
   with `navigateFallbackDenylist: [/^\/api\//]`. _Testing tip: a private
   window bypasses the service worker entirely._
3. **`FUNCTION_INVOCATION_FAILED` / `ModuleNotFoundError: No module named
   '_app'`** — serverless builders don't reliably bundle sibling modules next
   to the entrypoint. Fixed by making the API ONE self-contained
   `web/api/index.py` (schema DDL embedded, no local imports). **Don't
   reintroduce helper modules next to index.py.**
4. **Stale builds** — Vercel's **Redeploy** replays that deployment's OWN
   commit, so it can never pick up a newer fix. Trigger a genuine new build
   (push) instead, and confirm the deployment's commit hash.

Also: Production Branch should be **`main`** (it was building from the working
branch `claude/eloquent-pasteur-o7drkn`, which will eventually be deleted).

Diagnosing a deploy: `/api/health` returns `{ok, db, tokens}` (+ `config_error`
if `SYNC_TOKENS` is malformed) — it names which env var didn't land, without
revealing values.

## ⏳ Pending: YOUR actions (away-from-computer to-do)

1. **Deploy the Postgres backend** — runbook: `docs/deploy-vercel-neon.md`.
   **NOW A SINGLE VERCEL PROJECT** (the earlier two-project setup failed with
   "No Production Deployment" — Vercel's Python detection expects functions in
   an `api/` dir relative to the project root, which a root-directory-of-`api`
   project can't satisfy). The API moved to `web/api/` and deploys as functions
   on the app's own origin.
   - **Delete** the separate `p90x` API project if you made one — unused.
   - Neon: create project → copy the **pooled** connection string.
   - Existing Vercel project → Settings → Env Vars → add `DATABASE_URL` +
     `SYNC_TOKENS` → Redeploy. (No `CORS_ORIGINS` needed — same origin.)
   - Check `https://p90xtracker.vercel.app/api/health` → `{"ok":true}`.
   - In the app: **Account → Sync server** → paste **just your token** →
     **Connect & back up**. (URL field is optional/blank.)
   - _Neon holds the data, so compute can move to Render/Railway/Pi later with
     no migration._

2. **Get devices onto the new build** to receive the aura + map + busy fixes.
   Check the `Build …` stamp at the bottom of **Account** to confirm.

## 💭 Explored, parked: making the app public / multi-user

Asked whether the app could be standalone (not just the two of us). Answer:
yes — **parked for now, revisit later**. Findings so we don't re-derive them:

- **Already done:** multi-tenancy. Every row carries `account_id`, all queries
  are scoped by it, and there's a cross-account write guard
  (`api/main.py:161,184`) so a UUID belonging to another account can't be
  overwritten. Scaling from 2 accounts to many needs no data-model change.
- **Would need building:** self-serve sign-up. Replace the hand-made
  `SYNC_TOKENS` env map with **Google Sign-In for identity only**
  (`openid email profile` — no Drive, non-sensitive, no consent warning); the
  API verifies the ID token and uses Google's stable subject as `account_id`.
  GIS is already wired, so ~a day's work, not a rewrite.
- **⚠️ BLOCKER before any public release — privacy.** `web/public/history.json`
  is bundled into every install: 791 sessions, **2.8 MB**, **82 distinct
  locations**, **146 sessions with personal notes**. Publishing it would hand
  every stranger a 7-year travel/training diary. It must become a private
  import (file or server restore) for the owner's account, not a shipped
  asset. Bonus: −2.8 MB bundle.
- **⚠️ Consider before public — IP.** "P90X"/"Body Beast" are Beachbody
  trademarks and the app ships their official logos + routine structures.
  Fine privately; real exposure publicly. Usual fix: drop logos, neutral
  naming, routines as user-created templates. Owner's call.
- **Also needed:** account deletion, rate limiting + payload caps, and cost
  planning (Neon/Vercel free tiers are fine for tens–low hundreds of users).
- **Middle option** if full-public is too much: invite-code redemption —
  keeps the token model, just makes it self-serve. Much smaller build.

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
