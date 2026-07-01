import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft } from 'lucide-react'
import { db } from '../db'
import { templateExercises } from '../db/repo'
import { fmtDate } from '../lib/id'
import { ExerciseCard } from './ExerciseCard'
import { Stat } from './ui'

/*
 * Session — the gym screen. Header carries live totals; each template exercise
 * is a collapsible card (accordion, first one open). All state lives in Dexie,
 * so totals and set lists update the instant a set is logged.
 */
export function Session({
  sessionId,
  onBack,
}: {
  sessionId: string
  onBack: () => void
}) {
  const session = useLiveQuery(() => db.sessions.get(sessionId), [sessionId])
  const template = useLiveQuery(
    () => (session ? db.templates.get(session.workoutId) : undefined),
    [session?.workoutId],
  )
  const exercises = useLiveQuery(
    () => (template ? templateExercises(template.exerciseIds) : undefined),
    [template?.exerciseIds],
  )
  const sets = useLiveQuery(
    () => db.sets.where('sessionId').equals(sessionId).toArray(),
    [sessionId],
  )

  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    if (open === null && exercises?.length) setOpen(exercises[0].id)
  }, [exercises, open])

  const live = (sets ?? []).filter((s) => !s.deleted)
  const totalSets = live.length
  const totalReps = live.reduce((a, s) => a + s.reps, 0)
  const tonnage = live.reduce(
    (a, s) => a + (s.weightKg ? s.reps * s.weightKg : 0),
    0,
  )

  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur">
        <button
          onClick={onBack}
          aria-label="back"
          className="text-zinc-400 active:text-zinc-200"
        >
          <ChevronLeft size={22} />
        </button>
        <div className="flex-1">
          <div className="leading-tight font-semibold capitalize">
            {template?.name ?? '…'}
          </div>
          <div className="font-mono text-xs text-zinc-500">
            {session ? fmtDate(session.date) : ''}
          </div>
        </div>
        <div className="flex gap-3 font-mono text-xs text-zinc-400">
          <Stat n={totalSets} label="sets" />
          <Stat n={totalReps} label="reps" />
          <Stat n={tonnage} label="kg" />
        </div>
      </div>

      <div className="space-y-2.5 px-4 pt-4 pb-24">
        {exercises?.map((ex) => (
          <ExerciseCard
            key={ex.id}
            exercise={ex}
            sessionId={sessionId}
            isOpen={open === ex.id}
            onToggle={() => setOpen(open === ex.id ? null : ex.id)}
          />
        ))}
      </div>
    </div>
  )
}
