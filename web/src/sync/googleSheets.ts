import { db } from '../db'
import type { Modifier, Session, Supplement, WorkoutSet } from '../db'
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
  const res = await fetch(url, {
    ...init,
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

/** The spreadsheet id, creating the workbook on first use. Returns {id, fresh}. */
export async function ensureSpreadsheet(): Promise<{ id: string; fresh: boolean }> {
  const cached = localStorage.getItem(sheetKey())
  if (cached) return { id: cached, fresh: false }
  let id = await findSpreadsheet()
  let fresh = false
  if (!id) {
    id = await createSpreadsheet()
    fresh = true
  }
  localStorage.setItem(sheetKey(), id)
  return { id, fresh }
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

/** Push queued (or all) local rows to the sheet as appended rows. */
async function pushOutbox(id: string): Promise<void> {
  const entries = await db.outbox.toArray()
  if (!entries.length) return
  const sessionIds = entries.filter((e) => e.table === 'sessions').map((e) => e.rowId)
  const setIds = entries.filter((e) => e.table === 'sets').map((e) => e.rowId)
  const sessions = (await db.sessions.bulkGet(sessionIds)).filter(Boolean) as Session[]
  const sets = (await db.sets.bulkGet(setIds)).filter(Boolean) as WorkoutSet[]
  if (sessions.length) await appendRows(id, SESSIONS, sessions.map(sessionToRow))
  if (sets.length) await appendRows(id, SETS, sets.map(setToRow))
  await db.outbox.bulkDelete(entries.map((e) => e.key))
}

/** Append EVERY local row — the one-time migration into a fresh sheet. */
export async function pushAll(
  id: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
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
  markMigrationDone()
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

let running = false

/** Full Google sync: ensure sheet, push queued rows, pull new ones. */
export async function syncGoogle(): Promise<{
  ok: boolean
  reason?: string
  pulled?: { sessions: number; sets: number }
}> {
  if (!cachedAccount()) return { ok: false, reason: 'signed-out' }
  if (running) return { ok: false, reason: 'busy' }
  running = true
  try {
    const { id } = await ensureSpreadsheet()
    await pushOutbox(id)
    const pulled = await pullNew(id)
    await db.meta.put({ key: 'lastSyncAt', value: Date.now() })
    return { ok: true, pulled }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  } finally {
    running = false
  }
}
