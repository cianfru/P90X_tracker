import { db } from '../db'
import type {
  Exercise,
  Modifier,
  Session,
  Supplement,
  WorkoutSet,
  WorkoutTemplate,
} from '../db'
import { MODIFIER_META } from '../db'
import { cachedAccount, getAccessToken } from './googleAuth'

/*
 * Google Sheets as the backing store ("memory"). The app stays local-first —
 * Dexie is the working copy and every read hits it. This layer only backs up to
 * and restores from a spreadsheet in the signed-in user's own Drive:
 *   push → append new/soft-deleted rows (append-only; last row per id wins)
 *   pull → read rows added since our cursor, upsert into Dexie
 * One workbook ("P90X Logbook") with two tabs, `sessions` and `sets`. Each
 * account gets its own sheet in its own Drive, so people stay separate.
 */

const SHEET_TITLE = 'P90X Logbook'
const SESSIONS = 'sessions'
const SETS = 'sets'

const SESSION_HEADER = [
  'id', 'date', 'workoutId', 'deviceId', 'createdAt', 'location', 'lat', 'lon',
  'form', 'notes', 'supplements', 'deleted',
]
const SET_HEADER = [
  'id', 'sessionId', 'exerciseId', 'reps', 'weightKg', 'round', 'modifiers',
  'struggle', 'loggedAt', 'deleted',
]

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files'

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken()
  // Abort a request that hangs (flaky mobile connection) instead of leaving the
  // sync's in-flight guard stuck forever — the caller then fails cleanly.
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 25_000)
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Sheets API ${res.status}: ${body.slice(0, 200)}`)
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

// ---- cell (de)serialisation ----
const b = (v: boolean) => (v ? '1' : '')
const parseB = (v: unknown) => v === '1' || v === 'TRUE' || v === true
const numOrNull = (v: unknown) =>
  v === '' || v == null ? null : Number(v)
const jsonArr = <T>(v: unknown): T[] => {
  if (typeof v !== 'string' || !v) return []
  try {
    return JSON.parse(v) as T[]
  } catch {
    return []
  }
}

// ---- readable view (one tab per workout, exercises × dates) ----
// A WRITE-ONLY projection so the sheet reads like the original xlsx. The app
// never reads these tabs back — `sessions`/`sets` stay the source of truth.
const MIXER_KEY = '__mixer'
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtDay = (iso: string): string => {
  const [y, m, d] = iso.split('-')
  return `${d} ${MON[Number(m) - 1] ?? m} ${y.slice(2)}`
}
// Sheet tab names can't contain []:*?/\ and cap at 100 chars.
const sanitizeTab = (name: string): string =>
  name.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Workout'
/** A single logged set as a cell value, e.g. "12", "10×40", "15(L)🔥". */
const fmtCellSet = (s: WorkoutSet): string => {
  const base = s.weightKg != null ? `${s.reps}×${s.weightKg}` : `${s.reps}`
  const mods = s.modifiers.map((m) => MODIFIER_META[m]?.label ?? m).join(',')
  return base + (mods ? `(${mods})` : '') + (s.struggle ? '🔥' : '')
}
// Group sessions into one tab per workout; every Mixer remix collapses to one.
const groupKeyOf = (s: Session, tplById: Map<string, WorkoutTemplate>): string =>
  tplById.get(s.workoutId)?.program === 'Mixer' ? MIXER_KEY : s.workoutId
const groupTitle = (key: string, tplById: Map<string, WorkoutTemplate>): string =>
  key === MIXER_KEY ? 'Mixer' : sanitizeTab(tplById.get(key)?.name ?? key)

const sessionToRow = (s: Session): string[] => [
  s.id, s.date, s.workoutId, s.deviceId, String(s.createdAt),
  s.location ?? '', s.lat != null ? String(s.lat) : '',
  s.lon != null ? String(s.lon) : '', s.form != null ? String(s.form) : '',
  s.notes ?? '', JSON.stringify(s.supplements ?? []), b(!!s.deleted),
]
function rowToSession(r: string[]): Session {
  const [id, date, workoutId, deviceId, createdAt, location, lat, lon, form, notes, supp, deleted] = r
  const s: Session = {
    id, date, workoutId,
    deviceId: deviceId || 'sheet',
    createdAt: Number(createdAt) || 0,
    deleted: parseB(deleted),
  }
  if (location) s.location = location
  const la = numOrNull(lat), lo = numOrNull(lon), fo = numOrNull(form)
  if (la != null) s.lat = la
  if (lo != null) s.lon = lo
  if (fo != null) s.form = fo
  if (notes) s.notes = notes
  const sup = jsonArr<Supplement>(supp)
  if (sup.length) s.supplements = sup
  return s
}

const setToRow = (s: WorkoutSet): string[] => [
  s.id, s.sessionId, s.exerciseId, String(s.reps),
  s.weightKg != null ? String(s.weightKg) : '', String(s.round),
  JSON.stringify(s.modifiers ?? []), b(s.struggle), String(s.loggedAt),
  b(s.deleted),
]
function rowToSet(r: string[]): WorkoutSet {
  const [id, sessionId, exerciseId, reps, weightKg, round, mods, struggle, loggedAt, deleted] = r
  return {
    id, sessionId, exerciseId,
    reps: Number(reps) || 0,
    weightKg: numOrNull(weightKg),
    round: Number(round) || 1,
    modifiers: jsonArr<Modifier>(mods),
    struggle: parseB(struggle),
    loggedAt: Number(loggedAt) || 0,
    deleted: parseB(deleted),
  }
}

// ---- spreadsheet lookup / creation (cached per account) ----
function sheetKey(): string {
  return `p90x-sheet-id-${cachedAccount()?.email ?? 'anon'}`
}

// First-run migration gate: auto-sync stays off until the account's initial
// choice (upload existing / start clean / restore) has completed, so it can't
// race that choice and write duplicate rows.
const readyKey = () => `p90x-gsheet-ready-${cachedAccount()?.email ?? 'anon'}`
export const migrationDone = (): boolean => !!localStorage.getItem(readyKey())
export const markMigrationDone = (): void =>
  localStorage.setItem(readyKey(), '1')

async function findSpreadsheet(): Promise<string | null> {
  const q = encodeURIComponent(
    `name='${SHEET_TITLE}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
  )
  const j = await api<{ files: { id: string }[] }>(
    `${DRIVE_API}?q=${q}&fields=files(id,name)&spaces=drive`,
  )
  return j.files?.[0]?.id ?? null
}

