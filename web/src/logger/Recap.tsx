import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, Home as HomeIcon } from 'lucide-react'
import { db } from '../db'
import type { Exercise, WorkoutSet } from '../db'
import { MODIFIER_META } from '../db'
import { templateExercises } from '../db/repo'
import { effortOf } from './effort'
import { fmtDate } from '../lib/id'

/*
 * End-of-workout recap, spreadsheet-style like the original xlsx: rows are the
 * routine's exercises, columns are this session plus the previous sessions of
 * the SAME workout. Today's cell is coloured by effort vs the previous session
 * (green = up, zinc = level, rose = down).
 */

const PREV_COLUMNS = 3

interface Cell {
  label: string
  effort: number
}

function bestCell(sets: WorkoutSet[], ex: Exercise): Cell | null {
  const live = sets.filter((s) => !s.deleted && s.exerciseId === ex.id)
  if (!live.length) return null
  let best = live[0]
  let bestE = effortOf(best, ex.type)
  for (const s of live.slice(1)) {
    const e = effortOf(s, ex.type)
    if (e > bestE) {
      best = s
      bestE = e
    }
  }
  const mods = best.modifiers.map((m) => MODIFIER_META[m].label).join(',')
  return {
    label: `${best.reps}${best.weightKg ? `×${best.weightKg}` : ''}${mods ? `·${mods}` : ''}`,
    effort: bestE,
  }
}

export function Recap({
  sessionId,
  onBack,
  onExit,
}: {
  sessionId: string
  onBack: () => void
  onExit: () => void
}) {
  const data = useLiveQuery(async () => {
    const session = await db.sessions.get(sessionId)
    if (!session) return null
    const template = await db.templates.get(session.workoutId)
    if (!template) return null
    const exercises = await templateExercises(template.exerciseIds)
    const all = await db.sessions
      .where('workoutId')
      .equals(session.workoutId)
      .toArray()
    const previous = all
      .filter((s) => !s.deleted && s.id !== session.id && s.date <= session.date)
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, PREV_COLUMNS)
    const columns = [session, ...previous]
    const setsByCol = await Promise.all(
      columns.map(async (c) =>
        (await db.sets.where('sessionId').equals(c.id).toArray()).filter(
          (s) => !s.deleted,
        ),
      ),
    )
    return { session, template, exercises, columns, setsByCol }
  }, [sessionId])

  if (!data) {
    return (
      <div className="mt-16 text-center font-mono text-sm text-zinc-500">
        loading recap…
      </div>
    )
  }

  const { template, exercises, columns, setsByCol } = data
  const totals = setsByCol.map((sets) => ({
    sets: sets.length,
    reps: sets.reduce((a, s) => a + s.reps, 0),
    ton: Math.round(
      sets.reduce((a, s) => a + (s.weightKg ? s.reps * s.weightKg : 0), 0),
    ),
  }))

  const cellTone = (today: Cell | null, prev: Cell | null): string => {
    if (!today) return 'text-zinc-600'
    if (!prev) return 'text-zinc-200'
    if (today.effort > prev.effort + 0.25) return 'text-emerald-400'
    if (today.effort < prev.effort - 0.25) return 'text-rose-400'
    return 'text-zinc-200'
  }

  return (
    <div className="px-4 pt-4 pb-24">
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={onBack}
          aria-label="back to session"
          className="text-zinc-400"
        >
          <ChevronLeft size={22} />
        </button>
        <div>
          <h2 className="text-lg font-bold capitalize">{template.name} — recap</h2>
          <p className="font-mono text-xs text-zinc-500">
            today vs the previous {columns.length - 1} sessions
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/50">
        <table className="w-full font-mono text-xs">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500">
              <th className="px-3 py-2 text-left font-normal">exercise</th>
              {columns.map((c, i) => (
                <th
                  key={c.id}
                  className={`px-2 py-2 text-right font-normal ${
                    i === 0 ? 'text-emerald-300' : ''
                  }`}
                >
                  {i === 0 ? 'today' : fmtDate(c.date)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {exercises.map((ex) => {
              const cells = setsByCol.map((sets) => bestCell(sets, ex))
              if (cells.every((c) => !c)) return null
              return (
                <tr key={ex.id} className="border-b border-zinc-800/50">
                  <td
                    className="max-w-[7.5rem] truncate px-3 py-1.5 text-zinc-400"
                    title={ex.displayName ?? ex.name}
                  >
                    {ex.displayName ?? ex.name}
                  </td>
                  {cells.map((c, i) => (
                    <td
                      key={i}
                      className={`px-2 py-1.5 text-right whitespace-nowrap ${
                        i === 0 ? cellTone(c, cells[1] ?? null) : 'text-zinc-400'
                      }`}
                    >
                      {c?.label ?? '—'}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            {(
              [
                ['sets', (t: (typeof totals)[0]) => t.sets],
                ['reps', (t: (typeof totals)[0]) => t.reps],
                ['kg', (t: (typeof totals)[0]) => t.ton],
              ] as const
            ).map(([label, pick]) => (
              <tr key={label} className="border-t border-zinc-800 text-zinc-500">
                <td className="px-3 py-1.5">{label}</td>
                {totals.map((t, i) => (
                  <td
                    key={i}
                    className={`px-2 py-1.5 text-right ${
                      i === 0 ? 'text-zinc-200' : ''
                    }`}
                  >
                    {pick(t)}
                  </td>
                ))}
              </tr>
            ))}
          </tfoot>
        </table>
      </div>

      <button
        onClick={onExit}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 font-bold text-zinc-950 transition active:scale-95"
      >
        <HomeIcon size={18} /> Done
      </button>
    </div>
  )
}
