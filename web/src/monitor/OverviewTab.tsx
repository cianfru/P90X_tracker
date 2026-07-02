import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Pill } from 'lucide-react'
import { SUPPLEMENTS } from '../db'
import type { Analytics } from './analytics'
import { C, Card, ChartBox, Kpi, tip } from './ui'

interface Meta {
  formTrend: { label: string; value: number }[]
  suppCounts: Record<string, number>
  suppDays: number
}

const yearTick = (m: string) => (m.endsWith('-01') ? m.slice(0, 4) : '')

export function OverviewTab({
  a,
  meta,
  nameFor,
}: {
  a: Analytics
  meta: Meta | null
  nameFor: (id: string) => string
}) {
  const years = `${a.kpis.firstDate.slice(0, 4)}–${a.kpis.lastDate.slice(0, 4)}`
  const movers = [...a.topMovers.slice(0, 6), ...a.topMovers.slice(-3)]
  const maxMove = Math.max(1, ...movers.map((m) => Math.abs(m.pct)))

  return (
    <div className="space-y-4">
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
              tickFormatter={yearTick}
              interval={0}
            />
            <YAxis tick={{ fill: C.mut, fontSize: 10 }} />
            <Tooltip {...tip} formatter={(v) => [v, 'sessions']} />
            <Bar dataKey="value" fill={C.emerald} isAnimationActive={false} />
          </BarChart>
        </ChartBox>
      </Card>

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
              tickFormatter={yearTick}
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
                tickFormatter={yearTick}
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

      <Card
        title="Harder by design — L/X variant share"
        subtitle="share of pull sets done as the harder L-sit / wide-leg variant"
      >
        <ChartBox height={170}>
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

      {meta && meta.suppDays > 0 && (
        <Card
          title="Supplements"
          subtitle={`${meta.suppDays.toLocaleString()} days logged`}
          right={<Pill size={16} className="text-[#34f5a0]" />}
        >
          <div className="space-y-2">
            {SUPPLEMENTS.map((s) => {
              const n = meta.suppCounts[s] ?? 0
              const pct = Math.round((n / meta.suppDays) * 100)
              return (
                <div
                  key={s}
                  className="grid grid-cols-[5rem_1fr_4rem] items-center gap-2.5 text-sm"
                >
                  <span className="text-ink-2 capitalize">{s}</span>
                  <span className="h-2 overflow-hidden rounded bg-white/5">
                    <span
                      className="block h-full rounded bg-[#34f5a0]"
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="nums text-right text-xs text-ink-3">
                    {n} · {pct}%
                  </span>
                </div>
              )
            })}
          </div>
        </Card>
      )}

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
                  className={`nums text-right text-xs ${pos ? 'text-[#34f5a0]' : 'text-rose-400'}`}
                >
                  {pos ? '+' : ''}
                  {m.pct}%
                </span>
              </div>
            )
          })}
        </div>
      </Card>

      <Card title="Routines" subtitle="sessions logged per workout">
        <div className="grid grid-cols-2 gap-2">
          {a.routines.map((r) => (
            <div
              key={r.id}
              className="rounded-xl border border-hair bg-white/[0.02] px-3 py-2.5"
            >
              <div className="text-sm font-semibold capitalize">
                {nameFor(r.id)}
              </div>
              <div className="nums mt-1 text-lg font-bold text-[#33cbff]">
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
