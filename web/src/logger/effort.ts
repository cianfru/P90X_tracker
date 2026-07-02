import { db } from '../db'
import type { ExerciseType, Modifier } from '../db'

/*
 * Effort engine: converts any set into "standard-rep equivalents" so reps,
 * added vest/belt load, and form-complexity modifiers become one comparable
 * number per exercise. Physics frame is mechanical work (W = m·g·h·reps); for
 * one exercise g and h are constant, so:
 *
 *   bodyweight move: effort = reps × (BW + addedKg) / BW × Πk(modifiers)
 *   weighted move:   effort = reps × weightKg × Πk(modifiers)   (volume)
 *
 * The k multipliers are CALIBRATED FROM THE OWNER'S OWN 7-YEAR HISTORY
 * (median standard reps ÷ median modifier reps across the pull family):
 * L_sit 1.45, no_kip 1.13. Sparse modifiers get conservative defaults.
 * Efforts are computed, never stored — the log stays pure facts.
 */

export const EFFORT_K: Record<Modifier, number> = {
  no_kip: 1.13, // calibrated
  L_sit: 1.45, // calibrated
  wide_X: 1.15, // default (few samples)
  trx: 1.15, // default
  full_rom: 1.0, // form note, neutral
  band_travel: 0.7, // elastic assist, easier
}

const BW_KEY = 'p90x-bodyweight-kg'
export function getBodyweight(): number {
  const v = Number(localStorage.getItem(BW_KEY))
  return Number.isFinite(v) && v > 30 ? v : 80
}
export function setBodyweight(kg: number): void {
  localStorage.setItem(BW_KEY, String(kg))
}

const HARDER: Modifier[] = ['L_sit', 'wide_X', 'no_kip', 'trx']
const LIGHTER: Modifier[] = ['band_travel']
const isStandard = (mods: Modifier[]) =>
  !mods.some((m) => HARDER.includes(m) || LIGHTER.includes(m))

export interface SetLike {
  reps: number
  weightKg: number | null
  modifiers: Modifier[]
}

/** Equivalent effort of one set (see module comment). */
export function effortOf(s: SetLike, type: ExerciseType): number {
  const k = s.modifiers.reduce((a, m) => a * (EFFORT_K[m] ?? 1), 1)
  if (type === 'weighted') return s.reps * (s.weightKg ?? 0) * k || s.reps * k
  const bw = getBodyweight()
  const load = (bw + (s.weightKg ?? 0)) / bw
  return s.reps * load * k
}

export type EffortTone = 'ok' | 'push' | 'record' | 'none'

/** green ≤ recent avg · amber above avg · red at/over the all-time max. */
export function effortTone(
  effort: number,
  stats: Pick<ExerciseStats, 'avgEffort' | 'maxEffort'>,
): EffortTone {
  if (stats.avgEffort == null) return 'none'
  if (stats.maxEffort != null && effort >= stats.maxEffort - 1e-9) return 'record'
  if (effort > stats.avgEffort + 0.5) return 'push'
  return 'ok'
}

export interface HistEntry {
  date: string
  reps: number
  weightKg: number | null
  modifiers: Modifier[]
}

export interface ExerciseStats {
  /** Best set of each of the last 4 sessions, newest first. */
  history: HistEntry[]
  prev?: HistEntry
  /** Prefill target: recent standard-baseline average. */
  targetReps?: number
  targetWeightKg?: number
  /** Raw standard best-per-session extremes (display chips). */
  maxRaw?: number
  minRaw?: number
  /** Thresholds for live color coding (equivalent-effort units). */
  avgEffort?: number
  maxEffort?: number
}

const RECENT = 10 // sessions that define "current you" for target + avg effort

/** History-derived stats for one exercise (live-query friendly). */
export async function exerciseStats(
  exerciseId: string,
  type: ExerciseType,
): Promise<ExerciseStats> {
  const sets = (
    await db.sets.where('exerciseId').equals(exerciseId).toArray()
  ).filter((s) => !s.deleted)
  if (!sets.length) return { history: [] }

  const sessionIds = [...new Set(sets.map((s) => s.sessionId))]
  const sessions = await db.sessions.bulkGet(sessionIds)
  const dateOf = new Map<string, string>()
  for (const s of sessions) {
    if (s && !s.deleted) dateOf.set(s.id, s.date)
  }

  // Best (highest-effort) set per session, plus best standard raw value.
  const bySession = new Map<
    string,
    { best: HistEntry & { effort: number }; std?: number }
  >()
  for (const s of sets) {
    const date = dateOf.get(s.sessionId)
    if (!date) continue
    const eff = effortOf(s, type)
    const raw = type === 'weighted' ? (s.weightKg ?? 0) : s.reps
    const cur = bySession.get(s.sessionId)
    const entry = {
      date,
      reps: s.reps,
      weightKg: s.weightKg,
      modifiers: s.modifiers,
      effort: eff,
    }
    const std =
      isStandard(s.modifiers) && !(type === 'bodyweight' && s.weightKg)
        ? raw
        : undefined
    if (!cur) {
      bySession.set(s.sessionId, { best: entry, std })
    } else {
      if (eff > cur.best.effort) cur.best = entry
      if (std !== undefined && (cur.std === undefined || std > cur.std))
        cur.std = std
    }
  }

  const rows = [...bySession.values()].sort((a, b) =>
    a.best.date < b.best.date ? 1 : -1,
  )
  const history = rows.slice(0, 4).map((r) => r.best)
  const stdVals = rows.map((r) => r.std).filter((v): v is number => v !== undefined)
  const recentStd = rows
    .slice(0, RECENT)
    .map((r) => r.std)
    .filter((v): v is number => v !== undefined)
  const recentEff = rows.slice(0, RECENT).map((r) => r.best.effort)
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

  const stats: ExerciseStats = {
    history,
    prev: history[0],
    maxRaw: stdVals.length ? Math.max(...stdVals) : undefined,
    minRaw: stdVals.length ? Math.min(...stdVals) : undefined,
    avgEffort: recentEff.length ? mean(recentEff) : undefined,
    maxEffort: rows.length
      ? Math.max(...rows.map((r) => r.best.effort))
      : undefined,
  }
  if (type === 'weighted') {
    stats.targetWeightKg = recentStd.length
      ? Math.round(mean(recentStd))
      : undefined
    stats.targetReps = history[0]?.reps
  } else {
    stats.targetReps = recentStd.length
      ? Math.round(mean(recentStd))
      : history[0]?.reps
  }
  return stats
}
