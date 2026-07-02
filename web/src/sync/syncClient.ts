import { db } from '../db'
import type { Modifier, Session, Supplement, WorkoutSet } from '../db'

/*
 * Sync client — the other half of /api. Local-first: this never blocks the UI.
 *
 * flow (single-user, append-only, last-write-wins):
 *   push  → send outbox rows to /sync/push, then clear them from the outbox
 *   pull  → GET /sync/pull?since=<cursor>, apply rows to Dexie, advance cursor
 *
 * The cursor is a server sequence number and is only ever advanced by pull(),
 * so rows another device pushed (with a lower seq than our just-pushed rows)
 * are never skipped. Re-pulling our own pushed rows once is harmless (bulkPut
 * is idempotent).
 */

interface SyncConfig {
  url: string
  token: string
}

/** Backend config from localStorage (overrides) or Vite env; null = disabled. */
export function syncConfig(): SyncConfig | null {
  const env = import.meta.env
  const url = (localStorage.getItem('p90x-sync-url') || env.VITE_SYNC_URL || '')
    .toString()
    .replace(/\/$/, '')
  const token = (
    localStorage.getItem('p90x-sync-token') ||
    env.VITE_SYNC_TOKEN ||
    ''
  ).toString()
  return url && token ? { url, token } : null
}

export const syncEnabled = (): boolean => syncConfig() !== null

async function getCursor(): Promise<number> {
  const m = await db.meta.get('syncCursor')
  return typeof m?.value === 'number' ? m.value : 0
}
async function setCursor(v: number): Promise<void> {
  await db.meta.put({ key: 'syncCursor', value: v })
}

// ---- camelCase (Dexie) ↔ snake_case (wire) mapping ----
interface WireSession {
  id: string
  date: string
  workout_id: string
  device_id: string
  created_at: number
  location: string | null
  form: number | null
  notes: string | null
  supplements: Supplement[]
  deleted: boolean
}
interface WireSet {
  id: string
  session_id: string
  exercise_id: string
  reps: number
  weight_kg: number | null
  round: number
  modifiers: Modifier[]
  struggle: boolean
  logged_at: number
  deleted: boolean
}

const sessionToWire = (s: Session): WireSession => ({
  id: s.id,
  date: s.date,
  workout_id: s.workoutId,
  device_id: s.deviceId,
  created_at: s.createdAt,
  location: s.location ?? null,
  form: s.form ?? null,
  notes: s.notes ?? null,
  supplements: s.supplements ?? [],
  deleted: !!s.deleted,
})
const setToWire = (s: WorkoutSet): WireSet => ({
  id: s.id,
  session_id: s.sessionId,
  exercise_id: s.exerciseId,
  reps: s.reps,
  weight_kg: s.weightKg,
  round: s.round,
  modifiers: s.modifiers,
  struggle: s.struggle,
  logged_at: s.loggedAt,
  deleted: s.deleted,
})
const wireToSession = (w: WireSession): Session => {
  const s: Session = {
    id: w.id,
    date: w.date,
    workoutId: w.workout_id,
    deviceId: w.device_id,
    createdAt: w.created_at,
    deleted: !!w.deleted,
  }
  if (w.location) s.location = w.location
  if (w.form != null) s.form = w.form
  if (w.notes) s.notes = w.notes
  if (w.supplements?.length) s.supplements = w.supplements
  return s
}
const wireToSet = (w: WireSet): WorkoutSet => ({
  id: w.id,
  sessionId: w.session_id,
  exerciseId: w.exercise_id,
  reps: w.reps,
  weightKg: w.weight_kg ?? null,
  round: w.round,
  modifiers: w.modifiers ?? [],
  struggle: !!w.struggle,
  loggedAt: w.logged_at,
  deleted: !!w.deleted,
})

async function push(cfg: SyncConfig): Promise<void> {
  const entries = await db.outbox.toArray()
  if (!entries.length) return
  const sessionIds = entries
    .filter((e) => e.table === 'sessions')
    .map((e) => e.rowId)
  const setIds = entries.filter((e) => e.table === 'sets').map((e) => e.rowId)
  const sessions = (await db.sessions.bulkGet(sessionIds))
    .filter((s): s is Session => Boolean(s))
    .map(sessionToWire)
  const sets = (await db.sets.bulkGet(setIds))
    .filter((s): s is WorkoutSet => Boolean(s))
    .map(setToWire)

  const res = await fetch(`${cfg.url}/sync/push`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.token}`,
    },
    body: JSON.stringify({ sessions, sets }),
  })
  if (!res.ok) throw new Error(`push failed: ${res.status}`)
  // Clear exactly the rows we sent (rows written meanwhile keep their entry).
  await db.outbox.bulkDelete(entries.map((e) => e.key))
}

async function pull(cfg: SyncConfig): Promise<{ sessions: number; sets: number }> {
  const since = await getCursor()
  const res = await fetch(`${cfg.url}/sync/pull?since=${since}`, {
    headers: { authorization: `Bearer ${cfg.token}` },
  })
  if (!res.ok) throw new Error(`pull failed: ${res.status}`)
  const data = (await res.json()) as {
    cursor?: number
    sessions?: WireSession[]
    sets?: WireSet[]
  }
  const sessions = (data.sessions ?? []).map(wireToSession)
  const sets = (data.sets ?? []).map(wireToSet)
  if (sessions.length) await db.sessions.bulkPut(sessions)
  if (sets.length) await db.sets.bulkPut(sets)
  if (typeof data.cursor === 'number') await setCursor(data.cursor)
  return { sessions: sessions.length, sets: sets.length }
}

export interface SyncResult {
  ok: boolean
  reason?: string
  pulled?: { sessions: number; sets: number }
}

let running = false

/** Push local changes then pull remote ones. Safe no-op if unconfigured/offline. */
export async function sync(): Promise<SyncResult> {
  const cfg = syncConfig()
  if (!cfg) return { ok: false, reason: 'not-configured' }
  if (running) return { ok: false, reason: 'busy' }
  running = true
  try {
    await push(cfg)
    const pulled = await pull(cfg)
    await db.meta.put({ key: 'lastSyncAt', value: Date.now() })
    return { ok: true, pulled }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  } finally {
    running = false
  }
}
