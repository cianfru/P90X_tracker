import type { DateColumn, RosterGrid } from './rosterPdf'
import TZ from './airport-tz.json'

/*
 * CrewLink grid roster parser — ported from Aerowake's
 * `fatigue-tool/parsers/qatar_crewlink_parser.py`.
 *
 * The layout: each date is a COLUMN, and the day's activity is stacked
 * vertically beneath it. Recognition is by pattern, not by airline, so this
 * reads any CrewLink-style roster (Qatar, Emirates, Etihad, …):
 *
 *   RPT:05:55            ← report time
 *   QR490                ← flight number   ┐
 *   DOH                  ← departure       │ a segment is this exact
 *   02:25                ← departure time  │ five-line sequence
 *   SIN                  ← arrival         │
 *   13:40(+1)            ← arrival time    ┘
 *   (359)                ← trailing tokens: aircraft, IR/DH, training codes
 *
 * The subtleties that make it work — and that took the original a long time to
 * get right — are all kept:
 *
 *   • `RPT` is matched tolerantly (`R\s*P\s*T\s*:`) because text extraction
 *     sometimes wedges spaces into it.
 *   • `(+1)` on an arrival time means the next day; without it, an arrival
 *     earlier than its departure is assumed to cross midnight.
 *   • A column with no RPT whose first departure matches the previous duty's
 *     arrival — and that arrival wasn't home base — is a LAYOVER CONTINUATION,
 *     and merges into the previous duty instead of becoming a new one.
 *   • Trailing tokens are consumed carefully: a bare `359` is an aircraft type,
 *     but only if it isn't the flight number that starts the next segment.
 *   • Report after first departure ⇒ the report belongs to the previous day.
 *
 * Deliberately NOT ported: the Borbély fatigue model, EASA FDP limits, sleep
 * modelling. Those are Aerowake's product and none of this app's business.
 * This reads the PDF; what training does with it lives in `roster.ts`.
 */

const ZONES: string[] = (TZ as { zones: string[] }).zones
const IATA: Record<string, number> = (TZ as { iata: Record<string, number> }).iata

/** IANA timezone for an IATA code, or null when it's not a known airport. */
export function airportTz(code: string): string | null {
  const i = IATA[code.toUpperCase()]
  return i === undefined ? null : ZONES[i]
}

/** How the roster's printed times should be read. */
export type TimeBasis = 'local' | 'zulu' | 'homebase'

/** Simulator sessions — high cognitive load, in a motion sim. */
const SIMULATOR_CODES = new Set(['OPTR', 'FFS', 'FS1', 'AFTD', '77LP', 'AW8'])
/** Classroom, meetings, assessments. */
const GROUND_CODES = new Set(['EBTGR', 'TMTG', 'INAS', '6ESEC', '6EVS', 'EVNT'])
/** Codes that mean "no operating duty today". */
const NON_FLYING = [
  'OFF',
  'GOFF',
  'DOFF',
  'SBY',
  'PSBY',
  'STANDBY',
  'PISY',
  'LVE',
  'LEAVE',
  'SICK',
  'REST',
  'SR',
  'ROFF',
  'POFF',
]
/** Metadata on a segment — the flight is still a normal flight. */
const LINE_TRAINING = new Set(['X', 'U', 'UL', 'L', 'E', 'ZFT'])
/** Operationally meaningful: relief crew / travelling as a passenger. */
const ACTIVITY = new Set(['IR', 'DH'])
const IGNORED = new Set(['REQ', 'PIC', 'SR', 'CB', 'SIM', 'GND', 'DOFF', 'PA'])

export type DutyKind = 'flight' | 'simulator' | 'ground_training'

export interface Segment {
  flight: string
  from: string
  to: string
  /** Epoch ms, UTC. */
  depUtc: number
  arrUtc: number
  aircraft?: string
  /** 'IR' (inflight rest ⇒ augmented crew) or 'DH' (deadhead). */
  activity?: string
}

export interface ParsedDuty {
  /** YYYY-MM-DD in home-base time — the day the duty is counted against. */
  date: string
  kind: DutyKind
  /** Raw activity code for training duties, e.g. "OPTR". */
  code?: string
  reportUtc: number
  releaseUtc: number
  /** Report → release, hours. */
  dutyHours: number
  segments: Segment[]
  /** Airport the duty ends at — home base means you sleep at home. */
  endsAt?: string
}

export interface ParseResult {
  duties: ParsedDuty[]
  /** Days explicitly marked off / standby / leave. */
  offDays: string[]
  /** The period the roster actually covers (YYYY-MM-DD), from its columns. */
  coveredFrom: string
  coveredTo: string
  basis: TimeBasis
  year: number
  homeBase: string
  homeTz: string
  /** Airport codes the roster used that aren't in the bundled table. */
  unknownAirports: string[]
  warnings: string[]
}

