import type { Rotation, RosterDay, Session, TrainingWindow } from '../db'
import { computeStaleness } from './staleness'

/*
 * The schedule.
 *
 * Nothing is stored. The plan is DERIVED from what's actually been logged, and
 * the cycle IS the week: day 1 is Monday, day 7 is Sunday. That's the owner's
 * own framing — "day 7: recovery", Sunday held back to catch up — and it's the
 * same boundary the weekly load budget resets on.
 *
 * Within a week the queue advances one slot a day, but a day that came and went
 * without a session doesn't advance it, so the rest of the week shifts forward
 * and the tail — day 6's light session, then the rest day — is what gets
 * squeezed out. That's "everything moves forward by one day". Monday restarts
 * at day 1, so you can never drift more than a week out of phase.
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

  // Nothing here ever says "skip it". The owner trains on long days too — the
  // session gets shorter, not cancelled — so the advice is always how to scale
  // it down, with the fresher day offered as an option rather than a verdict.
  if (r.readiness < WRECKED) {
    return {
      ...base,
      clash: 'tired',
      suggestion:
        workoutIds.length > 1
          ? `Long day — do one of the two${moveTo}.`
          : `Long day — squeeze a short one, save the full session${moveTo}.`,
    }
  }
  if (r.window === 'short') {
    return {
      ...base,
      clash: 'no-window',
      suggestion:
        workoutIds.length > 1
          ? 'Tight day — one of the two will fit.'
          : 'Tight day — a short version fits either side of the duty.',
    }
  }
  if (r.readiness < GOOD_DAY && kind === 'work') {
    return {
      ...base,
      clash: 'heavy-day',
      suggestion:
        workoutIds.length > 1
          ? 'Half a tank — do one of the two, not both.'
          : `Half a tank — go lighter than usual${moveTo}.`,
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

  /*
   * The cycle IS the week. Day 1 is Monday and day 7 is Sunday — the owner's
   * own framing ("day 7: recovery", Sunday kept free to catch up), and the same
   * boundary the weekly load budget resets on.
   *
   * Within a week the queue advances one slot a day, but a day that came and
   * went WITHOUT a session doesn't advance it: the rest of the week shifts
   * forward and the tail — day 6's light session, then the rest day — is what
   * gets squeezed out. That's "everything moves forward by one day", and
   * because Monday restarts at day 1 you can never end up more than a week
   * adrift.
   */
  const slotByDate = new Map<string, number>()
  const lastDate = addDays(from, count - 1)
  for (let w = weekStart(from); w <= lastDate; w = addDays(w, 7)) {
    let slot = 1
    for (let i = 0; i < 7; i++) {
      const d = addDays(w, i)
      const done = doneByDate.get(d)
      // A day that was trained belongs to whatever was actually done.
      const s = done?.length ? Math.max(...done) : slot
      slotByDate.set(d, s)
      if (done?.length) slot = Math.min(cycle, s + 1)
      // Days still ahead are assumed to happen; days already gone that weren't
      // trained hold the queue where it is.
      else if (d >= from) slot = Math.min(cycle, slot + 1)
    }
  }

  const byDate = new Map(roster.map((r) => [r.date, r]))
  /** Nearest upcoming day that could actually take a real session. */
  const nextGoodDay = (after: string): string | null => {
    for (let k = 1; k <= 4; k++) {
      const d = addDays(after, k)
      const r = byDate.get(d)
      if (r && r.window === 'full' && r.readiness >= GOOD_DAY) return d
    }
    return null
  }

  const out: PlannedDay[] = []
  let markedNext = false
  for (let i = 0; i < count; i++) {
    const date = addDays(from, i)
    const doneDays = doneByDate.get(date) ?? []
    const slotDay = slotByDate.get(date) ?? (i % cycle) + 1
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
