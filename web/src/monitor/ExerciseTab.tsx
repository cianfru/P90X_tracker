import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Search, Trophy } from 'lucide-react'
import type { Exercise, Session, WorkoutSet } from '../db'
import { fmtDate } from '../lib/id'
import { progressionFor } from './analytics'
import { C, Card, ChartBox, tip } from './ui'

/*
 * Dedicated per-exercise progression — search for a move, get a big chart, its
 * PR, and a clean history table. Replaces the cramped swipe-chip picker.
 */

export function ExerciseTab({
  logged,
  sessions,
  sets,
}: {
  logged: Exercise[]
  sessions: Session[]
  sets: WorkoutSet[]
}) {
  const [q, setQ] = useState('')
  const [exId, setExId] = useState<string | null>(null)
  const selected =
    logged.find((e) => e.id === exId) ??
    logged.find((e) => e.name === 'Std push') ??
    logged[0]

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return logged
    return logged.filter((e) =>
      (e.displayName ?? e.name).toLowerCase().includes(t),
    )
  }, [q, logged])

  const series = useMemo(
    () =>
      selected ? progressionFor(sets, sessions, selected.id, selected.type) : [],
    [selected, sets, sessions],
  )
  const pr = series.length ? Math.max(...series.map((s) => s.value)) : null
  const weighted = selected?.type === 'weighted'
  const unit = weighted ? 'kg' : 'reps'
  const recent = [...series].reverse().slice(0, 14)

  return (
    <div className="space-y-4">
      {selected && (
        <Card
          title={selected.displayName ?? selected.name}
          subtitle={weighted ? 'top weight per session' : 'best reps per session'}
          right={
            pr != null ? (
              <div className="text-right">
                <div className="flex items-center justify-end gap-1 text-amber-400">
                  <Trophy size={14} />
                  <span className="nums font-bold">{pr}</span>
                </div>
                <div className="text-[11px] text-ink-3">PR · {unit}</div>
              </div>
            ) : null
          }
        >
          <ChartBox height={260}>
            <LineChart data={series} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
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
                strokeWidth={2.5}
                dot={{ r: 2, fill: C.emerald }}
                isAnimationActive={false}
              />
            </LineChart>
          </ChartBox>
        </Card>
      )}

      {/* Recent history */}
      {recent.length > 0 && (
        <Card title="Recent sessions" subtitle={`latest ${recent.length}`}>
          <div className="nums grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            {recent.map((r, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-ink-3">{fmtDate(r.date)}</span>
                <span className="font-bold text-ink">
                  {r.value}
                  <span className="text-xs font-normal text-ink-3"> {unit}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Search + picker */}
      <div className="card p-3">
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-hair bg-black/25 px-3">
          <Search size={16} className="text-ink-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a move…"
            className="w-full bg-transparent py-2.5 text-sm outline-none"
          />
        </div>
        <div className="max-h-72 space-y-0.5 overflow-y-auto">
          {filtered.map((e) => (
            <button
              key={e.id}
              onClick={() => setExId(e.id)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                selected?.id === e.id
                  ? 'bg-[#34f5a0]/15 font-semibold text-[#34f5a0]'
                  : 'text-ink-2 active:bg-white/[0.04]'
              }`}
            >
              <span className="truncate">{e.displayName ?? e.name}</span>
              <span className="ml-2 shrink-0 text-[11px] text-ink-3">
                {e.type === 'weighted' ? 'kg' : 'reps'}
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="py-4 text-center text-sm text-ink-3">No match.</p>
          )}
        </div>
      </div>
    </div>
  )
}