const RE_RPT = /R\s*P\s*T\s*:\s*(\d{2})\s*:\s*(\d{2})/
const RE_AIRPORT = /^[A-Z]{3}$/
const RE_TIME = /(\d{2}):(\d{2})/
const RE_FLIGHT_NUM = /^\d{3,4}$/
const RE_FLIGHT_PREFIXED = /^[A-Z0-9]{2}[A-Z]?\d{1,5}$/

const HOUR = 3600_000
const DAY = 86400_000

/** Longest break a single duty period can carry across midnight. */
const CONTINUATION_MAX_GAP_HOURS = 6

/** Offset (ms) of `zone` from UTC at a given instant. */
function tzOffset(zone: string, atUtc: number): number {
  // Intl gives us the wall-clock reading in `zone`; the gap from the UTC
  // reading of the same instant IS the offset, DST included.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const p = Object.fromEntries(
    dtf.formatToParts(new Date(atUtc)).map((x) => [x.type, x.value]),
  )
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) === 24 ? 0 : Number(p.hour),
    Number(p.minute),
    Number(p.second),
  )
  return asUtc - atUtc
}

/**
 * Wall-clock reading in `zone` → epoch ms.
 * Two passes: the offset depends on the instant, which depends on the offset.
 */
function zonedToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  zone: string,
): number {
  const naive = Date.UTC(y, mo - 1, d, h, mi)
  let utc = naive - tzOffset(zone, naive)
  utc = naive - tzOffset(zone, utc)
  return utc
}

const iso = (ms: number, zone: string): string => {
  const off = tzOffset(zone, ms)
  return new Date(ms + off).toISOString().slice(0, 10)
}

/** "13:40(+1)" → {h, m, plusDays}. */
function parseClock(s: string): { h: number; m: number; plus: number } | null {
  const plus = /\(\+(\d+)\)/.exec(s)
  const t = RE_TIME.exec(s.replace(/\(\+\d+\)/, ''))
  if (!t) return null
  const h = Number(t[1])
  const m = Number(t[2])
  if (h > 23 || m > 59) return null
  return { h, m, plus: plus ? Number(plus[1]) : 0 }
}

function looksLikeFlightNumber(line: string): boolean {
  return (
    !line.includes(':') &&
    !RE_AIRPORT.test(line) &&
    !line.startsWith('(') &&
    (RE_FLIGHT_NUM.test(line) || RE_FLIGHT_PREFIXED.test(line))
  )
}

interface Ctx {
  basis: TimeBasis
  homeTz: string
  homeBase: string
  year: number
  unknown: Set<string>
  warnings: string[]
}

/** Which zone a printed time at `code` should be read in. */
function readingZone(ctx: Ctx, code: string): string {
  if (ctx.basis === 'zulu') return 'UTC'
  if (ctx.basis === 'homebase') return ctx.homeTz
  const tz = airportTz(code)
  if (!tz) {
    ctx.unknown.add(code)
    return 'UTC'
  }
  return tz
}

/**
 * Walk a column's lines pulling out the five-line flight sequences.
 * Mirrors `_extract_segments_from_lines`, including the trailing-token scan.
 */
function extractSegments(lines: string[], col: DateColumn, ctx: Ctx): Segment[] {
  const segments: Segment[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!looksLikeFlightNumber(line)) {
      i += 1
      continue
    }
    if (i + 4 >= lines.length) {
      i += 1
      continue
    }

    const [depCode, depT, arrCode, arrT] = [
      lines[i + 1],
      lines[i + 2],
      lines[i + 3],
      lines[i + 4],
    ]
    if (
      !RE_AIRPORT.test(depCode) ||
      !RE_TIME.test(depT) ||
      !RE_AIRPORT.test(arrCode) ||
      !RE_TIME.test(arrT)
    ) {
      i += 1
      continue
    }

    const dep = parseClock(depT)
    const arr = parseClock(arrT)
    if (!dep || !arr) {
      i += 5
      continue
    }

    const depUtc =
      zonedToUtc(
        ctx.year,
        col.month,
        col.day,
        dep.h,
        dep.m,
        readingZone(ctx, depCode),
      ) +
      dep.plus * DAY
    let arrUtc =
      zonedToUtc(
        ctx.year,
        col.month,
        col.day,
        arr.h,
        arr.m,
        readingZone(ctx, arrCode),
      ) +
      arr.plus * DAY
    // A (+1) marker can be missing or get stripped; an arrival at or before its
    // departure always means the flight crossed midnight.
    if (arrUtc <= depUtc) arrUtc += DAY

    const seg: Segment = {
      flight: line,
      from: depCode,
      to: arrCode,
      depUtc,
      arrUtc,
    }
    segments.push(seg)
    i += 5

    // Trailing tokens: aircraft type, IR/DH, line-training annotations.
    const limit = Math.min(i + 3, lines.length)
    while (i < limit) {
      const token = lines[i].trim()
      const upper = token.toUpperCase()
      const bare = upper.replace(/^\(|\)$/g, '')

      if (token.includes(',')) {
        for (const part of upper.split(',').map((p) => p.trim())) {
          if (ACTIVITY.has(part)) seg.activity = part
        }
        i += 1
      } else if (ACTIVITY.has(upper)) {
        seg.activity = upper
        i += 1
      } else if (LINE_TRAINING.has(upper) || IGNORED.has(upper)) {
        i += 1
      } else if (/^\(\w{2,3}\)$/.test(upper)) {
        seg.aircraft = bare
        i += 1
      } else if (/^[A-Z0-9]{2,3}$/.test(bare) && !RE_AIRPORT.test(upper)) {
        // A bare `359` is an aircraft type — unless it's the flight number
        // opening the next segment, which we must not swallow.
        const nextIsAirport =
          i + 1 < lines.length && RE_AIRPORT.test(lines[i + 1].trim().toUpperCase())
        const nextIsTime = i + 2 < lines.length && RE_TIME.test(lines[i + 2])
        if (looksLikeFlightNumber(upper) && nextIsAirport && nextIsTime) break
        seg.aircraft = bare
        i += 1
      } else {
        break
      }
    }
  }

  return segments
}

