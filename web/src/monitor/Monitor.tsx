import { useMemo, useState } from 'react'
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
import { Activity, Trophy } from 'lucide-react'
import { db } from '../db'
import { fmtDate } from '../lib/id'
import { computeAnalytics, progressionFor } from './analytics'

const C = {
  emerald: '#34d399',
  sky: '#38bdf8',
  amber: '#fbbf24',
  rose: '#fb7185',
  grid: 'rgba(255,255,255,.06)',
  mut: '#8a97ab',
}

const tip = {
  contentStyle: {
    background: '#18181b',
    border: '1px solid #3f3f46',
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
      <div className="mt-16 text-center font-mono text-sm text-zinc-500">
        loading analytics…
      </div>
    )
  }
  if (!logged.length) {
    return (
      <div className="mt-16 text-center text-sm text-zinc-500">
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
      <div className="grid grid-cols-3 gap-2">
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

      {/* Per-exercise progression */}
      <Card
        title={selected ? (selected.displayName ?? selected.name) : 'Progression'}
        subtitle={weighted ? 'top weight / session (kg)' : 'best reps / session'}
        right={
          pr != null ? (
            <div className="text-right">
              <div className="flex items-center justify-end gap-1 text-amber-400">
                <Trophy size={13} />
                <span className="font-mono font-bold">{pr}</span>
              </div>
              <div className="font-mono text-xs text-zinc-500">PR</div>
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
                  ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400'
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
                  className="truncate text-zinc-300"
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
                  className={`text-right font-mono text-xs ${pos ? 'text-emerald-400' : 'text-rose-400'}`}
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
              className="rounded-xl border border-zinc-800 bg-white/[0.015] px-3 py-2.5"
            >
              <div className="text-sm font-semibold capitalize">
                {nameFor(r.id)}
              </div>
              <div className="mt-1 font-mono text-lg font-bold text-sky-400">
                {r.sessions}
                <span className="text-xs font-normal text-zinc-500"> sessions</span>
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
    ink: 'text-zinc-100',
    emerald: 'text-emerald-400',
    sky: 'text-sky-400',
    amber: 'text-amber-400',
    violet: 'text-violet-400',
    rose: 'text-rose-400',
  }
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 px-3 py-2.5">
      <div className="font-mono text-[10px] tracking-wider text-zinc-500 uppercase">
        {label}
      </div>
      <div className={`mt-1 font-mono text-lg font-bold ${colors[tone]}`}>
        {value}
        {unit && <span className="text-xs font-normal text-zinc-500"> {unit}</span>}
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
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
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
