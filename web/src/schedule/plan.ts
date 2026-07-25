import type { Rotation, RosterDay, Session, TrainingWindow } from '../db'
import { computeStaleness } from './staleness'

/*
 * The schedule.
 *
 * Nothing is stored. The plan is DERIVED from what's actually been logged:
 * consecutive calendar days are handed to consecutive slots of the cycle,
 * starting from the first slot not yet done. That single rule gives the owner's
 * "everything moves forward by one day" behaviour for free — miss a day and the
 * queue simply hasn't advanced, so by Sunday you're on day 6 (the flex slot)
 * instead of day 7, and the rest day is what gets squeezed out. Miss two and
 * both absorbers become real workouts.
 *
 * Because it's derived, there is no plan to repair when life happens. Fly,
 * skip, double up — the next render just reflects where you actually are.
 */

export type SlotKind = 'work' | 'flex' | 'recovery'

export interface PlannedDay {
  /** YYYY-MM-DD */
  date: string
  /** Position in the 7-day cycle. */
  slotDay: number
  label: string
  kind: SlotKind
  /** Workouts to do — more than one when short routines are doubled up. */
  workoutIds: string[]
  /** Already logged on that date. */
  done: boolean
  /** True for the first not-yet-done day — "what's next". */
  next: boolean
  /** Roster context for that date, when a roster has been imported. */
  roster?: RosterAdvice
}

/**
 * What the roster says about a planned day. ADVISORY by design: the rotation
 * still owns the plan and nothing is silently moved. Fifteen years of training
 * around a flying schedule beats any model at knowing what's actually doable,
 * so this surfaces the conflict and the alternative, then gets out of the way.
 */
