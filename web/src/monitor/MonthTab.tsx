import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react'
import type { Session, WorkoutSet } from '../db'
import { fmtTime } from '../lib/id'
import { intensityColor, intensityLabel, type Intensity } from './intensity'
import { Kpi } from './ui'
import { SessionDetail } from './SessionDetail'

/*
 * Monthly calendar — an Apple-Calendar-style grid of the month with a dot on
 * every training day (coloured by that day's intensity). A month summary up top
 * (sessions, general score, tonnage, form). Tap a day to see that day's
 * workouts with their start times; tap one to open the full session.
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
// JS getDay: 0=Sun..6=Sat → Monday-first index 0=Mon..6=Sun.
const monFirst = (jsDay: number) => (jsDay + 6) % 7

interface DaySession {
  id: string
  workout: string
  score: number
  startedAt: number
  hasTime: boolean
}

export function MonthTab({
  sessions,
  sets,
  intensity,
  nameFor,
}: {
  sessions: Session[]
  sets: WorkoutSet[]
  intensity: Map<string, Intensity>
  nameFor: (id: string) => string
}) {
  const live = useMemo(() => sessions.filter((s) => !s.deleted), [sessions])

  // Per-session tonnage (for the month total).
  const tonById = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of sets) {
      if (s.deleted || !s.weightKg) continue
      m.set(s.sessionId, (m.get(s.sessionId) ?? 0) + s.reps * s.weightKg)
    }
    return m
  }, [sets])

  // Sessions grouped by calendar day (YYYY-MM-DD).
  const byDay = useMemo(() => {
    const m = new Map<string, DaySession[]>()
    for (const s of live) {
      const arr = m.get(s.date) ?? []
      arr.push({
        id: s.id,
        workout: nameFor(s.workoutId),
        score: intensity.get(s.id)?.score ?? 50,
        startedAt: s.createdAt,
        hasTime: s.deviceId !== 'import',
      })
      m.set(s.date, arr)
    }
    return m
  }, [live, intensity, nameFor])

  // Default to the month of the most recent session.
  const latest = useMemo(
    () => live.map((s) => s.date).sort((a, b) => (a < b ? 1 : -1))[0],
    [live],
  )
  const [ym, setYm] = useState(() => {
    if (latest) {
      const [y, m] = latest.split('-').map(Number)
      return { y, m: m - 1 }
    }
    return { y: 2026, m: 0 }
  })
  const [selDay, setSelDay] = useState<string | null>(null)
  const [open, setOpen] = useState<{ id: string; score: number } | null>(null)

  if (open) {
    return (
      <SessionDetail
        sessionId={open.id}
        score={open.score}
        onBack={() => setOpen(null)}
      />
    )
  }

  const { y, m } = ym
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const leadBlanks = monFirst(new Date(y, m, 1).getDay())
  const cells: (number | null)[] = [
    ...Array(leadBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  // Month summary.
  const prefix = `${y}-${String(m + 1).padStart(2, '0')}`
  const monthSessions = live.filter((s) => s.date.startsWith(prefix))
  const scores = monthSessions
    .map((s) => intensity.get(s.id)?.score)
    .filter((v): v is number => v != null)
  const forms = monthSessions
    .map((s) => s.form)
    .filter((v): v is number => v != null)
  const genScore = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : null
  const tonnage = Math.round(
    monthSessions.reduce((a, s) => a + (tonById.get(s.id) ?? 0), 0),
  )
  const avgForm = forms.length
    ? (forms.reduce((a, b) => a + b, 0) / forms.length).toFixed(1)
    : '—'

  const step = (dir: number) => {
    setSelDay(null)
    setYm(({ y, m }) => {
      const nm = m + dir
      if (nm < 0) return { y: y - 1, m: 11 }
      if (nm > 11) return { y: y + 1, m: 0 }
      return { y, m: nm }
    })
  }

  const dayDot = (day: number) => {
    const list = byDay.get(iso(y, m, day))
    if (!list?.length) return null
    // Colour by the day's highest-intensity session.
    const top = Math.max(...list.map((s) => s.score))
    return { color: intensityColor(top), count: list.length }
  }

  const selList = selDay ? (byDay.get(selDay) ?? []) : []

  return (
    <div>
      {/* Month nav */}
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => step(-1)}
          aria-label="previous month"
          className="press flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-ink-2"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="text-center">
          <div className="display text-lg">{MONTHS[m]}</div>
          <div className="nums text-[13px] text-ink-3">{y}</div>
        </div>
        <button
          onClick={() => step(1)}
          aria-label="next month"
          className="press flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-ink-2"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Month summary */}
      <div className="mb-4 grid grid-cols-4 gap-2">
        <Kpi label="sessions" value={String(monthSessions.length)} tone="ink" />
        <Kpi
          label="score"
          value={genScore != null ? String(genScore) : '—'}
          tone="emerald"
        />
        <Kpi
          label="tonnage"
          value={tonnage ? `${(tonnage / 1000).toFixed(1)}k` : '—'}
          unit={tonnage ? 'kg' : undefined}
          tone="sky"
        />
        <Kpi label="form" value={avgForm} tone="violet" />
      </div>

      {/* Calendar */}
      <div className="card p-3">
        <div className="mb-1 grid grid-cols-7">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="text-center text-[11px] font-semibold text-ink-3"
            >
              {d[0]}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, i) => {
            if (day == null) return <div key={i} />
            const date = iso(y, m, day)
            const dot = dayDot(day)
            const selected = selDay === date
            return (
              <button
                key={i}
                onClick={() => setSelDay(dot ? (selected ? null : date) : null)}
                disabled={!dot}
                className={`press relative flex aspect-square flex-col items-center justify-center rounded-xl text-sm ${
                  selected
                    ? 'bg-white/10 font-bold text-ink'
                    : dot
                      ? 'font-semibold text-ink'
                      : 'text-ink-3'
                }`}
              >
                {day}
                {dot && (
                  <span
                    className="mt-0.5 h-1.5 w-1.5 rounded-full"
                    style={{ background: dot.color }}
                  />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Selected day's workouts */}
      {selDay && selList.length > 0 && (
        <div className="mt-4">
          <div className="eyebrow mb-2">
            {new Date(selDay + 'T00:00').toLocaleDateString('en-GB', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </div>
          <div className="space-y-2">
            {selList.map((s) => {
              const color = intensityColor(s.score)
              return (
                <button
                  key={s.id}
                  onClick={() => setOpen({ id: s.id, score: s.score })}
                  className="press card flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: color }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold capitalize">
                      {s.workout}
                    </span>
                    {s.hasTime && (
                      <span className="nums flex items-center gap-1 text-[13px] text-ink-3">
                        <Clock size={11} /> {fmtTime(s.startedAt)}
                      </span>
                    )}
                  </span>
                  <span
                    className="nums text-sm font-bold"
                    style={{ color }}
                    title={intensityLabel(s.score)}
                  >
                    {s.score}
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-ink-3" />
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