async function createSpreadsheet(): Promise<string> {
  const j = await api<{ spreadsheetId: string }>(SHEETS_API, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title: SHEET_TITLE },
      sheets: [
        { properties: { title: SESSIONS } },
        { properties: { title: SETS } },
      ],
    }),
  })
  await appendRows(j.spreadsheetId, SESSIONS, [SESSION_HEADER])
  await appendRows(j.spreadsheetId, SETS, [SET_HEADER])
  return j.spreadsheetId
}

/**
 * The spreadsheet id (found or created), plus whether it currently holds NO
 * data rows. `empty` drives the first-run choice: a sheet that exists but was
 * never populated (e.g. an interrupted first sync) still needs the upload.
 */
export async function ensureSpreadsheet(): Promise<{ id: string; empty: boolean }> {
  let id = localStorage.getItem(sheetKey())
  if (!id) {
    id = (await findSpreadsheet()) ?? (await createSpreadsheet())
    localStorage.setItem(sheetKey(), id)
  }
  const dataRows = (await readRows(id, SESSIONS, 2)).filter((r) => r[0])
  return { id, empty: dataRows.length === 0 }
}

async function appendRows(
  id: string,
  tab: string,
  rows: string[][],
): Promise<void> {
  if (!rows.length) return
  await api(
    `${SHEETS_API}/${id}/values/${tab}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: rows }) },
  )
}

async function readRows(
  id: string,
  tab: string,
  fromRow: number,
): Promise<string[][]> {
  const range = `${tab}!A${fromRow}:Z`
  const j = await api<{ values?: string[][] }>(
    `${SHEETS_API}/${id}/values/${encodeURIComponent(range)}`,
  )
  return j.values ?? []
}

const CHUNK = 2000
const rowKey = (tab: string) => `gsheet-rows-${tab}`

/** Push queued (or all) local rows to the sheet; returns the workout group keys
 *  touched so the readable view can rewrite just those tabs. */
async function pushOutbox(id: string): Promise<Set<string>> {
  const entries = await db.outbox.toArray()
  if (!entries.length) return new Set()
  const sessionIds = entries.filter((e) => e.table === 'sessions').map((e) => e.rowId)
  const setIds = entries.filter((e) => e.table === 'sets').map((e) => e.rowId)
  const sessions = (await db.sessions.bulkGet(sessionIds)).filter(Boolean) as Session[]
  const sets = (await db.sets.bulkGet(setIds)).filter(Boolean) as WorkoutSet[]
  if (sessions.length) await appendRows(id, SESSIONS, sessions.map(sessionToRow))
  if (sets.length) await appendRows(id, SETS, sets.map(setToRow))
  await db.outbox.bulkDelete(entries.map((e) => e.key))

  const templates = await db.templates.toArray()
  const tplById = new Map(templates.map((t) => [t.id, t]))
  const setSessIds = [...new Set(sets.map((s) => s.sessionId))]
  const setSessions = (await db.sessions.bulkGet(setSessIds)).filter(Boolean) as Session[]
  const touched = new Set<string>()
  for (const s of [...sessions, ...setSessions]) touched.add(groupKeyOf(s, tplById))
  return touched
}

async function clearData(id: string, tab: string): Promise<void> {
  await api(`${SHEETS_API}/${id}/values/${tab}!A2:Z:clear`, { method: 'POST' })
}

/**
 * Replace the sheet with EVERY local row — the migration / full backup. Clears
 * existing data rows first so running it again can't create duplicates.
 */
export async function pushAll(
  id: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  await clearData(id, SESSIONS)
  await clearData(id, SETS)
  const sessions = await db.sessions.toArray()
  const sets = await db.sets.toArray()
  await appendRows(id, SESSIONS, sessions.map(sessionToRow))
  const total = sets.length
  for (let i = 0; i < total; i += CHUNK) {
    await appendRows(id, SETS, sets.slice(i, i + CHUNK).map(setToRow))
    onProgress?.(Math.min(i + CHUNK, total), total)
  }
  // Everything is now in the sheet; drop any queued pushes + set the cursor
  // past what we just wrote so we don't re-pull our own rows.
  await db.outbox.clear()
  await db.meta.put({ key: rowKey(SESSIONS), value: sessions.length + 1 })
  await db.meta.put({ key: rowKey(SETS), value: sets.length + 1 })
  await db.meta.put({ key: 'lastSyncAt', value: Date.now() })
  // Bump the generation so other devices know the sheet was fully rewritten and
  // must reconcile everything rather than trust their row cursors.
  const gen = String(Date.now())
  await writeGen(id, gen)
  await db.meta.put({ key: 'gsheet-gen', value: gen })
  markMigrationDone()
  // Rebuild the whole human-readable view (best-effort; never fail the backup).
  try {
    await rebuildReadable(id)
  } catch {
    /* readable view is a convenience projection, not the source of truth */
  }
}

// ---- readable per-workout tabs (write-only) ----
async function getTabTitles(id: string): Promise<Set<string>> {
  const j = await api<{ sheets: { properties: { title: string } }[] }>(
    `${SHEETS_API}/${id}?fields=sheets.properties.title`,
  )
  return new Set((j.sheets ?? []).map((s) => s.properties.title))
}

async function addTab(id: string, title: string): Promise<void> {
  await api(`${SHEETS_API}/${id}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  })
}

