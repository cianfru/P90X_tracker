import type { Exercise, Modifier, Session, WorkoutSet } from '../db'

/*
 * Client-side analytics over Dexie data, following the brief's definitions:
 * - progression = best reps / top weight PER SESSION, with a running-max PR line
 * - "standard" baseline EXCLUDES harder (L_sit/wide_X) and lighter (band_travel)
 *   modifiers so variants don't masquerade as gains or declines
 * - harder-variant share = fraction of pull sets done as L_sit/wide_X, per year
 *
 * Validated after data cleanup (meta rows + typo values removed): 791 sessions,
 * 18,088 exercise sets, bodyweight reps 204,365, tonnage 2,223,734 kg,
 * struggle/year [51,47,62,27,35,39,29,12], 2026 harder-share ~82%.
 */

const HARDER: Modifier[] = ['L_sit', 'wide_X']
const LIGHTER: Modifier[] = ['band_travel']

const hasAny = (mods: Modifier[], set: Modifier[]) =>
  mods.some((m) => set.includes(m))
const isHarder = (s: WorkoutSet) => hasAny(s.modifiers, HARDER)
const isStandard = (s: WorkoutSet) =>
  !hasAny(s.modifiers, HARDER) && !hasAny(s.modifiers, LIGHTER)

const year = (d: string) => Number(d.slice(0, 4))
const month = (d: string) => d.slice(0, 7)
const median = (xs: number[]): number => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface Bar {
  label: string
  value: number
}
export interface ProgressionPoint {
  date: string
  value: number
  pr: number
}
export interface Mover {
  id: string
  name: string
  first: number
  last: number
  pct: number
  metric: 'reps' | 'weight'
}
export interface Analytics {
  kpis: {
    sessions: number
    bodyweightReps: number
    tonnageKg: number
    exercises: number
    firstDate: string
    lastDate: string
  }
  sessionsPerMonth: Bar[]
  tonnagePerMonth: Bar[]
  strugglePerYear: Bar[]
  harderSharePerYear: Bar[]
  routines: { id: string; name: string; sessions: number }[]
  topMovers: Mover[]
}

/** Best value per session for one exercise, chronological, with a running PR. */
export function progressionFor(
  sets: WorkoutSet[],
  sessions: Session[],
  exerciseId: string,
  type: 'bodyweight' | 'weighted',
): ProgressionPoint[] {
  const dateOf = new Map(sessions.map((s) => [s.id, s.date]))
  const best = new Map<string, number>()
  for (const s of sets) {
    if (s.deleted || s.exerciseId !== exerciseId) continue
    const v = type === 'weighted' ? (s.weightKg ?? 0) : s.reps
    const cur = best.get(s.sessionId)
    if (cur === undefined || v > cur) best.set(s.sessionId, v)
  }
  const rows = [...best.entries()]
    .map(([sid, value]) => ({ date: dateOf.get(sid) ?? '', value }))
    .filter((r) => r.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
  let pr = -Infinity
  return rows.map((r) => {
    pr = Math.max(pr, r.value)
    return { date: r.date, value: r.value, pr }
  })
}

function monthRange(first: string, last: string): string[] {
  const out: string[] = []
  let [y, m] = [year(first), Number(first.slice(5, 7))]
  const [ly, lm] = [year(last), Number(last.slice(5, 7))]
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    if (++m > 12) {
      m = 1
      y++
    }
  }
  return out
}

