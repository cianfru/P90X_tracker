import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Activity,
  CalendarDays,
  Dumbbell,
  LineChart,
  Map as MapIcon,
} from 'lucide-react'
import { db } from '../db'
import type { Supplement } from '../db'
import { SUPPLEMENTS } from '../db'
import { computeAnalytics } from './analytics'
import { resolveLocation } from './geo'
import { computeIntensity, type Intensity } from './intensity'
import { OverviewTab } from './OverviewTab'
import { MonthTab } from './MonthTab'
import { MapTab } from './MapTab'
import { ExerciseTab } from './ExerciseTab'

/*
 * Progress — a tabbed dashboard: Overview (headline trends), Month (calendar
 * with start times), Map (where you trained → drill into a session), and
 * Exercise (dedicated per-move progression). Each tab breathes on its own.
 */

type Tab = 'overview' | 'month' | 'map' | 'exercise'
const TABS: { id: Tab; label: string; Icon: typeof MapIcon }[] = [
  { id: 'overview', label: 'Overview', Icon: LineChart },
  { id: 'month', label: 'Month', Icon: CalendarDays },
  { id: 'map', label: 'Map', Icon: MapIcon },
  { id: 'exercise', label: 'Exercise', Icon: Dumbbell },
]

export function Monitor() {
  const sessions = useLiveQuery(() => db.sessions.toArray())
  const sets = useLiveQuery(() => db.sets.toArray())
  const exercises = useLiveQuery(() => db.exercises.toArray())
  const templates = useLiveQuery(() => db.templates.toArray())
  const [tab, setTab] = useState<Tab>('overview')

  const ready = sessions && sets && exercises
  const a = useMemo(
    () => (ready ? computeAnalytics(sessions, sets, exercises) : null),
    [ready, sessions, sets, exercises],
  )

  const logged = useMemo(() => {
    if (!ready) return []
    const ids = new Set(sets.filter((s) => !s.deleted).map((s) => s.exerciseId))
    return exercises
      .filter((e) => ids.has(e.id))
      .sort((x, y) =>
        (x.displayName ?? x.name).localeCompare(y.displayName ?? y.name),
      )
  }, [ready, sets, exercises])

  const meta = useMemo(() => {
    if (!sessions) return null
    const live = sessions.filter((s) => !s.deleted)
    const formByMonth = new Map<string, { sum: number; n: number }>()
    for (const s of live) {
      if (s.form == null) continue
      const mo = s.date.slice(0, 7)
      const cur = formByMonth.get(mo) ?? { sum: 0, n: 0 }
      cur.sum += s.form
      cur.n += 1
      formByMonth.set(mo, cur)
    }
    const formTrend = [...formByMonth.entries()]
      .map(([label, v]) => ({ label, value: +(v.sum / v.n).toFixed(2) }))
      .sort((x, y) => (x.label < y.label ? -1 : 1))
    const suppCounts = Object.fromEntries(
      SUPPLEMENTS.map((s) => [s, 0]),
    ) as Record<Supplement, number>
    let suppDays = 0
    const placeKeys = new Set<string>()
    let located = 0
    for (const s of live) {
      if (s.supplements?.length) {
        suppDays++
        for (const x of s.supplements) suppCounts[x]++
      }
      if (s.location) {
        const r = resolveLocation(s.location)
        if (r) {
          placeKeys.add(r.key)
          located++
        }
      }
    }
    return { formTrend, suppCounts, suppDays, places: placeKeys.size, located }
  }, [sessions])

  const intensity = useMemo<Map<string, Intensity>>(
    () => (ready ? computeIntensity(sessions, sets, exercises) : new Map()),
    [ready, sessions, sets, exercises],
  )

  const nameFor = useMemo(() => {
    const map = new Map((templates ?? []).map((t) => [t.id, t.name]))
    return (id: string) => map.get(id) ?? id
  }, [templates])

  if (!a) {
    return (
      <div className="mt-16 text-center text-sm text-ink-3">
        Loading analytics…
      </div>
    )
  }
  if (!logged.length) {
    return (
      <div className="mt-16 text-center text-sm text-ink-3">
        <Activity className="mx-auto mb-3 opacity-40" />
        No data yet — log a few sets and your trends show up here.
      </div>
    )
  }

  return (
    <div className="pt-2">
      {/* Segmented tabs */}
      <div className="mb-4 flex gap-1 rounded-2xl border border-hair bg-black/25 p-1">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`press flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[13px] font-semibold transition ${
              tab === id
                ? 'bg-white/10 text-ink'
                : 'text-ink-3 active:text-ink-2'
            }`}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab a={a} meta={meta} nameFor={nameFor} />}
      {tab === 'month' && (
        <MonthTab
          sessions={sessions ?? []}
          sets={sets ?? []}
          intensity={intensity}
          nameFor={nameFor}
        />
      )}
      {tab === 'map' && (
        <MapTab
          sessions={sessions ?? []}
          templates={templates ?? []}
          intensity={intensity}
          located={meta?.located ?? 0}
          places={meta?.places ?? 0}
        />
      )}
      {tab === 'exercise' && (
        <ExerciseTab logged={logged} sessions={sessions ?? []} sets={sets ?? []} />
      )}
    </div>
  )
}
