import type { Exercise, Session, WorkoutSet } from '../db'
import { effortOf } from '../logger/effort'

/*
 * Workout intensity — "how heavy was this session?" scored on a PER-WORKOUT
 * scale, because routines aren't comparable in absolute terms (a chest & back
 * carries far more total load than an ab ripper). For each session we sum the
 * effort of its sets (the same standard-rep-equivalent the logger uses), then
 * rank that total against the owner's other sessions of the SAME workout. So a
 * "heavy" chest & back is heavy vs your chest & back history, and each routine
 * keeps its own scale.
 */

export interface Intensity {
  workoutId: string
  /** Total session effort (standard-rep equivalents · absolute volume). */
  effort: number
  /** 0–100 rank of this session's effort within its workout's history. */
  score: number
}

/** effort per session, then a within-workout 0–100 rank score. */
export function computeIntensity(
  sessions: Session[],
  sets: WorkoutSet[],
  exercises: Exercise[],
): Map<string, Intensity> {
  const typeOf = new Map(exercises.map((e) => [e.id, e.type]))
  const liveSessions = sessions.filter((s) => !s.deleted)
  const sessionOf = new Map(liveSessions.map((s) => [s.id, s]))

  // Sum effort per session.
  const effort = new Map<string, number>()
  for (const st of sets) {
    if (st.deleted || !sessionOf.has(st.sessionId)) continue
    const type = typeOf.get(st.exerciseId) ?? 'bodyweight'
    const e = effortOf(st, type)
    effort.set(st.sessionId, (effort.get(st.sessionId) ?? 0) + e)
  }

  // Group session efforts by workout to build each workout's own scale.
  const byWorkout = new Map<string, { id: string; effort: number }[]>()
  for (const [id, e] of effort) {
    const s = sessionOf.get(id)!
    const arr = byWorkout.get(s.workoutId) ?? []
    arr.push({ id, effort: e })
    byWorkout.set(s.workoutId, arr)
  }

  const out = new Map<string, Intensity>()
  for (const [workoutId, rows] of byWorkout) {
    const sorted = [...rows].sort((a, b) => a.effort - b.effort)
    const n = sorted.length
    sorted.forEach((r, i) => {
      // Rank percentile: lowest effort → 0, highest → 100. Single session → 50.
      const score = n > 1 ? Math.round((i / (n - 1)) * 100) : 50
      out.set(r.id, { workoutId, effort: r.effort, score })
    })
  }
  return out
}

// Five intensity bands, low → high. Colours read clearly on the dark UI and as
// map dots; kept distinct from the effort-tone greens used inside the logger.
const BANDS = [
  { max: 20, color: '#38bdf8', label: 'light' }, // sky
  { max: 40, color: '#2dd4bf', label: 'easy' }, // teal
  { max: 60, color: '#a3e635', label: 'moderate' }, // lime
  { max: 80, color: '#fbbf24', label: 'hard' }, // amber
  { max: 101, color: '#fb7185', label: 'max' }, // rose
] as const

export function intensityColor(score: number): string {
  return (BANDS.find((b) => score < b.max) ?? BANDS[BANDS.length - 1]).color
}
export function intensityLabel(score: number): string {
  return (BANDS.find((b) => score < b.max) ?? BANDS[BANDS.length - 1]).label
}
export const INTENSITY_LEGEND = BANDS.map((b) => ({
  color: b.color,
  label: b.label,
}))