async function writeMatrix(id: string, tab: string, values: string[][]): Promise<void> {
  await api(
    `${SHEETS_API}/${id}/values/${encodeURIComponent(`${tab}!A1`)}?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values }) },
  )
}

interface Grp {
  exOrder: string[]
  dates: Set<string>
  cells: Map<string, Map<string, WorkoutSet[]>> // exId -> date -> sets
}

/**
 * Regenerate the readable, one-tab-per-workout view: exercises down column A,
 * dates across row 1, cells showing reps (and ×kg / modifiers) — like the
 * original spreadsheet. WRITE-ONLY. Pass `onlyKeys` to rewrite just the
 * workouts that changed (incremental sync); omit it for a full rebuild.
 */
export async function rebuildReadable(
  id: string,
  onlyKeys?: Set<string>,
): Promise<void> {
  const [sessions, sets, exercises, templates] = await Promise.all([
    db.sessions.toArray(),
    db.sets.toArray(),
    db.exercises.toArray(),
    db.templates.toArray(),
  ])
  const exById = new Map(exercises.map((e) => [e.id, e] as const))
  const tplById = new Map(templates.map((t) => [t.id, t] as const))
  const sessById = new Map(sessions.map((s) => [s.id, s] as const))

  const groups = new Map<string, Grp>()
  const ensure = (key: string): Grp => {
    let g = groups.get(key)
    if (!g) {
      const tpl = key === MIXER_KEY ? undefined : tplById.get(key)
      g = { exOrder: tpl ? [...tpl.exerciseIds] : [], dates: new Set(), cells: new Map() }
      groups.set(key, g)
    }
    return g
  }

  for (const st of sets) {
    if (st.deleted) continue
    const sess = sessById.get(st.sessionId)
    if (!sess || sess.deleted) continue
    const g = ensure(groupKeyOf(sess, tplById))
    g.dates.add(sess.date)
    if (!g.exOrder.includes(st.exerciseId)) g.exOrder.push(st.exerciseId)
    let byDate = g.cells.get(st.exerciseId)
    if (!byDate) g.cells.set(st.exerciseId, (byDate = new Map()))
    const arr = byDate.get(sess.date) ?? []
    arr.push(st)
    byDate.set(sess.date, arr)
  }

  const titles = await getTabTitles(id)
  for (const [key, g] of groups) {
    if (onlyKeys && !onlyKeys.has(key)) continue
    const rowIds = g.exOrder.filter((exId) => g.cells.has(exId))
    if (!rowIds.length) continue
    const dates = [...g.dates].sort()
    const matrix: string[][] = [['Exercise', ...dates.map(fmtDay)]]
    for (const exId of rowIds) {
      const ex: Exercise | undefined = exById.get(exId)
      const byDate = g.cells.get(exId)!
      matrix.push([
        ex?.displayName ?? ex?.name ?? exId,
        ...dates.map((d) => {
          const arr = byDate.get(d)
          if (!arr?.length) return ''
          return [...arr].sort((a, z) => a.round - z.round).map(fmtCellSet).join(', ')
        }),
      ])
    }
    const title = groupTitle(key, tplById)
    if (!titles.has(title)) {
      await addTab(id, title)
      titles.add(title)
    }
    await api(`${SHEETS_API}/${id}/values/${encodeURIComponent(`${title}!A:ZZ`)}:clear`, {
      method: 'POST',
    })
    await writeMatrix(id, title, matrix)
  }
}

// A "generation" stamp in a cell OUTSIDE the data columns. `pushAll` bumps it
// whenever it rewrites the whole sheet; other devices notice the change and do
// a full reconcile (row-position cursors are meaningless after a rewrite).
const GEN_CELL = `${SESSIONS}!N1`
async function readGen(id: string): Promise<string> {
  try {
    const j = await api<{ values?: string[][] }>(
      `${SHEETS_API}/${id}/values/${encodeURIComponent(GEN_CELL)}`,
    )
    return j.values?.[0]?.[0] ?? ''
  } catch {
    return ''
  }
}
async function writeGen(id: string, gen: string): Promise<void> {
  await api(
    `${SHEETS_API}/${id}/values/${encodeURIComponent(GEN_CELL)}?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values: [[gen]] }) },
  )
}

