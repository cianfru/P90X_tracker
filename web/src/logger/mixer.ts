import type {
  Exercise,
  ExerciseRegion,
  Session,
  WorkoutSet,
  WorkoutTemplate,
} from '../db'

/*
 * The Mixer — auto-generates a workout by REMIXING one of your existing
 * routines. It keeps that routine's exact structure (same number of moves and
 * rounds) so the routine's video still gives the right pace, but swaps each
 * slot for a DIFFERENT move of the same body part you haven't done recently —
 * variety without losing the tempo. Targets come from YOUR history scaled by
 * the chosen intensity (hard ≈ your recent best, so it stays challenging).
 */

export type Focus = 'upper' | 'lower' | 'total'
export type Intensity = 'light' | 'medium' | 'hard'

interface ExStat {
  avg: number // recent average of the standard metric (reps or kg)
  max: number // best ever
  last: string // last date done (YYYY-MM-DD), '' if never
}

/** Per-exercise recent average / all-time best / last-done, from the log. */
export function exerciseStatsMap(
  sets: WorkoutSet[],
  sessions: Session[],
  exById: Map<string, Exercise>,
): Map<string, ExStat> {
  const dateOf = new Map<string, string>()
  for (const s of sessions) if (!s.deleted) dateOf.set(s.id, s.date)

  // exId -> sessionId -> best metric value that session
  const perEx = new Map<string, Map<string, number>>()
  for (const st of sets) {
    if (st.deleted) continue
    const date = dateOf.get(st.sessionId)
    if (!date) continue
    const ex = exById.get(st.exerciseId)
    if (!ex) continue
    const value = ex.type === 'weighted' ? (st.weightKg ?? 0) : st.reps
    let bySess = perEx.get(st.exerciseId)
    if (!bySess) perEx.set(st.exerciseId, (bySess = new Map()))
    bySess.set(st.sessionId, Math.max(bySess.get(st.sessionId) ?? 0, value))
  }

  const out = new Map<string, ExStat>()
  for (const [exId, bySess] of perEx) {
    const rows = [...bySess.entries()]
      .map(([sid, v]) => ({ date: dateOf.get(sid)!, v }))
      .sort((a, b) => (a.date < b.date ? 1 : -1)) // newest first
    const recent = rows.slice(0, 10).map((r) => r.v)
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length
    out.set(exId, {
      avg: Math.round(avg),
      max: Math.max(...rows.map((r) => r.v)),
      last: rows[0]?.date ?? '',
    })
  }
  return out
}

const INTENSITY_FACTOR: Record<Intensity, number> = {
  light: 0.85,
  medium: 1,
  hard: 1.15, // pushes toward / past your recent best
}

/** Target reps or weight for a move at an intensity, from its own history. */
function targetFor(stat: ExStat, intensity: Intensity): number {
  if (intensity === 'hard') return Math.max(stat.max, Math.round(stat.avg * 1.15))
  return Math.max(1, Math.round(stat.avg * INTENSITY_FACTOR[intensity]))
}

function regionOf(ex: Exercise): ExerciseRegion {
  return ex.region ?? 'upper'
}
function muscleOf(ex: Exercise): string {
  return ex.muscle ?? regionOf(ex)
}

/** Dominant body region of a template, for matching it to a focus. */
function templateRegions(t: WorkoutTemplate, exById: Map<string, Exercise>) {
  const counts: Record<ExerciseRegion, number> = {
    upper: 0,
    lower: 0,
    core: 0,
    total: 0,
  }
  for (const id of t.exerciseIds) {
    const ex = exById.get(id)
    if (ex) counts[regionOf(ex)]++
  }
  const total = t.exerciseIds.length || 1
  return { counts, upperFrac: counts.upper / total, lowerFrac: counts.lower / total }
}

/** Base routines that suit a focus (so their video paces the remix). */
export function baseCandidates(
  templates: WorkoutTemplate[],
  exById: Map<string, Exercise>,
  focus: Focus,
): WorkoutTemplate[] {
  const real = templates.filter((t) => t.program !== 'Mixer' && t.exerciseIds.length >= 5)
  const scored = real.map((t) => ({ t, r: templateRegions(t, exById) }))
  let picks: typeof scored
  if (focus === 'upper') picks = scored.filter((s) => s.r.upperFrac >= 0.5)
  else if (focus === 'lower') picks = scored.filter((s) => s.r.lowerFrac >= 0.4)
  else
    picks = scored.filter(
      (s) => s.r.upperFrac < 0.7 && s.r.upperFrac > 0.15 && s.r.lowerFrac > 0.1,
    )
  return (picks.length ? picks : scored).map((s) => s.t)
}

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

