import { db } from './db'
import type { Modifier, Session, WorkoutSet } from './types'

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
    sessions.push({
      id: s.id,
      date: s.date,
      workoutId: s.workoutId,
      deviceId: IMPORT_DEVICE,
      createdAt: base,
    })
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
  return sessions.length
}
