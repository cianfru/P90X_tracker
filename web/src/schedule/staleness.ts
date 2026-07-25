import type { Rotation, Session, WorkoutTemplate } from '../db'

/*
 * Rotation staleness — "have I been running this one too long?"
 *
 * The owner advances down a slot's preference list when the current workout
 * starts to feel run-out. That's a judgement they've been making by feel for 15
 * years; this reads the logged history and makes it visible.
 *
 * The threshold is LEARNED, not fixed. Everyone's switching rhythm differs, and
 * it differs per slot: measured over the owner's history, the push/pull split
 * changes every ~2 sessions (90th percentile 5), while the legs slot has run
 * the same workout 184 times. A single global "stale after N" would either nag
 * constantly on one slot or never fire on the other. So each slot is compared
 * against ITS OWN past behaviour — the 90th percentile of its previous runs —
 * with a floor so a slot that has only ever had one workout still reports.
 */

/** A group of days tracked as one unit. Days 1 and 3 share a unit because the
 *  push/pull pair is chosen together, so it's the PAIR that goes stale. */
export interface RotationUnit {
  key: string
  label: string
  days: number[]
  /** Candidate options, most → least favourite; each is one or more workouts. */
  options: string[][]
  /** False for an ANCHOR slot the owner is content to stay on — reported, but
   *  never flagged stale. A settled preference isn't a rut. */
  rotate: boolean
}

export interface SlotStatus extends RotationUnit {
  /** Index into `options` currently in use; null when never logged. */
  currentIndex: number | null
  /** Consecutive sessions on the current option. */
  run: number
  /** Date the current run started (YYYY-MM-DD). */
  since: string | null
  /** Total logged sessions for this unit. */
  sessions: number
  /** This slot's usual run length (p90 of past runs); null if never switched. */
  typical: number | null
  /** Run length at which this slot is considered stale. */
  threshold: number
  stale: boolean
  /** The option to advance to, or null at the end of the list. */
  nextIndex: number | null
}

/** Floor for the learned threshold — below this we'd nag on normal variation. */
const MIN_THRESHOLD = 4
/** Used when a slot has never switched, so has no rhythm to learn from. */
const DEFAULT_THRESHOLD = 6

const percentile = (sorted: number[], p: number): number =>
  sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
    : 0

/** Split the rotation into the units that can independently go stale. Days 1+3
 *  merge into one pair unit; flex and recovery days are excluded — day 6 is
 *  meant to vary and day 7 isn't a workout choice. */
export function rotationUnits(rotation: Rotation): RotationUnit[] {
  const units: RotationUnit[] = [
    {
      key: 'pair',
      label: 'Push / pull split',
      days: [1, 3],
      options: rotation.pairs.map((p) => [p.push, p.pull]),
      rotate: true,
    },
  ]
  for (const s of rotation.slots) {
    if (s.fromPair || s.flex || s.recovery || !s.options?.length) continue
    units.push({
      key: `day${s.day}`,
      label: s.label,
      days: [s.day],
      options: s.options,
      rotate: s.rotate !== false,
    })
  }
  return units
}

/**
 * Per-unit staleness from logged sessions. Sessions are matched to a unit by
 * whether their workout appears in any of its options, so a workout used in two
 * slots contributes to both — which is correct: doing it at all is what makes
 * it familiar.
 */
export function computeStaleness(
  rotation: Rotation,
  sessions: Session[],
): SlotStatus[] {
  const live = sessions
    .filter((s) => !s.deleted)
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  return rotationUnits(rotation).map((unit) => {
    const indexOf = (workoutId: string) =>
      unit.options.findIndex((o) => o.includes(workoutId))
    const seq = live
      .map((s) => ({ date: s.date, i: indexOf(s.workoutId) }))
      .filter((x) => x.i >= 0)

    if (!seq.length) {
      return {
        ...unit,
        currentIndex: null,
        run: 0,
        since: null,
        sessions: 0,
        typical: null,
        threshold: DEFAULT_THRESHOLD,
        stale: false,
        nextIndex: unit.options.length > 1 ? 1 : null,
      }
    }

    // Collapse into consecutive runs on the same option.
    const runs: { i: number; n: number; start: string }[] = []
    let cur = seq[0].i
    let n = 1
    let start = seq[0].date
    for (let k = 1; k < seq.length; k++) {
      if (seq[k].i === cur) n++
      else {
        runs.push({ i: cur, n, start })
        cur = seq[k].i
        n = 1
        start = seq[k].date
      }
    }
    runs.push({ i: cur, n, start })

    const current = runs[runs.length - 1]
    // Learn from COMPLETED runs only — the ongoing one is what we're judging.
    const past = runs
      .slice(0, -1)
      .map((r) => r.n)
      .sort((a, b) => a - b)
    const typical = past.length ? percentile(past, 0.9) : null
    const threshold = Math.max(MIN_THRESHOLD, typical ?? DEFAULT_THRESHOLD)

    return {
      ...unit,
      currentIndex: current.i,
      run: current.n,
      since: current.start,
      sessions: seq.length,
      typical,
      threshold,
      stale: unit.rotate && current.n > threshold,
      nextIndex: !unit.rotate
        ? null
        : current.i + 1 < unit.options.length
          ? current.i + 1
          : unit.options.length > 1
            ? 0 // wrapped: back to the favourite
            : null,
    }
  })
}

/** Human-readable workout names for an option. */
export function optionNames(ids: string[], templates: WorkoutTemplate[]): string {
  const byId = new Map(templates.map((t) => [t.id, t.name]))
  return ids.map((id) => byId.get(id) ?? id).join(' + ')
}
