import type { RosterDay, TrainingWindow } from '../db'

/*
 * Aerowake bridge — roster PDF in, training capacity out.
 *
 * The owner already runs Aerowake (github.com/cianfru/aerowake): an EASA
 * fatigue-risk service that parses an airline roster PDF and runs a Borbély
 * two-process model over it. Re-implementing that here would be absurd — it's
 * ~3,000 lines of parser plus a validated biomathematical model — so the PWA
 * posts the PDF to Aerowake and keeps only what training needs.
 *
 * This is the ONE place in the app that requires the network, and it's a
 * once-a-month action, not a logging path. Everything downstream reads the
 * imported rows from Dexie, so the schedule stays usable at 35,000 feet with
 * no signal — the golden rule holds.
 *
 * The important idea: Aerowake's `min_performance` predicts COCKPIT ALERTNESS.
 * That is not the same question as "can I train tonight". A 13-hour duty can
 * leave you perfectly sharp and with nothing left of the day; a short standby
 * can score badly and still leave a free evening. So alertness and available
 * time are tracked separately — `readiness` and `window` — and the planner
 * needs both before it offers you a heavy session.
 */

const DEFAULT_BASE = 'https://aerowake-production.up.railway.app'

/** Only the fields we consume — Aerowake's response is far larger. */
interface AwDuty {
  date: string
  duty_hours: number
  sectors: number
  duty_type?: string
  min_performance?: number | null
  sleep_debt?: number | null
  prior_sleep?: number | null
  risk_level?: string
}
interface AwRestDay {
  date: string
  total_sleep_hours?: number | null
  effective_sleep_hours?: number | null
  strategy_type?: string
  recovery_night_number?: number | null
  cumulative_recovery_fraction?: number | null
}
export interface AwAnalysis {
  analysis_id: string
  month: string
  pilot_base?: string | null
  pilot_name?: string | null
  home_base_timezone?: string | null
  total_duties: number
  duties: AwDuty[]
  rest_days_sleep?: AwRestDay[]
}

export interface RosterImportResult {
  importId: string
  month: string
  base?: string | null
  days: RosterDay[]
  dutyDays: number
  restDays: number
}

/*
 * ── The readiness model ────────────────────────────────────────────────────
 *
 * One number, 0–100: how much hard training this day can absorb. Calibrated
 * against the app's own intensity scale so the two are directly comparable —
 * a day scoring 70 can carry a 70-intensity session.
 */

/** A duty longer than this leaves no usable evening, however fresh you are. */
const NO_WINDOW_HOURS = 12
/** Above this a duty day can only take a short session (one X3, not a P90X). */
const SHORT_WINDOW_HOURS = 8
/** Sleep debt (hours) at which readiness is fully suppressed. */
const DEBT_FLOOR = 12

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))

function windowFor(dutyHours: number): TrainingWindow {
  if (dutyHours >= NO_WINDOW_HOURS) return 'none'
  if (dutyHours >= SHORT_WINDOW_HOURS) return 'short'
  return 'full'
}

/**
 * A duty day's training capacity.
 *
 * Starts from Aerowake's own worst-point alertness, then charges for the day
 * itself: every hour of duty beyond a short one eats into what's left, and
 * accumulated sleep debt drags the whole thing down. Sectors matter separately
 * from hours — four short legs is a harder day than one long cruise.
 */
function dutyReadiness(d: AwDuty): number {
  // No prediction (Aerowake couldn't model it) → assume an average duty day
  // rather than inventing either an excuse or a green light.
  const alertness = d.min_performance ?? 60
  const hours = d.duty_hours ?? 0
  const debt = d.sleep_debt ?? 0

  // Time cost: nothing up to 6h, then ~5 points an hour. A 10h duty gives up
  // 20 points before fatigue is even considered.
  const timeCost = Math.max(0, hours - 6) * 5
  // Sector cost: turnarounds are the grind. First sector is free.
  const sectorCost = Math.max(0, (d.sectors ?? 1) - 1) * 4
  // Debt is a multiplier, not a subtraction — it scales everything down.
  const debtFactor = 1 - Math.min(1, Math.max(0, debt) / DEBT_FLOOR) * 0.6

  return clamp(Math.round((alertness - timeCost - sectorCost) * debtFactor))
}

/**
 * A day off's training capacity.
 *
 * Aerowake tells us what the night is FOR: a first recovery night after a
 * punishing trip is not the same as a third day at home. `recovery_fraction`
 * is how much of the debt that night repays, so a low number means the body is
 * still paying off the trip and a heavy session would be borrowing further.
 */
function restReadiness(r: AwRestDay | undefined): number {
  // A day off Aerowake said nothing about is a plain day off — fully fresh.
  if (!r) return 90

  const sleep = r.effective_sleep_hours ?? r.total_sleep_hours ?? 7.5
  const recovered = r.cumulative_recovery_fraction ?? 1
  const night = r.recovery_night_number ?? 0

  // Sleep quality relative to a solid 7.5h night, worth ±25 points.
  const sleepScore = clamp(60 + (sleep - 7.5) * 10, 25, 85)
  // Still repaying: the first night back is the worst, and it lifts as the
  // debt clears. Full recovery adds nothing (it's already the baseline).
  const recoveryBonus = recovered * 25
  // Explicitly the first night after landing — the body is still catching up.
  const firstNightPenalty = night === 1 ? 15 : 0

  return clamp(Math.round(sleepScore + recoveryBonus - firstNightPenalty))
}

