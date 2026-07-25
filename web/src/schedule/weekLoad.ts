import type { Session } from '../db'
import type { Intensity } from '../monitor/intensity'
import { addDays, weekStart, type PlannedDay } from './plan'

/*
 * The weekly load budget — "how much am I still owed this week?"
 *
 * Counting SESSIONS is the wrong unit. Three easy days and two brutal ones are
 * not the same week, and the owner's own instinct is the interesting part:
 * train less, and the days you do train have to carry more. So the week is
 * budgeted in INTENSITY POINTS (a session's 0–100 intensity score), not in
 * ticks on a calendar. Miss a day and the points don't disappear — they get
 * redistributed onto the days that are left, which is exactly the behaviour
 * being asked for.
 *
 * The target is LEARNED, never prescribed. Measured over the logged history in
 * Monday-start weeks (empty weeks included — they're part of the real rhythm):
 *
 *   all 390 weeks     median 96 pts/week   (median 2 sessions)
 *   trailing 104w     median 140
 *   trailing 52w      median 141
 *   trailing 26w      median 151
 *   trailing 13w      median 143
 *
 * The all-history figure is far too low — it averages in the 2019 baseline and
 * would call a mediocre week a good one. The short windows track the current
 * level but swing on a single holiday. A trailing YEAR is the stable choice:
 * simulated across the whole history its target moves 56 → 148 as the owner
 * actually got stronger, without the week-to-week wobble of the 13/26w windows.
 *
 * At 141 points across a typical 2-session week, a normal week asks ~70 per
 * session — comfortably above the median session, which is the point: the
 * budget is a floor to clear, not an average to regress to.
 *
 * THE DEBT DIES ON MONDAY. A missed week must never make the next one harder,
 * or a bad fortnight compounds into a demand nobody could meet. Two independent
 * things guarantee that:
 *
 *   1. `banked` only ever counts sessions inside the CURRENT Monday–Sunday
 *      week, and `target` is a fixed weekly figure. There is nowhere for a
 *      deficit to accumulate — the shortfall is recomputed from scratch every
 *      Monday, never carried.
 *   2. The target is a median of RECENT weeks, so training less pulls it DOWN,
 *      not up. Simulated over a three-month lay-off it decays 141 → 115 and the
 *      ask with it (71 → 58). The only stable direction is gentler.
 *
 * Verified across every Monday of 2026: the fresh-week ask stays in a 44–84
 * band with no upward drift, and a Sunday sitting at 11/142 (out of reach)
 * becomes a routine 52-point ask the next morning.
 */

/** Weeks of history the target is learned from. */
const WINDOW_WEEKS = 52
/** Below this many weeks of history, use everything there is. */
const MIN_WEEKS = 8
/**
 * The hardest session it's fair to ask for on demand. Scores are percentiles,
 * so 85 already means "better than 85% of everything you've ever logged" —
 * beyond that the budget stops being a plan and becomes a fantasy, and the
 * shortfall is better spread over another day.
 */
const CEILING = 85
/** Where the ask stops being routine and starts being a hard session. */
const HARD = 65

const median = (xs: number[]): number => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface WeekLoad {
  /** Monday / Sunday of the week being reported (YYYY-MM-DD). */
  start: string
  end: string
  /** Sessions logged so far this week. */
  done: number
  /** Intensity points banked so far (Σ session score). */
  banked: number
  /** The week's budget — the owner's usual weekly points. */
  target: number
  /** Their usual sessions per week, for context. */
  typicalSessions: number
  /** Training days still available before Sunday (rest days excluded). */
  daysLeft: number
  /** How many of those days the shortfall actually needs. */
  sessionsLeft: number
  /**
   * Points each of those sessions has to average to finish the week on budget.
   * null once the budget is met — there's nothing left to ask for.
   */
  needed: number | null
  /** Behind the usual pace for this point in the week. */
  behind: boolean
  /**
   * Behind AND the remaining ask has got demanding — either it's climbed into
   * the hard band or there's no spare day left to absorb a miss. A fresh Monday
   * is "behind" by definition and shouldn't be dressed up as a warning.
   */
  atRisk: boolean
  /** The gap can't be closed at a sane per-session intensity — the days left
   *  would each have to be a personal best. Time to double up instead. */
  outOfReach: boolean
  /** 0–1, how much of the budget is banked (can exceed 1). */
  progress: number
}