export function computeAnalytics(
  allSessions: Session[],
  sets: WorkoutSet[],
  exercises: Exercise[],
): Analytics {
  const sessions = allSessions.filter((s) => !s.deleted)
  const live = sets.filter((s) => !s.deleted)
  const dateOf = new Map(sessions.map((s) => [s.id, s.date]))
  const exById = new Map(exercises.map((e) => [e.id, e]))
  const nameOf = (id: string) => {
    const e = exById.get(id)
    return e?.displayName ?? e?.name ?? id
  }

  let bodyweightReps = 0
  let tonnageKg = 0
  for (const s of live) {
    if (s.weightKg == null) bodyweightReps += s.reps
    else tonnageKg += s.reps * s.weightKg
  }

  const dates = sessions.map((s) => s.date).sort()
  const firstDate = dates[0] ?? ''
  const lastDate = dates[dates.length - 1] ?? ''
  const months = firstDate ? monthRange(firstDate, lastDate) : []
  const years = firstDate
    ? Array.from(
        { length: year(lastDate) - year(firstDate) + 1 },
        (_, i) => year(firstDate) + i,
      )
    : []

  // Consistency: sessions per month (zero-filled).
  const sessCountByMonth = new Map<string, number>()
  for (const s of sessions)
    sessCountByMonth.set(
      month(s.date),
      (sessCountByMonth.get(month(s.date)) ?? 0) + 1,
    )
  const sessionsPerMonth = months.map((mo) => ({
    label: mo,
    value: sessCountByMonth.get(mo) ?? 0,
  }))

  // Tonnage: Σ reps×kg per month.
  const tonByMonth = new Map<string, number>()
  for (const s of live) {
    if (s.weightKg == null) continue
    const mo = month(dateOf.get(s.sessionId) ?? '')
    if (mo) tonByMonth.set(mo, (tonByMonth.get(mo) ?? 0) + s.reps * s.weightKg)
  }
  const tonnagePerMonth = months.map((mo) => ({
    label: mo,
    value: Math.round(tonByMonth.get(mo) ?? 0),
  }))

  // Struggle count per year.
  const strugByYear = new Map<number, number>()
  for (const s of live) {
    if (!s.struggle) continue
    const y = year(dateOf.get(s.sessionId) ?? '0000')
    strugByYear.set(y, (strugByYear.get(y) ?? 0) + 1)
  }
  const strugglePerYear = years.map((y) => ({
    label: String(y),
    value: strugByYear.get(y) ?? 0,
  }))

  // Harder-variant share per year over bodyweight pull-family moves (those that
  // ever carry a harder modifier).
  const pullIds = new Set<string>()
  for (const s of live) {
    if (isHarder(s) && exById.get(s.exerciseId)?.type === 'bodyweight')
      pullIds.add(s.exerciseId)
  }
  const totBy = new Map<number, number>()
  const harBy = new Map<number, number>()
  for (const s of live) {
    if (!pullIds.has(s.exerciseId)) continue
    const y = year(dateOf.get(s.sessionId) ?? '0000')
    totBy.set(y, (totBy.get(y) ?? 0) + 1)
    if (isHarder(s)) harBy.set(y, (harBy.get(y) ?? 0) + 1)
  }
  const harderSharePerYear = years.map((y) => {
    const t = totBy.get(y) ?? 0
    return {
      label: String(y),
      value: t ? Math.round((100 * (harBy.get(y) ?? 0)) / t) : 0,
    }
  })

  // Routines: session count per workout.
  const byWorkout = new Map<string, number>()
  for (const s of sessions)
    byWorkout.set(s.workoutId, (byWorkout.get(s.workoutId) ?? 0) + 1)
  const routines = [...byWorkout.entries()]
    .map(([id, count]) => ({ id, name: id, sessions: count }))
    .sort((a, b) => b.sessions - a.sessions)

  // Most-improved: first vs latest year median of best-per-session on CLEAN
  // standard entries. Bodyweight → reps, weighted → top weight.
  const perExYear = new Map<string, Map<number, Map<string, number>>>() // ex -> year -> session -> best
  for (const s of live) {
    if (!isStandard(s)) continue
    const ex = exById.get(s.exerciseId)
    if (!ex) continue
    const v = ex.type === 'weighted' ? (s.weightKg ?? 0) : s.reps
    if (ex.type === 'weighted' && s.weightKg == null) continue
    const y = year(dateOf.get(s.sessionId) ?? '0000')
    const em = perExYear.get(s.exerciseId) ?? new Map()
    const ym = em.get(y) ?? new Map<string, number>()
    ym.set(s.sessionId, Math.max(ym.get(s.sessionId) ?? -Infinity, v))
    em.set(y, ym)
    perExYear.set(s.exerciseId, em)
  }
  const topMovers: Mover[] = []
  for (const [id, em] of perExYear) {
    const ys = [...em.keys()].sort((a, b) => a - b)
    if (ys.length < 3) continue // need a real multi-year trend
    const fy = em.get(ys[0])!
    const ly = em.get(ys[ys.length - 1])!
    if (fy.size < 2 || ly.size < 2) continue // enough sessions at each end
    const first = median([...fy.values()])
    const last = median([...ly.values()])
    if (first < 1) continue // skip sub-1 baselines (noise / bad rows)
    const ex = exById.get(id)!
    topMovers.push({
      id,
      name: nameOf(id),
      first,
      last,
      pct: Math.round(((last - first) / first) * 1000) / 10,
      metric: ex.type === 'weighted' ? 'weight' : 'reps',
    })
  }
  topMovers.sort((a, b) => b.pct - a.pct)

  return {
    kpis: {
      sessions: sessions.length,
      bodyweightReps,
      tonnageKg: Math.round(tonnageKg),
      exercises: new Set(live.map((s) => s.exerciseId)).size,
      firstDate,
      lastDate,
    },
    sessionsPerMonth,
    tonnagePerMonth,
    strugglePerYear,
    harderSharePerYear,
    routines,
    topMovers,
  }
}