export interface RosterAdvice {
  /** 0–100 training capacity for the day. */
  readiness: number
  window: TrainingWindow
  /** Short reason ("14h duty · 3 sectors"). */
  note: string
  duty: boolean
  /**
   * Set when the slot's current pick looks too much for the day. Names what to
   * do instead — a lighter option from the same slot, or moving the day on.
   */
  clash?: 'heavy-day' | 'no-window' | 'tired'
  suggestion?: string
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Which cycle day does this workout belong to? -1 when it's outside the
 *  rotation entirely (e.g. a Body Beast block, which replaces the cycle). */
function slotDayOf(rotation: Rotation, workoutId: string): number {
  for (const p of rotation.pairs) {
    if (p.push === workoutId) return 1
    if (p.pull === workoutId) return 3
  }
  for (const s of rotation.slots) {
    if (s.options?.some((o) => o.includes(workoutId))) return s.day
  }
  return -1
}

/**
 * Resolve each slot to the workouts currently in favour: the pair slots follow
 * whichever pair is in use, the rest follow their own current option. Falls
 * back to the top preference where there's no history to go on.
 */
function currentChoices(
  rotation: Rotation,
  sessions: Session[],
): Map<number, string[]> {
  const status = computeStaleness(rotation, sessions)
  const byKey = new Map(status.map((u) => [u.key, u]))
  const out = new Map<number, string[]>()

  const pair =
    rotation.pairs[byKey.get('pair')?.currentIndex ?? 0] ?? rotation.pairs[0]
  for (const s of rotation.slots) {
    if (s.fromPair) {
      out.set(s.day, [s.fromPair === 'push' ? pair.push : pair.pull])
      continue
    }
    if (!s.options?.length) {
      out.set(s.day, [])
      continue
    }
    const idx = byKey.get(`day${s.day}`)?.currentIndex ?? 0
    out.set(s.day, s.options[idx] ?? s.options[0])
  }
  return out
}

/**
 * The next `count` days from `from`, each carrying the slot that falls due.
 * Days already logged are marked done, so the view can show the week so far
 * alongside what's coming.
 */
/** Readiness at or above this can carry any slot in the rotation. */
const GOOD_DAY = 65
/** Below this the day is a write-off for anything heavy. */
const WRECKED = 45

/**
 * Roster advice for one planned day.
 *
 * Recovery slots are never flagged — a rest day on a brutal duty day is the
 * system working, not a conflict.
 */
function adviseDay(
  r: RosterDay,
  kind: SlotKind,
  workoutIds: string[],
  betterDay: string | null,
): RosterAdvice {
  const base: RosterAdvice = {
    readiness: r.readiness,
    window: r.window,
    note: r.note,
    duty: r.duty,
  }
  if (kind === 'recovery' || !workoutIds.length) return base

  const moveTo = betterDay
    ? ` — better on ${betterDay.slice(8)}/${betterDay.slice(5, 7)}`
    : ''

  if (r.window === 'none') {
    return {
      ...base,
      clash: 'no-window',
      suggestion: `No room after this duty. Skip it and the week slides forward${moveTo}.`,
    }
  }
  if (r.readiness < WRECKED) {
    return {
      ...base,
      clash: 'tired',
      suggestion: `You'll be flat. Take the rest day early, or do day 6's light session${moveTo}.`,
    }
  }
  if (r.readiness < GOOD_DAY && kind === 'work') {
    return {
      ...base,
      clash: 'heavy-day',
      suggestion:
        workoutIds.length > 1
          ? 'Half a tank — do one of the two, not both.'
          : `Half a tank — go lighter than usual, or trade with a fresher day${moveTo}.`,
    }
  }
  return base
}

export function planSchedule(
  rotation: Rotation,
  sessions: Session[],
  from: string,
  count = 14,
  roster: RosterDay[] = [],
): PlannedDay[] {
  const live = sessions
    .filter((s) => !s.deleted)
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  // Which dates already have a session, and which slot each satisfied.
  const doneByDate = new Map<string, number[]>()
  for (const s of live) {
    const day = slotDayOf(rotation, s.workoutId)
    if (day < 0) continue // outside the rotation — doesn't move the queue
    doneByDate.set(s.date, [...(doneByDate.get(s.date) ?? []), day])
  }

  const labels = new Map(rotation.slots.map((s) => [s.day, s.label]))
  const kinds = new Map<number, SlotKind>(
    rotation.slots.map((s) => [
      s.day,
      s.recovery ? 'recovery' : s.flex ? 'flex' : 'work',
    ]),
  )
  const choices = currentChoices(rotation, sessions)
  const cycle = rotation.slots.length || 7

  // Where the queue stands: the slot after the most recent logged one. Days
  // before `from` that were logged have already advanced it.
  const past = [...doneByDate.entries()]
    .filter(([d]) => d < from)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  const lastDay = past.length ? Math.max(...past[past.length - 1][1]) : 0
  let cursor = (lastDay % cycle) + 1

  const byDate = new Map(roster.map((r) => [r.date, r]))
  /** Nearest upcoming day that could actually take a real session. */
  const nextGoodDay = (after: string): string | null => {
    for (let k = 1; k <= 4; k++) {
      const d = addDays(after, k)
      const r = byDate.get(d)
      if (r && r.window !== 'none' && r.readiness >= GOOD_DAY) return d
    }
    return null
  }

  const out: PlannedDay[] = []
  let markedNext = false
  for (let i = 0; i < count; i++) {
    const date = addDays(from, i)
    const doneDays = doneByDate.get(date) ?? []
    // If something was logged that day, the day belongs to what was actually
    // done — the plan follows reality rather than arguing with it.
    const slotDay = doneDays.length ? Math.max(...doneDays) : cursor
    const done = doneDays.length > 0
    const isNext = !done && !markedNext
    if (isNext) markedNext = true

    const kind = kinds.get(slotDay) ?? 'work'
    const workoutIds = choices.get(slotDay) ?? []
    const r = byDate.get(date)

    out.push({
      date,
      slotDay,
      label: labels.get(slotDay) ?? `Day ${slotDay}`,
      kind,
      workoutIds,
      done,
      next: isNext,
      // Advice is for days still ahead — there's nothing to advise about a
      // session already logged.
      roster: r
        ? done
          ? { readiness: r.readiness, window: r.window, note: r.note, duty: r.duty }
          : adviseDay(r, kind, workoutIds, nextGoodDay(date))
        : undefined,
    })
    cursor = (slotDay % cycle) + 1
  }
  return out
}

/** Monday of the week `iso` falls in. The owner's week ends on Sunday — that's
 *  the day they use to catch up ("I make sure I recover it on Sunday"). */
export function weekStart(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

export { addDays }
