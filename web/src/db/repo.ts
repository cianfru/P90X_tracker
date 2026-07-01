import { db } from './db'
import type { Exercise, Modifier, WorkoutSet } from './types'
import { getDeviceId, todayISO, uid } from '../lib/id'

/*
 * Repository: the only place that writes to Dexie. Every write is local-first
 * and append-only — logging inserts an immutable set; "removing" a set flips its
 * `deleted` flag (never erases the fact). Reads used reactively by the UI go
 * through useLiveQuery against `db` directly.
 *
 * Every write also enqueues the touched row into the sync outbox so it can be
 * pushed to the backend when online (see sync/syncClient).
 */

async function enqueue(table: 'sessions' | 'sets', rowId: string): Promise<void> {
  await db.outbox.put({ key: `${table}:${rowId}`, table, rowId })
}

/** Non-deleted sets for one exercise within a session, in log order. */
export async function sessionExerciseSets(
  sessionId: string,
  exerciseId: string,
): Promise<WorkoutSet[]> {
  const rows = await db.sets
    .where('[sessionId+exerciseId]')
    .equals([sessionId, exerciseId])
    .toArray()
  return rows.filter((s) => !s.deleted).sort((a, b) => a.loggedAt - b.loggedAt)
}

/** Create today's session for a workout, or return the existing one. */
export async function startOrResumeSession(workoutId: string): Promise<string> {
  const date = todayISO()
  const existing = await db.sessions.where({ workoutId, date }).first()
  if (existing) return existing.id
  const id = uid()
  await db.sessions.add({
    id,
    date,
    workoutId,
    deviceId: getDeviceId(),
    createdAt: Date.now(),
  })
  await enqueue('sessions', id)
  return id
}

/** Append a logged set; round auto-increments per exercise within the session. */
export async function logSet(input: {
  sessionId: string
  exerciseId: string
  reps: number
  weightKg: number | null
  modifiers: Modifier[]
  struggle: boolean
}): Promise<void> {
  const existing = await sessionExerciseSets(input.sessionId, input.exerciseId)
  const set: WorkoutSet = {
    id: uid(),
    sessionId: input.sessionId,
    exerciseId: input.exerciseId,
    reps: input.reps,
    weightKg: input.weightKg,
    round: existing.length + 1,
    modifiers: input.modifiers,
    struggle: input.struggle,
    loggedAt: Date.now(),
    deleted: false,
  }
  await db.sets.add(set)
  await enqueue('sets', set.id)
}

/** Soft-delete a set (append-only: flip the flag, keep the row for sync). */
export async function softDeleteSet(id: string): Promise<void> {
  await db.sets.update(id, { deleted: true })
  await enqueue('sets', id)
}

/**
 * Last reps/weight logged for an exercise (across all sessions) to pre-fill the
 * next set as a target. Returns null if never logged. After the history import
 * this pulls from 7 years of data.
 */
export async function lastSetFor(
  exerciseId: string,
): Promise<{ reps: number; weightKg: number | null } | null> {
  const rows = await db.sets.where('exerciseId').equals(exerciseId).toArray()
  const live = rows
    .filter((s) => !s.deleted)
    .sort((a, b) => b.loggedAt - a.loggedAt)
  if (!live.length) return null
  return { reps: live[0].reps, weightKg: live[0].weightKg }
}

/** Fetch exercises for a template, preserving the performed order. */
export async function templateExercises(
  exerciseIds: string[],
): Promise<Exercise[]> {
  const rows = await db.exercises.bulkGet(exerciseIds)
  return rows.filter((e): e is Exercise => Boolean(e))
}