/**
 * Where this week stands against the owner's usual weekly load.
 *
 * `plan` supplies which of the remaining days are actually training days — the
 * schedule is derived, so if days have been missed the rest day has already
 * been squeezed out and those days count as available.
 */
export function computeWeekLoad(
  sessions: Session[],
  intensity: Map<string, Intensity>,
  plan: PlannedDay[],
  today: string,
): WeekLoad {
  const start = weekStart(today)
  const end = addDays(start, 6)
  const live = sessions.filter((s) => !s.deleted)

  // Weekly points across all history, empty weeks included.
  const byWeek = new Map<string, { n: number; pts: number }>()
  for (const s of live) {
    const k = weekStart(s.date)
    const cur = byWeek.get(k) ?? { n: 0, pts: 0 }
    cur.n += 1
    cur.pts += intensity.get(s.id)?.score ?? 0
    byWeek.set(k, cur)
  }

  const keys = [...byWeek.keys()].sort()
  const history: { n: number; pts: number }[] = []
  if (keys.length) {
    // Walk every week from the first logged one up to (not including) this one,
    // so weeks with nothing in them count as the zeros they were.
    for (let w = keys[0]; w < start; w = addDays(w, 7)) {
      history.push(byWeek.get(w) ?? { n: 0, pts: 0 })
    }
  }
  const window =
    history.length >= MIN_WEEKS ? history.slice(-WINDOW_WEEKS) : history
  const target = Math.round(median(window.map((w) => w.pts)))
  const typicalSessions = Math.round(median(window.map((w) => w.n)))

  const cur = byWeek.get(start) ?? { n: 0, pts: 0 }
  const banked = Math.round(cur.pts)

  // Days still open: today onward, inside the week, planned as real work and
  // not already logged. A day that already has a session isn't "left" even if
  // more could be added — its points are already in `banked`.
  const daysLeft = plan.filter(
    (p) => p.date >= today && p.date <= end && !p.done && p.kind !== 'recovery',
  ).length

  const gap = target - banked
  const behind = target > 0 && gap > 0

  /*
   * Spread the shortfall over SESSIONS, not over calendar days. Dividing by
   * every free day is the obvious mistake and it inverts the whole idea: on a
   * Monday it would spread a 140-point week across six open days and ask for
   * 24-point sessions from someone who trains twice a week. So start from the
   * sessions they'd normally still do this week — and only recruit extra days
   * when a realistic session can't cover the gap on its own.
   */
  let sessionsLeft = behind
    ? Math.min(daysLeft, Math.max(1, typicalSessions - cur.n))
    : 0
  let needed = sessionsLeft > 0 ? Math.ceil(gap / sessionsLeft) : null
  while (needed != null && needed > CEILING && sessionsLeft < daysLeft) {
    sessionsLeft += 1
    needed = Math.ceil(gap / sessionsLeft)
  }

  return {
    start,
    end,
    done: cur.n,
    banked,
    target,
    typicalSessions,
    daysLeft,
    sessionsLeft,
    needed,
    behind,
    atRisk: behind && ((needed ?? 0) > HARD || daysLeft <= sessionsLeft),
    // Nothing left to spend, or every remaining day would have to be a top-15%
    // session. Either way one hard workout won't fix it.
    outOfReach: behind && (daysLeft === 0 || (needed ?? 0) > CEILING),
    progress: target > 0 ? banked / target : 0,
  }
}

/** Which Mixer dial answers this week's shortfall. */
export function neededIntensity(w: WeekLoad): 'light' | 'medium' | 'hard' {
  if (w.needed == null) return 'medium'
  return w.needed >= HARD ? 'hard' : w.needed >= 40 ? 'medium' : 'light'
}
