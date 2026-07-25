import type { RosterDay, TrainingWindow } from '../db'
import {
  airportTz,
  parseCrewLink,
  type ParsedDuty,
  type ParseResult,
} from './crewlink'
import { readRosterGrid } from './rosterPdf'

/*
 * Roster → training capacity.
 *
 * Everything here is derived from what the PARSER read off the PDF — duty
 * hours, sectors, and the gaps between duties. No fatigue model: predicting
 * alertness from sleep pressure and circadian phase is a serious piece of
 * science and a different product. This is the crude, honest version, and it
 * only claims to answer one question: is there room to train that day.
 */

const HOUR = 3600_000
const DAY = 86400_000

/** A duty longer than this leaves no usable evening, however fresh you are. */
const NO_WINDOW_HOURS = 12
/** Above this a duty day can only take a short session (one X3, not a P90X). */
const SHORT_WINDOW_HOURS = 8
/** Rest below this between duties is a genuinely broken night. */
const SHORT_REST_HOURS = 12
/** Best a working day can score — always below a clear day off. */
const DUTY_CEILING = 88
/** Best a day off can score; leaves headroom so days aren't all identical. */
const OFF_CEILING = 95

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))

/**
 * How much of the day the duty leaves behind.
 *
 * Length alone isn't the question — an evening report leaves the whole day
 * free, and standby is waiting by the phone rather than working, so it can't
 * cost what a duty of the same length costs.
 */
function windowFor(d: ParsedDuty, homeTz: string): TrainingWindow {
  const effective = d.kind === 'standby' ? d.dutyHours / 2 : d.dutyHours
  if (effective >= NO_WINDOW_HOURS) return 'none'
  // Report in the evening ⇒ the day before it is yours.
  if (localHour(d.reportUtc, homeTz) >= 17) return 'full'
  if (effective >= SHORT_WINDOW_HOURS) return 'short'
  return 'full'
}

/** Local clock hour (0–23) of an instant in a given zone. */
function localHour(ms: number, zone: string): number {
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    hour12: false,
  }).format(new Date(ms))
  const n = Number(h)
  return n === 24 ? 0 : n
}

/**
 * Training capacity on a duty day, 0–100.
 *
 * Charges for the day: hours on duty, sectors (four short legs grind harder
 * than one long cruise), a night in a hotel, a short turnaround before it, and
 * signing off in the middle of the night.
 */
function dutyReadiness(
  d: ParsedDuty,
  restBeforeHours: number,
  homeBase: string,
  homeTz: string,
): number {
  // A working day starts below a free day and can never climb back above it —
  // however light the duty, it still ate part of the day.
  let score = DUTY_CEILING
  // Sim is mentally punishing but physically nothing; a classroom day or a
  // home standby cost less again. They pay a smaller rate per hour rather
  // than earning a bonus on top.
  const perHour =
    d.kind === 'flight'
      ? 5
      : d.kind === 'simulator'
        ? 3
        : d.kind === 'standby'
          ? 1.5
          : 2
  score -= Math.max(0, d.dutyHours - 6) * perHour
  // Turnarounds are the grind — four short legs beat you up more than one
  // long cruise of the same length.
  score -= Math.max(0, d.segments.length - 1) * 5
  // Sleeping away from home, in a hotel, on someone else's clock.
  if (d.endsAt && d.endsAt !== homeBase) score -= 8
  // A short rest before report means the day starts already behind.
  if (restBeforeHours < SHORT_REST_HOURS) {
    score -= (SHORT_REST_HOURS - Math.max(0, restBeforeHours)) * 2.5
  }
  // Signing off in the small hours writes off the night, and a short duty can
  // still land at 03:00. This is NOT circadian modelling — it's just reading
  // the clock on the release time the parser already gives us.
  const off = localHour(d.releaseUtc, homeTz)
  if (off >= 23 || off < 6) score -= 18
  return clamp(Math.round(score))
}

/**
 * Training capacity on a day off, 0–100.
 *
 * The first day after a trip is not the third. Without a sleep model the best
 * available proxy is how hard the preceding days were and how many days of
 * nothing you've had since — which is roughly how anyone judges it anyway.
 */
function offReadiness(daysSinceDuty: number, lastDuty: ParsedDuty | null): number {
  if (!lastDuty) return OFF_CEILING
  // How much the last duty took out of you, 0–1.
  const severity = Math.min(
    1,
    (Math.max(0, lastDuty.dutyHours - 6) / 10) * 0.7 +
      Math.min(0.3, Math.max(0, lastDuty.segments.length - 1) * 0.1),
  )
  // Recovery is fastest on the first night and tails off.
  const recovered = 1 - Math.exp(-daysSinceDuty / 1.4)
  return clamp(Math.round(OFF_CEILING - severity * 55 * (1 - recovered)))
}

const hhmm = (ms: number, zone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms))

function dutyNote(d: ParsedDuty, homeTz: string): string {
  if (d.kind === 'standby')
    return `Standby · ${hhmm(d.reportUtc, homeTz)}–${hhmm(d.releaseUtc, homeTz)}`
  if (d.kind === 'simulator')
    return `Sim · ${Math.round(d.dutyHours)}h${d.code ? ` · ${d.code}` : ''}`
  if (d.kind === 'ground_training')
    return `Ground · ${Math.round(d.dutyHours)}h${d.code ? ` · ${d.code}` : ''}`
  const legs = d.segments.length
  const route = legs > 0 ? `${d.segments[0].from}–${d.segments[legs - 1].to}` : ''
  return `${Math.round(d.dutyHours)}h duty · ${legs} sector${legs === 1 ? '' : 's'}${
    route ? ` · ${route}` : ''
  }`
}

const isoUtcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Calendar day of an instant, read in a given zone. */
function isoInZone(ms: number, zone: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  )
  return `${p.year}-${p.month}-${p.day}`
}

/**
 * Parsed duties → one row per calendar day, including the days off between.
 *
 * Days the roster explicitly marked OFF are included; so are the gap days a
 * roster leaves blank, because an unmarked day between two duties is still a
 * day you could train.
 */
export function toRosterDays(result: ParseResult, importId: string): RosterDay[] {
  const duties = [...result.duties].sort((a, b) => a.reportUtc - b.reportUtc)
  const byDate = new Map<string, RosterDay>()

  duties.forEach((d, i) => {
    const prev = duties[i - 1]
    const restBefore = prev ? (d.reportUtc - prev.releaseUtc) / HOUR : 48
    byDate.set(d.date, {
      date: d.date,
      duty: true,
      dutyType: d.kind,
      dutyHours: Math.round(d.dutyHours * 10) / 10,
      sectors: d.segments.length,
      restBeforeHours: Math.round(restBefore * 10) / 10,
      endsAt: d.endsAt,
      readiness: dutyReadiness(d, restBefore, result.homeBase, result.homeTz),
      window: windowFor(d, result.homeTz),
      note: dutyNote(d, result.homeTz),
      importId,
    })
  })

  /*
   * Days a duty SPILLS into. A 22:35 report signs off at 06:20 the next
   * morning; without this the roster's own day is marked and the morning after
   * looks like a free day, which is exactly backwards — you land, you sleep.
   * Marking them is also what reconciles the count with the roster's own
   * "FLIGHT DAYS" statistic, which counts every calendar day a duty touches.
   */
  for (const d of duties) {
    const endDate = isoInZone(d.releaseUtc, result.homeTz)
    if (endDate === d.date || byDate.has(endDate)) continue
    const away = d.endsAt && d.endsAt !== result.homeBase
    const offHour = localHour(d.releaseUtc, result.homeTz)
    // Report a layover landing in the clock he's actually living on, not the
    // one back at base — "landed 09:20" for an 06:50 Vienna arrival is a lie.
    const whereTz = (away && d.endsAt ? airportTz(d.endsAt) : null) ?? result.homeTz
    byDate.set(endDate, {
      date: endDate,
      duty: true,
      dutyType: d.kind,
      endsAt: d.endsAt,
      // Signed off in the small hours: the day is for sleeping. Later in the
      // morning there's more of it left.
      readiness: clamp(Math.round((offHour < 6 ? 35 : 55) - (away ? 8 : 0))),
      window: 'full',
      note: away
        ? `Layover ${d.endsAt} · landed ${hhmm(
            d.segments[d.segments.length - 1]?.arrUtc ?? d.releaseUtc,
            whereTz,
          )} local`
        : `Off duty ${hhmm(d.releaseUtc, result.homeTz)}`,
      importId,
    })
  }

  // Fill the days in between that aren't duties. Bounded by what the roster
  // actually covers — inventing days past the last printed column would be
  // asserting you're free on days nobody has rostered yet.
  if (duties.length && result.coveredFrom && result.coveredTo) {
    const startMs = Math.min(
      Date.parse(`${result.coveredFrom}T00:00:00Z`),
      Date.parse(`${duties[0].date}T00:00:00Z`),
    )
    const endMs = Date.parse(`${result.coveredTo}T00:00:00Z`)
    let cursor = startMs
    let lastDuty: ParsedDuty | null = null
    let lastDutyDay: string | null = null

    while (cursor <= endMs) {
      const date = isoUtcDay(cursor)
      const onDuty = byDate.get(date)
      if (onDuty?.duty) {
        lastDuty = duties.find((d) => d.date === date) ?? lastDuty
        lastDutyDay = date
      } else if (!byDate.has(date)) {
        const since = lastDutyDay
          ? Math.round((cursor - Date.parse(`${lastDutyDay}T00:00:00Z`)) / DAY)
          : 3
        byDate.set(date, {
          date,
          duty: false,
          readiness: offReadiness(since, lastDuty),
          window: 'full',
          note: result.offDays.includes(date) ? 'Day off' : 'No duty',
          importId,
        })
      }
      cursor += DAY
    }
  }

  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

export interface RosterImportResult {
  importId: string
  days: RosterDay[]
  dutyDays: number
  offDays: number
  basis: string
  year: number
  unknownAirports: string[]
  warnings: string[]
}

/** Read a roster PDF in the browser and turn it into training days. */
export async function importRosterPdf(
  file: File,
  opts: { homeBase: string; homeTz: string },
): Promise<RosterImportResult> {
  const grid = await readRosterGrid(file)
  if (!grid.columns.length) {
    throw new Error(
      "Couldn't find a date grid in that PDF — is it a CrewLink-style roster?",
    )
  }

  const parsed = parseCrewLink(grid, opts)
  if (!parsed.duties.length) {
    throw new Error(
      `Found ${grid.columns.length} days but no duties — the layout may differ from the rosters this reads.`,
    )
  }

  const importId = `${parsed.year}-${Date.now()}`
  const days = toRosterDays(parsed, importId)
  return {
    importId,
    days,
    dutyDays: days.filter((d) => d.duty).length,
    offDays: days.filter((d) => !d.duty).length,
    basis: parsed.basis,
    year: parsed.year,
    unknownAirports: parsed.unknownAirports,
    warnings: parsed.warnings,
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
