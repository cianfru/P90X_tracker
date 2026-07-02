import { db } from './db'
import type { Modifier, Session, Supplement, WorkoutSet } from './types'

/*
 * One-time history import: seed 7 years (~791 sessions / 18,841 sets) from the
 * pre-built public/history.json into Dexie so the logger pre-fills from real
 * data and the Monitor has something to chart on day one. Fetched once and
 * runtime-cached (see vite.config) so a re-seed works offline too.
 *
 * Inserted in chunks so the UI can show progress and stay responsive, and so an
 * interrupted import is recoverable (imported rows carry deviceId 'import'; if
 * the done-flag is missing we wipe and retry — but never touch user-logged rows).
 */

const FLAG = 'p90x-history-seeded'
const META_FLAG = 'p90x-history-meta-seeded-v2' // bump to re-backfill corrected meta
const IMPORT_DEVICE = 'import'
const CHUNK = 3000

interface RawSet {
  id: string
  exerciseId: string
  reps: number
  weightKg: number | null
  round: number
  modifiers: string[]
  struggle: boolean
}
interface RawSession {
  id: string
  date: string
  workoutId: string
  sets: RawSet[]
  location?: string
  form?: number
  notes?: string
  supplements?: Supplement[]
}

/** Copy present metadata fields from a raw history row onto a Session. */
function applyMeta(target: Partial<Session>, raw: RawSession): void {
  if (raw.location) target.location = raw.location
  if (raw.form != null) target.form = raw.form
  if (raw.notes) target.notes = raw.notes
  if (raw.supplements?.length) target.supplements = raw.supplements
}

/** True on a fresh install, or after an interrupted import with no user data yet. */
export async function needsHistorySeed(): Promise<boolean> {
  if (localStorage.getItem(FLAG)) return false
  const sessions = await db.sessions.toArray()
  return !sessions.some((s) => s.deviceId !== IMPORT_DEVICE)
}

/** Import the bundled history in chunks. Returns sessions seeded (0 if skipped). */
export async function seedHistory(
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  if (!(await needsHistorySeed())) return 0

  // Clear any partial import from a previous interrupted run (import-only rows).
  if ((await db.sessions.count()) > 0) {
    await db.transaction('rw', db.sessions, db.sets, async () => {
      await db.sets.clear()
      await db.sessions.clear()
    })
  }

  const res = await fetch(`${import.meta.env.BASE_URL}history.json`)
  if (!res.ok) throw new Error(`history fetch failed: ${res.status}`)
  const raw = (await res.json()) as RawSession[]

  const sessions: Session[] = []
  const sets: WorkoutSet[] = []
  for (const s of raw) {
    // Date-derived timestamps so sets order chronologically (prefill = latest).
    const base = new Date(`${s.date}T12:00:00`).getTime()
    const session: Session = {
      id: s.id,
      date: s.date,
      workoutId: s.workoutId,
      deviceId: IMPORT_DEVICE,
      createdAt: base,
    }
    applyMeta(session, s)
    sessions.push(session)
    s.sets.forEach((st, i) => {
      sets.push({
        id: st.id,
        sessionId: s.id,
        exerciseId: st.exerciseId,
        reps: st.reps,
        weightKg: st.weightKg,
        round: st.round,
        modifiers: st.modifiers as Modifier[],
        struggle: st.struggle,
        loggedAt: base + i * 1000,
        deleted: false,
      })
    })
  }

  await db.sessions.bulkAdd(sessions)
  for (let i = 0; i < sets.length; i += CHUNK) {
    await db.sets.bulkAdd(sets.slice(i, i + CHUNK))
    onProgress?.(Math.min(i + CHUNK, sets.length), sets.length)
  }

  localStorage.setItem(FLAG, '1')
  localStorage.setItem(META_FLAG, '1') // fresh seed already carries metadata
  return sessions.length
}

/**
 * One-time backfill of session metadata (location / form / notes / supplements)
 * onto installs that imported history BEFORE these fields existed. Matches the
 * bundled history.json rows to existing import sessions by their stable UUID and
 * patches only the metadata — user-logged sessions (different ids) are untouched.
 */
export async function seedHistoryMeta(): Promise<number> {
  if (localStorage.getItem(META_FLAG)) return 0
  if (!localStorage.getItem(FLAG)) return 0 // no prior import to backfill

  const res = await fetch(`${import.meta.env.BASE_URL}history.json`)
  if (!res.ok) throw new Error(`history fetch failed: ${res.status}`)
  const raw = (await res.json()) as RawSession[]

  let patched = 0
  await db.transaction('rw', db.sessions, async () => {
    for (const s of raw) {
      const meta: Partial<Session> = {}
      applyMeta(meta, s)
      if (Object.keys(meta).length === 0) continue
      const existing = await db.sessions.get(s.id)
      if (existing && existing.deviceId === IMPORT_DEVICE) {
        await db.sessions.update(s.id, meta)
        patched++
      }
    }
  })

  localStorage.setItem(META_FLAG, '1')
  return patched
}
