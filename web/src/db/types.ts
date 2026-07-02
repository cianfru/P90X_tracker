/*
 * Core data model. The whole point of the app: typed, append-only facts so we
 * never parse free text again. See /CLAUDE.md → Data model.
 */

export type ExerciseType = 'bodyweight' | 'weighted'

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
  /** Alternate spellings/typos + official name that map onto this exercise. */
  aliases: string[]
}

/** The training programs the workouts belong to. */
export type Program = 'P90X' | 'P90X2' | 'P90X3' | 'Body Beast'

export interface WorkoutTemplate {
  id: string
  name: string
  /** Which program this workout belongs to (P90X classic vs P90X2). */
  program: Program
  /** Exercise ids in the order they're performed. */
  exerciseIds: string[]
}

export interface Session {
  id: string
  /** YYYY-MM-DD (local calendar day of the workout). */
  date: string
  workoutId: string
  deviceId: string
  /** Client timestamp (ms) when the session row was created. */
  createdAt: number
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
