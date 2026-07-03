import { useEffect, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Activity } from 'lucide-react'
import { db } from '../db'
import { AURA_DEFAULT, setAura } from '../logger/programColor'
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
 * Progress — the analytics surface. Which view shows (Overview / Month / Map /
 * Exercise) is driven by the app's bottom navigation, so Monitor is a
 * controlled switch on the `tab` prop. Each view breathes on its own.
 */

export type Tab = 'overview' | 'month' | 'map' | 'exercise'

export function Monitor({ tab }: { tab: Tab }) {
  const sessions = useLiveQuery(() => db.sessions.toArray())
  const sets = useLiveQuery(() => db.sets.toArray())
  const exercises = useLiveQuery(() => db.exercises.toArray())
  const templates = useLiveQuery(() => db.templates.toArray())
  // Progress is program-agnostic — keep the neutral green aura.
  useEffect(() => setAura(AURA_DEFAULT), [])

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
      {tab === 'overview' && (
        <OverviewTab
          a={a}
          meta={meta}
          nameFor={nameFor}
          sessions={sessions ?? []}
          intensity={intensity}
        />
      )}
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