/** Training columns carry their code on its own line, near the top. */
function detectTrainingCode(lines: string[]): string | null {
  for (const raw of lines.slice(0, 6)) {
    const t = raw.trim().toUpperCase()
    if (SIMULATOR_CODES.has(t) || GROUND_CODES.has(t)) return t
  }
  return null
}

/** A training day: RPT, the code, then a start and end time at the base. */
function parseTrainingDuty(
  lines: string[],
  col: DateColumn,
  code: string,
  ctx: Ctx,
): ParsedDuty | null {
  const times: { h: number; m: number }[] = []
  let report: { h: number; m: number } | null = null

  for (const line of lines) {
    const r = RE_RPT.exec(line)
    if (r && !report) {
      report = { h: Number(r[1]), m: Number(r[2]) }
      continue
    }
    // Bare HH:MM lines are the session start/end.
    const c = /^(\d{2}):(\d{2})$/.exec(line.trim())
    if (c) times.push({ h: Number(c[1]), m: Number(c[2]) })
  }

  const zone = ctx.basis === 'zulu' ? 'UTC' : ctx.homeTz
  const at = (t: { h: number; m: number }) =>
    zonedToUtc(ctx.year, col.month, col.day, t.h, t.m, zone)

  let start: number
  let end: number
  if (times.length >= 2) {
    start = at(times[0])
    end = at(times[1])
    if (end <= start) end += DAY
  } else if (report) {
    // Original's fallback: report + 8h when the times can't be found.
    start = at(report)
    end = start + 8 * HOUR
    ctx.warnings.push(`${col.header}: ${code} times not found, assumed 8h`)
  } else {
    return null
  }

  const reportUtc = report ? at(report) : start
  return {
    date: iso(reportUtc, ctx.homeTz),
    kind: SIMULATOR_CODES.has(code) ? 'simulator' : 'ground_training',
    code,
    reportUtc,
    releaseUtc: end,
    dutyHours: (end - reportUtc) / HOUR,
    segments: [],
    endsAt: ctx.homeBase,
  }
}

/** One date column → a duty, or null for an off day / empty column. */
function parseColumn(col: DateColumn, ctx: Ctx): ParsedDuty | null {
  const lines = col.lines.map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return null

  const first = lines[0].toUpperCase()
  if (NON_FLYING.some((c) => first.includes(c))) return null

  const training = detectTrainingCode(lines)
  if (training) return parseTrainingDuty(lines, col, training, ctx)

  let report: { h: number; m: number } | null = null
  for (const line of lines) {
    const m = RE_RPT.exec(line)
    if (m) {
      report = { h: Number(m[1]), m: Number(m[2]) }
      break
    }
  }

  const segments = extractSegments(lines, col, ctx)
  if (!segments.length) return null

  let reportUtc: number
  if (report) {
    const zone = readingZone(ctx, segments[0].from)
    reportUtc = zonedToUtc(ctx.year, col.month, col.day, report.h, report.m, zone)
    // Reporting after you departed is impossible — the report was yesterday.
    if (reportUtc > segments[0].depUtc) reportUtc -= DAY
  } else {
    reportUtc = segments[0].depUtc - HOUR
  }

  // EASA: the duty runs to the last landing plus 30 minutes.
  let releaseUtc = segments[segments.length - 1].arrUtc + 30 * 60_000
  if (reportUtc >= releaseUtc) releaseUtc = reportUtc + HOUR

  return {
    // Anchored to the HOME-BASE calendar day, not the PDF column: a 00:10
    // report at a layover in Brazil belongs to the Doha day it maps onto.
    date: iso(reportUtc, ctx.homeTz),
    kind: 'flight',
    reportUtc,
    releaseUtc,
    dutyHours: (releaseUtc - reportUtc) / HOUR,
    segments,
    endsAt: segments[segments.length - 1].to,
  }
}

