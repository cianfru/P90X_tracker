import { db } from './db'
import type { Exercise, Modifier, Session, WorkoutSet } from './types'
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
  const candidates = await db.sessions.where({ workoutId, date }).toArray()
  const existing = candidates.find((s) => !s.deleted)
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

/**
 * Update a session's per-day metadata (location / form / notes / supplements)
 * and enqueue it for sync. Empty string / undefined clears a field.
 */
export async function updateSessionMeta(
  id: string,
  patch: Partial<
    Pick<Session, 'location' | 'form' | 'notes' | 'supplements'>
  >,
): Promise<void> {
  await db.sessions.update(id, patch)
  await enqueue('sessions', id)
}

/** Recently used location labels (most-recent first) for quick re-selection. */
export async function recentLocations(limit = 6): Promise<string[]> {
  const rows = await db.sessions
    .orderBy('createdAt')
    .reverse()
    .filter((s) => !s.deleted && !!s.location)
    .limit(200)
    .toArray()
  const seen: string[] = []
  for (const s of rows) {
    const loc = s.location!.trim()
    if (loc && !seen.includes(loc)) seen.push(loc)
    if (seen.length >= limit) break
  }
  return seen
}

/** Soft-delete a set (append-only: flip the flag, keep the row for sync). */
export async function softDeleteSet(id: string): Promise<void> {
  await db.sets.update(id, { deleted: true })
  await enqueue('sets', id)
}

/**
 * Soft-delete a whole session (started the wrong routine) and all its sets.
 * Rows stay for sync (deleted flags propagate); the UI filters them out.
 */
export async function deleteSession(id: string): Promise<void> {
  const sets = await db.sets.where('sessionId').equals(id).toArray()
  await db.transaction('rw', db.sessions, db.sets, async () => {
    await db.sessions.update(id, { deleted: true })
    for (const s of sets) {
      if (!s.deleted) await db.sets.update(s.id, { deleted: true })
    }
  })
  await enqueue('sessions', id)
  for (const s of sets) await enqueue('sets', s.id)
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