/**
 * Read the ENTIRE sheet and upsert every row into Dexie by UUID. Idempotent and
 * always correct — used on sign-in, manual sync, and after a remote full backup
 * rewrote the sheet (which invalidates the incremental row cursors).
 */
async function pullFull(id: string): Promise<{ sessions: number; sets: number }> {
  const sVals = (await readRows(id, SESSIONS, 2)).filter((r) => r[0])
  const tVals = (await readRows(id, SETS, 2)).filter((r) => r[0])
  if (sVals.length) await db.sessions.bulkPut(sVals.map(rowToSession))
  if (tVals.length) await db.sets.bulkPut(tVals.map(rowToSet))
  await db.meta.put({ key: rowKey(SESSIONS), value: sVals.length + 1 })
  await db.meta.put({ key: rowKey(SETS), value: tVals.length + 1 })
  return { sessions: sVals.length, sets: tVals.length }
}

/** Pull rows appended since our cursor and upsert them into Dexie. */
async function pullNew(id: string): Promise<{ sessions: number; sets: number }> {
  const cursor = async (tab: string) =>
    (((await db.meta.get(rowKey(tab)))?.value as number) ?? 1) + 1 // skip header
  const sRow = await cursor(SESSIONS)
  const tRow = await cursor(SETS)
  const sVals = await readRows(id, SESSIONS, sRow)
  const tVals = await readRows(id, SETS, tRow)
  if (sVals.length) {
    const sessions = sVals.filter((r) => r[0]).map(rowToSession)
    if (sessions.length) await db.sessions.bulkPut(sessions)
    await db.meta.put({ key: rowKey(SESSIONS), value: sRow - 1 + sVals.length })
  }
  if (tVals.length) {
    const sets = tVals.filter((r) => r[0]).map(rowToSet)
    if (sets.length) await db.sets.bulkPut(sets)
    await db.meta.put({ key: rowKey(SETS), value: tRow - 1 + tVals.length })
  }
  return { sessions: sVals.length, sets: tVals.length }
}