/** "All times are in UTC" and friends, from the page header. */
export function detectBasis(text: string): TimeBasis | null {
  const t = text.toLowerCase()
  if (/(?:all\s+)?times?\s*(?:are\s+)?(?:in\s+)?[:\-–]?\s*(?:utc|zulu)/.test(t))
    return 'zulu'
  if (/(?:all\s+)?times?\s*(?:are\s+)?(?:in\s+)?[:\-–]?\s*local/.test(t))
    return 'local'
  if (
    /(?:all\s+)?times?\s*(?:are\s+)?(?:in\s+)?[:\-–]?\s*(?:home\s*)?base(?:\s|$)/.test(
      t,
    ) ||
    /home\s*base\s+time/.test(t)
  )
    return 'homebase'
  return null
}

/** Roster period year from the header; falls back to the current year. */
export function detectYear(text: string, fallback: number): number {
  const m = /\b(20\d{2})\b/.exec(text)
  return m ? Number(m[1]) : fallback
}

/**
 * Grid → duties.
 *
 * Columns are walked in order so a layover continuation can be merged into the
 * duty it belongs to.
 */
export function parseCrewLink(
  grid: RosterGrid,
  opts: { homeBase: string; homeTz: string; basis?: TimeBasis; year?: number },
): ParseResult {
  const ctx: Ctx = {
    basis: opts.basis ?? detectBasis(grid.text) ?? 'local',
    homeTz: opts.homeTz,
    homeBase: opts.homeBase.toUpperCase(),
    year: opts.year ?? detectYear(grid.text, new Date().getFullYear()),
    unknown: new Set(),
    warnings: [],
  }

  const duties: ParsedDuty[] = []
  const offDays: string[] = []

  // Sorted so continuation merging sees days in real order even when a
  // multi-page roster hands its pages back out of sequence.
  const cols = [...grid.columns].sort((a, b) =>
    a.month === b.month ? a.day - b.day : a.month - b.month,
  )

  for (const col of cols) {
    const duty = parseColumn(col, ctx)
    if (!duty) {
      const lines = col.lines.map((l) => l.trim()).filter(Boolean)
      if (
        lines.length &&
        NON_FLYING.some((c) => lines[0].toUpperCase().includes(c))
      ) {
        offDays.push(
          `${ctx.year}-${String(col.month).padStart(2, '0')}-${String(col.day).padStart(2, '0')}`,
        )
      }
      continue
    }

    // Layover continuation: no report time of its own, the previous duty ended
    // away from base, and this duty picks up exactly where that one stopped.
    const hasRpt = col.lines.some((l) => RE_RPT.test(l))
    const prev = duties[duties.length - 1]
    const gapHours = prev
      ? (duty.segments[0]?.depUtc - prev.releaseUtc) / HOUR
      : Infinity
    const continuation =
      !hasRpt &&
      prev?.segments.length &&
      prev.endsAt !== ctx.homeBase &&
      duty.segments.length &&
      prev.endsAt === duty.segments[0].from &&
      // DEVIATION from the Python original, which merges on the conditions
      // above alone. A continuation is by definition "the same duty period
      // carried past midnight" — it cannot contain a full night's rest. Without
      // this bound, a layover whose return leg happens to print no RPT merges
      // into a single 40-hour "duty", which is nonsense to schedule around.
      gapHours <= CONTINUATION_MAX_GAP_HOURS

    if (continuation) {
      prev.segments.push(...duty.segments)
      prev.releaseUtc = duty.releaseUtc
      prev.dutyHours = (prev.releaseUtc - prev.reportUtc) / HOUR
      prev.endsAt = duty.endsAt
    } else {
      duties.push(duty)
    }
  }

  const dates = cols
    .map(
      (c) =>
        `${ctx.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`,
    )
    .sort()

  return {
    duties,
    offDays,
    coveredFrom: dates[0] ?? '',
    coveredTo: dates[dates.length - 1] ?? '',
    basis: ctx.basis,
    year: ctx.year,
    homeBase: ctx.homeBase,
    homeTz: ctx.homeTz,
    unknownAirports: [...ctx.unknown].sort(),
    warnings: ctx.warnings,
  }
}
