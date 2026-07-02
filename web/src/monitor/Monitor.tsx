import { lazy, Suspense, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Activity, MapPin, Pill, Trophy } from 'lucide-react'
import { db } from '../db'
import type { Supplement } from '../db'
import { SUPPLEMENTS } from '../db'
import { fmtDate } from '../lib/id'
import { computeAnalytics, progressionFor } from './analytics'
import { resolveLocation } from './geo'
import { computeIntensity, type Intensity } from './intensity'

// Leaflet is heavy; only pull it in when the Monitor (already lazy) renders.
const TravelMap = lazy(() =>
  import('./TravelMap').then((m) => ({ default: m.TravelMap })),
)

const C = {
  emerald: '#34d399',
  sky: '#38bdf8',
  amber: '#fbbf24',
  rose: '#fb7185',
  violet: '#a78bfa',
  grid: 'rgba(255,255,255,.08)',
  mut: '#aab3c2',
}

const tip = {
  contentStyle: {
    background: '#14161d',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: 12,
    fontSize: 12,
  },
  labelStyle: { color: '#a1a1aa' },
}

export function Monitor() {
  const sessions = useLiveQuery(() => db.sessions.toArray())
  const sets = useLiveQuery(() => db.sets.toArray())
  const exercises = useLiveQuery(() => db.exercises.toArray())
  const templates = useLiveQuery(() => db.templates.toArray())

  const ready = sessions && sets && exercises
  const a = useMemo(
    () => (ready ? computeAnalytics(sessions, sets, exercises) : null),
    [ready, sessions, sets, exercises],
  )

  // Exercises that actually have logged data, for the progression picker.
  const logged = useMemo(() => {
    if (!ready) return []
    const ids = new Set(sets.filter((s) => !s.deleted).map((s) => s.exerciseId))
    return exercises
      .filter((e) => ids.has(e.id))
      .sort((x, y) =>
        (x.displayName ?? x.name).localeCompare(y.displayName ?? y.name),
      )
  }, [ready, sets, exercises])

  // Per-day metadata analytics (location / form / supplements).
  const meta = useMemo(() => {
    if (!sessions) return null
    const live = sessions.filter((s) => !s.deleted)
    // Average form per month.
    const formByMonth = new Map<string, { sum: number; n: number }>()
    for (const s of live) {
      if (s.form == null) continue
      const m = s.date.slice(0, 7)
      const cur = formByMonth.get(m) ?? { sum: 0, n: 0 }
      cur.sum += s.form
      cur.n += 1
      formByMonth.set(m, cur)
    }
    const formTrend = [...formByMonth.entries()]
      .map(([label, v]) => ({ label, value: +(v.sum / v.n).toFixed(2) }))
      .sort((a, b) => (a.label < b.label ? -1 : 1))
    // Supplement day counts, and located / unlocated place tally.
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
    return {
      formTrend,
      suppCounts,
      suppDays,
      places: placeKeys.size,
      located,
    }
  }, [sessions])

  const intensity = useMemo<Map<string, Intensity>>(
    () => (ready ? computeIntensity(sessions, sets, exercises) : new Map()),
    [ready, sessions, sets, exercises],
  )

  const [exId, setExId] = useState<string | null>(null)
  const selected =
    logged.find((e) => e.id === exId) ??
    logged.find((e) => e.name === 'Std push') ??
    logged[0]

  const series = useMemo(
    () =>
      selected && sessions && sets
        ? progressionFor(sets, sessions, selected.id, selected.type)
        : [],
    [selected, sessions, sets],
  )
  const pr = series.length ? Math.max(...series.map((s) => s.value)) : null
  const weighted = selected?.type === 'weighted'

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

  const nameFor = (id: string) => templates?.find((t) => t.id === id)?.name ?? id
  const years = `${a.kpis.firstDate.slice(0, 4)}–${a.kpis.lastDate.slice(0, 4)}`
  const movers = [...a.topMovers.slice(0, 6), ...a.topMovers.slice(-3)]
  const maxMove = Math.max(1, ...movers.map((m) => Math.abs(m.pct)))

  return (
    <div className="space-y-4 pt-2">
      {/* KPIs */}
      <div className="grid auto-rows-fr grid-cols-3 gap-2">
        <Kpi label="sessions" value={a.kpis.sessions.toLocaleString()} tone="ink" />
        <Kpi
          label="bodyweight reps"
          value={a.kpis.bodyweightReps.toLocaleString()}
          tone="emerald"
        />
        <Kpi
          label="tonnage"
          value={`${(a.kpis.tonnageKg / 1e6).toFixed(2)}M`}
          unit="kg"
          tone="sky"
        />
        <Kpi label="moves" value={String(a.kpis.exercises)} tone="violet" />
        <Kpi label="years" value={years} tone="amber" />
        <Kpi
          label="struggles"
          value={String(a.strugglePerYear.reduce((s, x) => s + x.value, 0))}
          tone="rose"
        />
      </div>

      {/* Training map — where every session happened */}
      {meta && meta.located > 0 && (
        <Card
          title="Training around the world"
          subtitle={`${meta.located.toLocaleString()} located sessions across ${meta.places} places`}
          right={<MapPin size={16} className="text-sky-400" />}
        >
          <Suspense
            fallback={
              <div className="py-12 text-center text-xs text-ink-3">
                Loading map…
              </div>
            }
          >
            <TravelMap
              sessions={sessions ?? []}
              templates={templates ?? []}
              intensity={intensity}
            />
          </Suspense>
        </Card>
      )}

      {/* Per-exercise progression */}
      <Card
        title={selected ? (selected.displayName ?? selected.name) : 'Progression'}
        subtitle={weighted ? 'top weight / session (kg)' : 'best reps / session'}
        right={
          pr != null ? (
            <div className="text-right">
              <div className="flex items-center justify-end gap-1 text-amber-400">
                <Trophy size={13} />
                <span className="font-bold">{pr}</span>
              </div>
              <div className="text-xs text-ink-3">PR</div>
            </div>
          ) : null
        }
      >
        <div className="mb-3 -mx-1 flex gap-1.5 overflow-x-auto pb-1">
          {logged.map((e) => (
            <button
              key={e.id}
              onClick={() => setExId(e.id)}
              className={`rounded-full border px-3 py-1.5 text-xs whitespace-nowrap transition ${
                selected?.id === e.id
                  ? 'border-[#37e29a]/40 bg-[#37e29a]/20 text-[#37e29a]'
                  : 'border-hair bg-white/[0.04] text-ink-3'
              }`}
            >
              {e.displayName ?? e.name}
            </button>
          ))}
        </div>
        <ChartBox>
          <LineChart
            data={series}
            margin={{ top: 5, right: 8, left: -20, bottom: 0 }}
          >
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: C.mut, fontSize: 10 }}
              tickFormatter={(d: string) => d.slice(0, 4)}
              minTickGap={28}
            />
            <YAxis
              tick={{ fill: C.mut, fontSize: 10 }}
              domain={['dataMin-2', 'dataMax+2']}
            />
            <Tooltip {...tip} labelFormatter={(d) => fmtDate(String(d))} />
            {pr != null && (
              <ReferenceLine y={pr} stroke={C.amber} strokeDasharray="4 4" />
            )}
            <Line
              type="monotone"
              dataKey="pr"
              stroke={C.amber}
              strokeWidth={1}
              strokeDasharray="3 3"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={C.emerald}
              strokeWidth={2}
              dot={{ r: 1.5, fill: C.emerald }}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartBox>
      </Card>

      {/* Harder-variant share */}
      <Card
        title="Harder by design — L/X variant share"
        subtitle="share of pull sets done as the harder L-sit / wide-leg variant"
      >
        <ChartBox height={180}>
          <BarChart
            data={a.harderSharePerYear}
            margin={{ top: 5, right: 8, left: -20, bottom: 0 }}
          >
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: C.mut, fontSize: 10 }} />
            <YAxis
              tick={{ fill: C.mut, fontSize: 10 }}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip {...tip} formatter={(v) => [`${v}%`, 'harder']} />
            <Bar
              dataKey="value"
              fill={C.amber}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ChartBox>
      </Card>

      {/* Consistency */}
      <Card
        title="Consistency"
        subtitle={`sessions per month · ${a.sessionsPerMonth.length} months`}
      >
        <ChartBox height={170}>
          <BarChart
            data={a.sessionsPerMonth}
            margin={{ top: 5, right: 8, left: -24, bottom: 0 }}
          >
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: C.mut, fontSize: 10 }}
              tickFormatter={(m: string) =>
                m.endsWith('-01') ? m.slice(0, 4) : ''
              }
              interval={0}
            />
            <YAxis tick={{ fill: C.mut, fontSize: 10 }} />
            <Tooltip {...tip} formatter={(v) => [v, 'sessions']} />
            <Bar dataKey="value" fill={C.emerald} isAnimationActive={false} />
          </BarChart>
        </ChartBox>
      </Card>

      {/* Form / readiness over time */}
      {meta && meta.formTrend.length > 1 && (
        <Card
          title="How I felt — self-assessed form"
          subtitle="average readiness (1–10) per month"
        >
          <ChartBox height={170}>
            <LineChart
              data={meta.formTrend}
              margin={{ top: 5, right: 8, left: -24, bottom: 0 }}
            >
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: C.mut, fontSize: 10 }}
                tickFormatter={(m: string) =>
                  m.endsWith('-01') ? m.slice(0, 4) : ''
                }
                interval={0}
              />
              <YAxis
                tick={{ fill: C.mut, fontSize: 10 }}
                domain={[1, 10]}
                ticks={[2, 4, 6, 8, 10]}
              />
              <Tooltip {...tip} formatter={(v) => [v, 'form']} />
              <Line
                type="monotone"
                dataKey="value"
                stroke={C.violet}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ChartBox>
        </Card>
      )}

      {/* Supplements */}
      {meta && meta.suppDays > 0 && (
        <Card
          title="Supplements"
          subtitle={`${meta.suppDays.toLocaleString()} days logged`}
          right={<Pill size={16} className="text-emerald-400" />}
        >
          <div className="space-y-2">
            {SUPPLEMENTS.map((s) => {
              const n = meta.suppCounts[s]
              const pct = Math.round((n / meta.suppDays) * 100)
              return (
                <div
                  key={s}
                  className="grid grid-cols-[5rem_1fr_4rem] items-center gap-2.5 text-sm"
                >
                  <span className="text-ink-2 capitalize">{s}</span>
                  <span className="h-2 overflow-hidden rounded bg-white/5">
                    <span
                      className="block h-full rounded bg-emerald-400"
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="text-right text-xs text-ink-3">
                    {n} · {pct}%
                  </span>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Struggle per year */}
      <Card
        title="Effort markers — the 😓 count"
        subtitle="hard sets flagged per year"
      >
        <ChartBox height={170}>
          <BarChart
            data={a.strugglePerYear}
            margin={{ top: 5, right: 8, left: -24, bottom: 0 }}
          >
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: C.mut, fontSize: 10 }} />
            <YAxis tick={{ fill: C.mut, fontSize: 10 }} />
            <Tooltip {...tip} formatter={(v) => [v, 'struggles']} />
            <Bar
              dataKey="value"
              fill={C.amber}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ChartBox>
      </Card>

      {/* Tonnage per month */}
      <Card title="Tonnage" subtitle="kg moved per month (Σ reps × weight)">
        <ChartBox height={170}>
          <LineChart
            data={a.tonnagePerMonth}
            margin={{ top: 5, right: 8, left: -8, bottom: 0 }}
          >
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: C.mut, fontSize: 10 }}
              tickFormatter={(m: string) =>
                m.endsWith('-01') ? m.slice(0, 4) : ''
              }
              interval={0}
            />
            <YAxis
              tick={{ fill: C.mut, fontSize: 10 }}
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              {...tip}
              formatter={(v) => [`${Number(v).toLocaleString()} kg`, 'tonnage']}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={C.sky}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartBox>
      </Card>

      {/* Biggest movers */}
      <Card
        title="Biggest movers"
        subtitle="first year vs latest, standard entries only (median)"
      >
        <div className="space-y-2">
          {movers.map((m) => {
            const pos = m.pct >= 0
            return (
              <div
                key={m.id}
                className="grid grid-cols-[7rem_1fr_3.5rem] items-center gap-2.5 text-sm"
              >
                <span
                  className="truncate text-ink-2"
                  title={`${m.name} · ${m.first}→${m.last} ${m.metric === 'weight' ? 'kg' : 'reps'}`}
                >
                  {m.name}
                </span>
                <span className="h-2 overflow-hidden rounded bg-white/5">
                  <span
                    className="block h-full rounded"
                    style={{
                      width: `${(Math.abs(m.pct) / maxMove) * 100}%`,
                      background: pos ? C.emerald : C.rose,
                    }}
                  />
                </span>
                <span
                  className={`text-right text-xs ${pos ? 'text-emerald-400' : 'text-rose-400'}`}
                >
                  {pos ? '+' : ''}
                  {m.pct}%
                </span>
              </div>
            )
          })}
        </div>
      </Card>

      {/* Routines */}
      <Card title="The nine routines" subtitle="sessions logged per workout">
        <div className="grid grid-cols-2 gap-2">
          {a.routines.map((r) => (
            <div
              key={r.id}
              className="rounded-xl border border-hair bg-white/[0.02] px-3 py-2.5"
            >
              <div className="text-sm font-semibold capitalize">
                {nameFor(r.id)}
              </div>
              <div className="mt-1 text-lg font-bold text-sky-400">
                {r.sessions}
                <span className="text-xs font-normal text-ink-3"> sessions</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

function Kpi({
  label,
  value,
  unit,
  tone,
}: {
  label: string
  value: string
  unit?: string
  tone: 'ink' | 'emerald' | 'sky' | 'amber' | 'violet' | 'rose'
}) {
  const colors = {
    ink: 'text-ink',
    emerald: 'text-[#37e29a]',
    sky: 'text-sky-400',
    amber: 'text-amber-400',
    violet: 'text-violet-400',
    rose: 'text-rose-400',
  }
  return (
    <div className="card px-3.5 py-3">
      <div className="eyebrow text-[10px]">{label}</div>
      <div
        className={`nums mt-1 text-lg font-bold whitespace-nowrap ${colors[tone]}`}
      >
        {value}
        {unit && <span className="text-xs font-medium text-ink-3"> {unit}</span>}
      </div>
    </div>
  )
}

function Card({
  title,
  subtitle,
  right,
  children,
}: {
  title: string
  subtitle?: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="card p-4">
      <div className="mb-3.5 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-bold tracking-tight">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

function ChartBox({
  children,
  height = 200,
}: {
  children: React.ReactElement
  height?: number
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  )
}
