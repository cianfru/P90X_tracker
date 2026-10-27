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