function dutyNote(d: AwDuty): string {
  const h = Math.round(d.duty_hours ?? 0)
  const s = d.sectors ?? 0
  const kind =
    d.duty_type === 'simulator'
      ? 'sim'
      : d.duty_type === 'ground_training'
        ? 'ground'
        : null
  const bits = [`${h}h duty`]
  if (s > 0) bits.push(`${s} sector${s === 1 ? '' : 's'}`)
  if (kind) bits.push(kind)
  return bits.join(' · ')
}

function restNote(r: AwRestDay | undefined): string {
  if (!r) return 'Day off'
  const sleep = r.total_sleep_hours
  const night = r.recovery_night_number
  if (r.strategy_type === 'post_duty_recovery' || night) {
    return `Recovery night${night ? ` ${night}` : ''}${
      sleep ? ` · ${sleep.toFixed(1)}h sleep` : ''
    }`
  }
  return sleep ? `Day off · ${sleep.toFixed(1)}h sleep` : 'Day off'
}

/**
 * Fold an Aerowake analysis into one row per calendar day.
 *
 * Duty days win over rest-day entries for the same date: Aerowake emits
 * post-duty sleep against the landing date, and on a day you both flew and
 * slept, the flying is what governs whether you train.
 */
export function toRosterDays(analysis: AwAnalysis, importId: string): RosterDay[] {
  const byDate = new Map<string, RosterDay>()

  for (const r of analysis.rest_days_sleep ?? []) {
    const date = (r.date ?? '').slice(0, 10)
    if (!date) continue
    byDate.set(date, {
      date,
      duty: false,
      sleepHours: r.total_sleep_hours ?? undefined,
      strategy: r.strategy_type,
      recoveryFraction: r.cumulative_recovery_fraction ?? undefined,
      readiness: restReadiness(r),
      window: 'full',
      note: restNote(r),
      importId,
    })
  }

  for (const d of analysis.duties ?? []) {
    const date = (d.date ?? '').slice(0, 10)
    if (!date) continue
    // Carry the night's sleep forward if a rest entry already claimed this
    // date — it's still the best estimate of what you slept.
    const prior = byDate.get(date)
    byDate.set(date, {
      date,
      duty: true,
      dutyType: d.duty_type,
      dutyHours: d.duty_hours,
      sectors: d.sectors,
      minPerformance: d.min_performance ?? undefined,
      sleepDebt: d.sleep_debt ?? undefined,
      sleepHours: prior?.sleepHours ?? d.prior_sleep ?? undefined,
      readiness: dutyReadiness(d),
      window: windowFor(d.duty_hours ?? 0),
      note: dutyNote(d),
      importId,
    })
  }

  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

/**
 * Send a roster PDF to Aerowake and return the days it implies.
 *
 * Anonymous — Aerowake's `/api/analyze` takes an optional user, so no login is
 * needed and nothing is persisted on its side. We keep only the derived rows.
 */
export async function analyseRoster(
  file: File,
  opts: {
    month: string
    homeBase: string
    homeTimezone: string
    baseUrl?: string
    signal?: AbortSignal
  },
): Promise<RosterImportResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('month', opts.month)
  form.append('home_base', opts.homeBase)
  form.append('home_timezone', opts.homeTimezone)
  form.append('pilot_id', 'p90x')
  form.append('timezone_format', 'auto')

  const res = await fetch(`${opts.baseUrl ?? DEFAULT_BASE}/api/analyze`, {
    method: 'POST',
    body: form,
    signal: opts.signal,
  })

  if (!res.ok) {
    // Aerowake returns {detail: "..."} on validation failures — surface that
    // rather than a bare status, since it names the actual problem.
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = (await res.json()) as { detail?: string }
      if (body?.detail) detail = body.detail
    } catch {
      /* non-JSON error body — keep the status line */
    }
    throw new Error(detail)
  }

  const analysis = (await res.json()) as AwAnalysis
  const importId = `${analysis.analysis_id ?? analysis.month}-${Date.now()}`
  const days = toRosterDays(analysis, importId)

  return {
    importId,
    month: analysis.month,
    base: analysis.pilot_base,
    days,
    dutyDays: days.filter((d) => d.duty).length,
    restDays: days.filter((d) => !d.duty).length,
  }
}

/** Readiness bands, matching the intensity vocabulary used elsewhere. */
export function readinessLabel(r: number): string {
  if (r >= 75) return 'fresh'
  if (r >= 60) return 'ok'
  if (r >= 45) return 'tired'
  return 'wrecked'
}

export function readinessColor(r: number): string {
  if (r >= 75) return '#34f5a0'
  if (r >= 60) return '#a3e635'
  if (r >= 45) return '#fbbf24'
  return '#fb7185'
}
