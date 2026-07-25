import type { Rotation, Session } from '../db'
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
export function planSchedule(
  rotation: Rotation,
  sessions: Session[],
  from: string,
  count = 14,
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

    out.push({
      date,
      slotDay,
      label: labels.get(slotDay) ?? `Day ${slotDay}`,
      kind: kinds.get(slotDay) ?? 'work',
      workoutIds: choices.get(slotDay) ?? [],
      done,
      next: isNext,
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
