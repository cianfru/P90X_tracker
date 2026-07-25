import type { Exercise, Session, WorkoutSet } from '../db'
import { effortOf } from '../logger/effort'

/*
 * Workout intensity — "how hard was this session, for me?"
 *
 * Routines aren't comparable in absolute terms (a chest & back carries far more
 * load than an ab ripper), so a session is judged against what's NORMAL for its
 * own routine. But ranking strictly within a routine breaks down exactly when
 * you need it: the first time you do a workout there's nothing to rank against,
 * and with two or three sessions the rank swings between 0 and 100 on noise.
 *
 * So the baseline is blended: a routine's own median once it has history,
 * shrunk toward the median of ALL your sessions when it doesn't. A brand-new
 * routine is therefore scored against your training as a whole, and the
 * baseline slides smoothly onto its own history as you repeat it.
 *
 * The score is then the percentile of that relative load across every session
 * you've logged: 50 means a typical session for you, not "unknown".
 */

/** How strongly a routine with little history is pulled toward your overall
 *  normal, expressed in "virtual sessions". At 3 sessions a routine's own
 *  median already carries half the weight. */
const SHRINK = 3

export interface Intensity {
  workoutId: string
  /** Total session effort (standard-rep equivalents · absolute volume). */
  effort: number
  /** Effort ÷ the expected effort for this routine. 1.0 = a normal session. */
  relative: number
  /** 0–100 percentile of `relative` across every session logged. */
  score: number
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
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

  // What a normal session looks like across ALL training — the reference a
  // routine with no history of its own is measured against.
  const globalMedian = median([...effort.values()]) || 1

  // Each routine's own normal, shrunk toward the global one while its history
  // is thin, so a first-ever session is scored sensibly instead of defaulting.
  const effortsByWorkout = new Map<string, number[]>()
  for (const [id, e] of effort) {
    const w = sessionOf.get(id)!.workoutId
    const arr = effortsByWorkout.get(w) ?? []
    arr.push(e)
    effortsByWorkout.set(w, arr)
  }
  const expected = new Map<string, number>()
  for (const [w, arr] of effortsByWorkout) {
    const n = arr.length
    expected.set(w, (n * median(arr) + SHRINK * globalMedian) / (n + SHRINK))
  }

  // Relative load, then percentile-rank it across every session. Ties share a
  // score, and a lone session lands at 50 by arithmetic rather than by a
  // special case — it genuinely is your median session so far.
  const rows = [...effort].map(([id, e]) => {
    const workoutId = sessionOf.get(id)!.workoutId
    const base = expected.get(workoutId) || globalMedian
    return { id, workoutId, effort: e, relative: e / base }
  })
  const ranked = rows.map((r) => r.relative).sort((a, b) => a - b)
  const total = ranked.length

  const out = new Map<string, Intensity>()
  for (const r of rows) {
    let below = 0
    let equal = 0
    for (const v of ranked) {
      if (v < r.relative) below++
      else if (v === r.relative) equal++
    }
    const score = Math.round((100 * (below + equal / 2)) / total)
    out.set(r.id, {
      workoutId: r.workoutId,
      effort: r.effort,
      relative: r.relative,
      score,
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