export interface MixResult {
  template: WorkoutTemplate
  baseName: string
  moves: {
    id: string
    name: string
    region: ExerciseRegion
    muscle: string
    target: number
    unit: string
  }[]
}

/**
 * Build a remix from a base routine: swap each slot for a fresh same-region,
 * same-type move (favouring ones you've not done lately), keep the structure,
 * and pre-fill targets from your history at the chosen intensity.
 */
export function generateMix(
  base: WorkoutTemplate,
  intensity: Intensity,
  exById: Map<string, Exercise>,
  logged: Exercise[],
  stats: Map<string, ExStat>,
  now: number,
): MixResult {
  // Candidate pools keyed by muscle:type (primary) and region:type (fallback),
  // each sorted least-recently-done so swaps favour fresh moves.
  const musclePools = new Map<string, Exercise[]>()
  const regionPools = new Map<string, Exercise[]>()
  for (const ex of logged) {
    const mk = `${muscleOf(ex)}:${ex.type}`
    const rk = `${regionOf(ex)}:${ex.type}`
    ;(musclePools.get(mk) ?? musclePools.set(mk, []).get(mk)!).push(ex)
    ;(regionPools.get(rk) ?? regionPools.set(rk, []).get(rk)!).push(ex)
  }
  const byOldest = (a: Exercise, b: Exercise) => {
    const la = stats.get(a.id)?.last ?? ''
    const lb = stats.get(b.id)?.last ?? ''
    return la < lb ? -1 : la > lb ? 1 : 0
  }
  for (const arr of musclePools.values()) arr.sort(byOldest)
  for (const arr of regionPools.values()) arr.sort(byOldest)

  const used = new Set<string>()
  const swap = new Map<string, string>() // original id -> chosen id
  const distinct = base.exerciseIds

  const avail = (arr: Exercise[], origId: string) =>
    arr.filter((e) => e.id !== origId && !used.has(e.id))

  for (const origId of distinct) {
    const orig = exById.get(origId)
    if (!orig) {
      swap.set(origId, origId)
      continue
    }
    // Same muscle group first (curl→curl), then same region, else keep.
    let pool = avail(musclePools.get(`${muscleOf(orig)}:${orig.type}`) ?? [], origId)
    if (!pool.length)
      pool = avail(regionPools.get(`${regionOf(orig)}:${orig.type}`) ?? [], origId)
    let choice: Exercise | undefined
    if (pool.length) {
      const head = pool.slice(0, Math.max(3, Math.ceil(pool.length / 3)))
      choice = pick(head)
    }
    const chosen = choice?.id ?? origId
    used.add(chosen)
    swap.set(origId, chosen)
  }

  const map = (id: string) => swap.get(id) ?? id
  const exerciseIds = distinct.map(map)
  const sequence = base.sequence?.map(map)

  const targets: Record<string, { reps?: number; weightKg?: number }> = {}
  const moves: MixResult['moves'] = []
  for (const id of exerciseIds) {
    const ex = exById.get(id)
    if (!ex) continue
    const st = stats.get(id)
    const target = st ? targetFor(st, intensity) : ex.type === 'weighted' ? 20 : 15
    if (ex.type === 'weighted') targets[id] = { weightKg: target }
    else targets[id] = { reps: target }
    moves.push({
      id,
      name: ex.displayName ?? ex.name,
      region: regionOf(ex),
      muscle: muscleOf(ex),
      target,
      unit: ex.type === 'weighted' ? 'kg' : 'reps',
    })
  }

  const template: WorkoutTemplate = {
    id: `mix-${now}`,
    name: `Remix · ${base.name}`,
    program: 'Mixer',
    exerciseIds,
    rounds: base.rounds,
    sequence,
    basedOn: base.name,
    targets,
  }
  return { template, baseName: base.name, moves }
}
