import { db } from '../db'
import type { ExerciseType, Modifier, Session } from '../db'
import { effortOf } from './effort'

/*
 * "Last time" — what you did on this move the last time you did THIS workout.
 *
 * Everything the logger pre-fills and shows comes from here, and it is scoped
 * on purpose: same workout, same exercise, same set number. Standard push-ups
 * appear in P90X chest & back and in three P90X3 routines, and 50 reps in one
 * says nothing about the other — so a set is only ever compared with the same
 * set of the same workout. No averages: the number you see is the number you
 * logged.
 */

export interface PrevSet {
  reps: number
  weightKg: number | null
  modifiers: Modifier[]
}

export interface PrevSession {
  date: string
  /** This move's sets in that session, in the order they were done. */
  sets: PrevSet[]
}

export interface LastTime {
  /** Previous sessions of this workout that included the move, newest first. */
  sessions: PrevSession[]
  /** Best single-set effort for this move in this workout, ever. */
  bestEffort?: number
}

const SHOWN = 4

/**
 * History of one move within one workout, strictly BEFORE `current` — a
 * backdated session compares with what came before it, not with today.
 */
export async function lastTimeFor(
  current: Pick<Session, 'id' | 'workoutId' | 'date' | 'createdAt'>,
  exerciseId: string,
  type: ExerciseType,
): Promise<LastTime> {
  const sets = (
    await db.sets.where('exerciseId').equals(exerciseId).toArray()
  ).filter((s) => !s.deleted && s.sessionId !== current.id)
  if (!sets.length) return { sessions: [] }

  const ids = [...new Set(sets.map((s) => s.sessionId))]
  const before = (s: Session) =>
    s.date < current.date ||
    (s.date === current.date && s.createdAt < current.createdAt)
  const sessions = new Map<string, Session>()
  for (const s of await db.sessions.bulkGet(ids)) {
    if (s && !s.deleted && s.workoutId === current.workoutId && before(s)) {
      sessions.set(s.id, s)
    }
  }
  if (!sessions.size) return { sessions: [] }

  const bySession = new Map<string, typeof sets>()
  let bestEffort: number | undefined
  for (const s of sets) {
    if (!sessions.has(s.sessionId)) continue
    const list = bySession.get(s.sessionId) ?? []
    list.push(s)
    bySession.set(s.sessionId, list)
    const e = effortOf(s, type)
    if (bestEffort === undefined || e > bestEffort) bestEffort = e
  }

  const ordered = [...bySession.keys()]
    .map((id) => sessions.get(id)!)
    .sort((a, b) =>
      a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1,
    )
    .slice(0, SHOWN)

  return {
    bestEffort,
    sessions: ordered.map((s) => ({
      date: s.date,
      sets: bySession
        .get(s.id)!
        .sort((a, b) => a.round - b.round || a.loggedAt - b.loggedAt)
        .map((x) => ({
          reps: x.reps,
          weightKg: x.weightKg,
          modifiers: x.modifiers,
        })),
    })),
  }
}

/**
 * The set to pre-fill for set number `index` (0-based): the same set last
 * time, or — if last time had fewer sets — the last one it had.
 */
export function prevSetAt(
  last: LastTime | undefined,
  index: number,
): PrevSet | undefined {
  const sets = last?.sessions[0]?.sets
  if (!sets?.length) return undefined
  return sets[Math.min(index, sets.length - 1)]
}
