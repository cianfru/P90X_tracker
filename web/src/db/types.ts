/*
 * Core data model. The whole point of the app: typed, append-only facts so we
 * never parse free text again. See /CLAUDE.md → Data model.
 */

export type ExerciseType = 'bodyweight' | 'weighted'

/** Body region an exercise trains — drives the Mixer's upper/lower/total focus. */
export type ExerciseRegion = 'upper' | 'lower' | 'core' | 'total'

/** Finer muscle group — lets the Mixer swap like-for-like (curl→curl, squat→lunge). */
export type Muscle =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'quads'
  | 'hamsglutes'
  | 'calves'
  | 'core'
  | 'total'

/** Typed modifier vocabulary — replaces the reverse-engineered spreadsheet notation. */
export const MODIFIERS = [
  'no_kip',
  'L_sit',
  'wide_X',
  'trx',
  'full_rom',
  'band_travel',
] as const
export type Modifier = (typeof MODIFIERS)[number]

/** Whether a modifier makes the set harder or easier than the standard version. */
export type ModifierEffect = 'harder' | 'easier' | 'neutral'

/**
 * Supplements taken on a training day. The spreadsheet noted these per day as
 * letter-sets — `Cp` (creatine + protein), `C`, `P`, `Cpm`/`C/P/M` adding
 * maca (m), or `Cpa` adding aminos (a). Typed, not text.
 */
export const SUPPLEMENTS = ['creatine', 'protein', 'maca', 'aminos'] as const
export type Supplement = (typeof SUPPLEMENTS)[number]

export interface ModifierMeta {
  /** Short chip label shown in the logger. */
  label: string
  hint: string
  effect: ModifierEffect
  /** Chip accent colour family. */
  tone: 'amber' | 'sky' | 'rose'
}

/**
 * Brief: the first four (no_kip, L_sit, wide_X, trx) are "harder than standard";
 * band_travel is "easier" (elastic-band travel substitute); full_rom is a
 * strict-form note (neutral). Analytics use `effect` to keep variants from
 * masquerading as gains or declines.
 */
export const MODIFIER_META: Record<Modifier, ModifierMeta> = {
  no_kip: { label: 'no-kip', hint: 'strict', effect: 'harder', tone: 'amber' },
  L_sit: {
    label: 'L',
    hint: 'L-sit legs (harder)',
    effect: 'harder',
    tone: 'amber',
  },
  wide_X: {
    label: 'X',
    hint: 'wide legs (harder)',
    effect: 'harder',
    tone: 'amber',
  },
  trx: { label: 'TRX', hint: 'harder', effect: 'harder', tone: 'amber' },
  full_rom: { label: 'full', hint: 'full ROM', effect: 'neutral', tone: 'sky' },
  band_travel: {
    label: 'band',
    hint: 'elastic travel (lighter)',
    effect: 'easier',
    tone: 'sky',
  },
}

export interface Exercise {
  /** Stable slug of canonicalName, e.g. "std-push". */
  id: string
  /** Canonical name — the owner's spreadsheet shorthand; the STABLE key. */
  name: string
  canonicalName: string
  /**
   * Official P90X/P90X2 worksheet name, shown in the UI when present. The
   * shorthand `name` stays the key so 7 years of history keep matching.
   */
  displayName?: string
  type: ExerciseType
  /** Body region trained (drives the Mixer's upper/lower/total swaps). */
  region?: ExerciseRegion
  /** Finer muscle group (Mixer swaps within the same one). */
  muscle?: Muscle
  /** Alternate spellings/typos + official name that map onto this exercise. */
  aliases: string[]
}

/** The training programs the workouts belong to. `Mixer` = auto-generated. */
export type Program = 'P90X' | 'P90X2' | 'P90X3' | 'Body Beast' | 'Mixer'

export interface WorkoutTemplate {
  id: string
  name: string
  /** Which program this workout belongs to (P90X classic vs P90X2). */
  program: Program
  /** Exercise ids in the order they're performed. */
  exerciseIds: string[]
  /**
   * How many times the exercise list is performed as full rounds (default 1).
   * e.g. P90X2 Total Body is the same 12 moves done twice; the logger walks the
   * list `rounds` times so each move gets round 1, 2, … Only set where every
   * exercise repeats equally (uniform rounds); mixed workouts stay 1.
   */
  rounds?: number
  /**
   * Explicit performed order (exercise ids, repeats allowed) for workouts whose
   * rounds AREN'T uniform — e.g. x2 shoulders & arms is 3 rounds of 7 core moves
   * then a custom extra round of 6 others. When set, the logger walks this exact
   * sequence and `rounds` is ignored. Cards still render once per exercise.
   */
  sequence?: string[]
  /**
   * The routine this remix is paced by — a Mixer keeps an existing routine's
   * structure so its video still gives the right tempo. Shown as "like <base>".
   */
  basedOn?: string
  /** Per-exercise pre-fill targets (reps / weight) for a generated Mixer. */
  targets?: Record<string, { reps?: number; weightKg?: number }>
}

export interface Session {
  id: string
  /** YYYY-MM-DD (local calendar day of the workout). */
  date: string
  workoutId: string
  deviceId: string
  /** Client timestamp (ms) when the session row was created. */
  createdAt: number
  /**
   * Where the workout was done — a free-text label as the owner writes it:
   * a city ("Bangkok"), an IATA code ("PNH"), or a place + "casa" (home).
   * Geocoded client-side for the map; the raw label is always preserved.
   */
  location?: string
  /** GPS captured when the workout was started (device geolocation). */
  lat?: number
  lon?: number
  /** Self-assessed form/readiness that day, 1–10 (half-points allowed). */
  form?: number
  /** Free-text notes explaining the day ("caldo", "stanco", "dolore schiena"…). */
  notes?: string
  /** Supplements taken that day (creatine / protein). */
  supplements?: Supplement[]
  /** Soft-delete (started the wrong routine); its sets are soft-deleted too. */
  deleted?: boolean
}

/**
 * Immutable, append-only fact. "Editing" a set = set `deleted: true` on the old
 * row and insert a new one. Never mutate reps/weight in place.
 */
export interface WorkoutSet {
  /** UUID. */
  id: string
  sessionId: string
  exerciseId: string
  reps: number
  /** kg; null for bodyweight moves. */
  weightKg: number | null
  /** 1,2,… within the session for this exercise. */
  round: number
  modifiers: Modifier[]
  /** The old 😓 flag. */
  struggle: boolean
  /** Client timestamp (ms) when the set was logged. */
  loggedAt: number
  deleted: boolean
}
