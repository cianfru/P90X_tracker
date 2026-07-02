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
      <div className="mt-16 text-center text-sm text-ink-3">Loading recap…</div>
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
    if (!today) return 'text-ink-3'
    if (!prev) return 'text-ink'
    if (today.effort > prev.effort + 0.25) return 'text-[#37e29a]'
    if (today.effort < prev.effort - 0.25) return 'text-rose-400'
    return 'text-ink'
  }

  return (
    <div className="px-4 pt-5 pb-28">
      <div className="mb-5 flex items-center gap-3">
        <button
          onClick={onBack}
          aria-label="back to session"
          className="press flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-ink-2"
        >
          <ChevronLeft size={20} />
        </button>
        <div>
          <h2 className="display text-xl capitalize">{template.name}</h2>
          <p className="text-[13px] font-medium text-ink-3">
            Today vs the previous {columns.length - 1} sessions
          </p>
        </div>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="nums w-full text-xs">
          <thead>
            <tr className="eyebrow border-b border-hair">
              <th className="px-3 py-3 text-left font-semibold">Exercise</th>
              {columns.map((c, i) => (
                <th
                  key={c.id}
                  className={`px-2.5 py-3 text-right font-semibold ${
                    i === 0 ? 'text-[#37e29a]' : ''
                  }`}
                >
                  {i === 0 ? 'Today' : fmtDate(c.date)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {exercises.map((ex) => {
              const cells = setsByCol.map((sets) => bestCell(sets, ex))
              if (cells.every((c) => !c)) return null
              return (
                <tr key={ex.id} className="border-b border-hair/60">
                  <td
                    className="max-w-[7.5rem] truncate px-3 py-2 font-medium text-ink-2"
                    title={ex.displayName ?? ex.name}
                  >
                    {ex.displayName ?? ex.name}
                  </td>
                  {cells.map((c, i) => (
                    <td
                      key={i}
                      className={`px-2.5 py-2 text-right font-semibold whitespace-nowrap ${
                        i === 0 ? cellTone(c, cells[1] ?? null) : 'text-ink-3'
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
                ['Sets', (t: (typeof totals)[0]) => t.sets],
                ['Reps', (t: (typeof totals)[0]) => t.reps],
                ['Kg', (t: (typeof totals)[0]) => t.ton],
              ] as const
            ).map(([label, pick]) => (
              <tr key={label} className="border-t border-hair text-ink-3">
                <td className="px-3 py-2 font-semibold">{label}</td>
                {totals.map((t, i) => (
                  <td
                    key={i}
                    className={`px-2.5 py-2 text-right font-bold ${
                      i === 0 ? 'text-ink' : ''
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
        className="press mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#37e29a] py-3.5 text-[15px] font-bold text-[#04140d] shadow-[0_10px_28px_-10px_#37e29a99]"
      >
        <HomeIcon size={18} strokeWidth={2.6} /> Done
      </button>
    </div>
  )
}
