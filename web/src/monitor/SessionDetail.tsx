import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, MapPin } from 'lucide-react'
import { db } from '../db'
import { MODIFIER_META } from '../db'
import { templateExercises } from '../db/repo'
import { fmtDate } from '../lib/id'
import { useSwipeBack } from '../lib/gestures'
import { intensityColor, intensityLabel } from './intensity'

/*
 * Read-only detail of a single logged session — the actual dataset for that
 * day: every exercise and the sets performed, plus the day's context
 * (location, form, supplements) and its intensity score. Reached by drilling
 * into a place on the map or a month in the monthly view.
 */

const SUPP_SHORT: Record<string, string> = {
  creatine: 'Creatine',
  protein: 'Protein',
  maca: 'Maca',
  aminos: 'Aminos',
}

export function SessionDetail({
  sessionId,
  score,
  onBack,
}: {
  sessionId: string
  score?: number
  onBack: () => void
}) {
  useSwipeBack(onBack)
  const data = useLiveQuery(async () => {
    const session = await db.sessions.get(sessionId)
    if (!session) return null
    const template = await db.templates.get(session.workoutId)
    const exercises = template
      ? await templateExercises(template.exerciseIds)
      : []
    const sets = (
      await db.sets.where('sessionId').equals(sessionId).toArray()
    ).filter((s) => !s.deleted)
    return { session, template, exercises, sets }
  }, [sessionId])

  if (!data) {
    return <div className="mt-10 text-center text-sm text-ink-3">Loading…</div>
  }
  const { session, template, exercises, sets } = data
  const byExercise = new Map<string, typeof sets>()
  for (const s of sets) {
    const arr = byExercise.get(s.exerciseId) ?? []
    arr.push(s)
    byExercise.set(s.exerciseId, arr)
  }
  // Exercises that were actually logged, kept in the workout's order.
  const ordered = exercises.filter((e) => byExercise.has(e.id))
  const totalReps = sets.reduce((a, s) => a + s.reps, 0)
  const tonnage = Math.round(
    sets.reduce((a, s) => a + (s.weightKg ? s.reps * s.weightKg : 0), 0),
  )

  return (
    <div>
      <button
        onClick={onBack}
        className="press mb-4 flex items-center gap-1 text-sm font-semibold text-ink-2"
      >
        <ChevronLeft size={18} /> Back
      </button>

      <div className="mb-3">
        <h3 className="display text-xl capitalize">
          {template?.name ?? session.workoutId}
        </h3>
        <p className="nums text-[13px] text-ink-3">{fmtDate(session.date)}</p>
      </div>

      {/* Day context */}
      <div className="mb-3 flex flex-wrap gap-1.5 text-xs font-semibold">
        {score != null && (
          <span
            className="rounded-full px-2.5 py-1"
            style={{
              background: `${intensityColor(score)}22`,
              color: intensityColor(score),
            }}
          >
            intensity {score} · {intensityLabel(score)}
          </span>
        )}
        {session.location && (
          <span className="flex items-center gap-1 rounded-full bg-sky-400/12 px-2.5 py-1 text-sky-300">
            <MapPin size={11} /> {session.location}
          </span>
        )}
        {session.form != null && (
          <span className="rounded-full bg-[#34f5a0]/12 px-2.5 py-1 text-[#34f5a0]">
            form {session.form}
          </span>
        )}
        {session.supplements?.map((s) => (
          <span
            key={s}
            className="rounded-full bg-white/[0.06] px-2.5 py-1 text-ink-2"
          >
            {SUPP_SHORT[s] ?? s}
          </span>
        ))}
      </div>
      {session.notes && (
        <p className="mb-3 rounded-xl border border-hair bg-white/[0.02] px-3 py-2 text-[13px] text-ink-2">
          {session.notes}
        </p>
      )}

      {/* Totals */}
      <div className="mb-3 grid grid-cols-3 gap-2">
        {[
          ['sets', sets.length],
          ['reps', totalReps],
          ['kg', tonnage],
        ].map(([label, n]) => (
          <div key={label} className="card px-3 py-2.5 text-center">
            <div className="nums text-lg font-bold">{n.toLocaleString()}</div>
            <div className="eyebrow text-[10px]">{label}</div>
          </div>
        ))}
      </div>

      {/* Exercises + sets */}
      <div className="space-y-2">
        {ordered.map((ex) => {
          const exSets = (byExercise.get(ex.id) ?? []).sort(
            (a, b) => a.loggedAt - b.loggedAt,
          )
          return (
            <div key={ex.id} className="card p-3.5">
              <div className="mb-2 font-semibold">{ex.displayName ?? ex.name}</div>
              <div className="flex flex-wrap gap-1.5">
                {exSets.map((s) => {
                  const mods = s.modifiers
                    .map((m) => MODIFIER_META[m].label)
                    .join(',')
                  return (
                    <span
                      key={s.id}
                      className="nums rounded-lg bg-black/25 px-2.5 py-1.5 text-sm font-semibold"
                    >
                      <span className="text-ink-3">R{s.round}</span>{' '}
                      {s.reps}
                      {s.weightKg ? `×${s.weightKg}kg` : ''}
                      {mods ? (
                        <span className="text-amber-300"> ·{mods}</span>
                      ) : (
                        ''
                      )}
                      {s.struggle ? ' 🔥' : ''}
                    </span>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