// Overlap guard that self-heals: a run older than STALE_MS is treated as dead
// (a hung request that never resolved), so a stuck sync can't wedge every
// future backup on a permanent "busy".
let runningSince = 0
const STALE_MS = 90_000

/**
 * Full Google sync: ensure sheet, push queued rows, pull new ones. Pass
 * `{ full: true }` to reconcile the ENTIRE sheet by UUID (sign-in / manual
 * sync). Otherwise it pulls incrementally, but auto-escalates to a full
 * reconcile when the sheet's generation stamp shows it was rewritten elsewhere.
 */
export async function syncGoogle(opts?: { full?: boolean }): Promise<{
  ok: boolean
  reason?: string
  pulled?: { sessions: number; sets: number }
}> {
  if (!cachedAccount()) return { ok: false, reason: 'signed-out' }
  if (runningSince && Date.now() - runningSince < STALE_MS) {
    return { ok: false, reason: 'busy' }
  }
  runningSince = Date.now()
  try {
    const { id } = await ensureSpreadsheet()
    const touched = await pushOutbox(id)
    const remoteGen = await readGen(id)
    const localGen = ((await db.meta.get('gsheet-gen'))?.value as string) ?? ''
    let pulled
    if (opts?.full || (remoteGen && remoteGen !== localGen)) {
      pulled = await pullFull(id)
      if (remoteGen) await db.meta.put({ key: 'gsheet-gen', value: remoteGen })
    } else {
      pulled = await pullNew(id)
    }
    await db.meta.put({ key: 'lastSyncAt', value: Date.now() })
    // Refresh only the readable tabs for the workouts we just pushed.
    if (touched.size) {
      try {
        await rebuildReadable(id, touched)
      } catch {
        /* best-effort convenience view */
      }
    }
    return { ok: true, pulled }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  } finally {
    runningSince = 0
  }
}
