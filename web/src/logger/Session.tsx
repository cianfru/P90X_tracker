import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, Flag, Trash2 } from 'lucide-react'
import { db } from '../db'
import { deleteSession, templateExercises } from '../db/repo'
import { capturePosition } from './geolocate'
import { fmtDate, getDeviceId } from '../lib/id'
import { ExerciseCard } from './ExerciseCard'
import { Recap } from './Recap'
import { SessionMeta } from './SessionMeta'
import { Stat } from './ui'

/*
 * Session — the gym screen. "Log & next" advances through the routine in
 * order; logging the last exercise (or tapping the flag) opens the recap,
 * which compares today against previous sessions of the same workout.
 * The trash control soft-deletes a session started by mistake.
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
  const [showRecap, setShowRecap] = useState(false)
  // The full performed order (exercise ids, repeats allowed): an explicit
  // `sequence` for non-uniform workouts, else the list repeated `rounds` times.
  const walk = useMemo<string[]>(() => {
    if (!exercises?.length) return []
    if (template?.sequence?.length) return template.sequence
    const r = template?.rounds ?? 1
    return Array.from({ length: r }).flatMap(() => exercises.map((e) => e.id))
  }, [exercises, template?.sequence, template?.rounds])
  const [pos, setPos] = useState(0)
  useEffect(() => setPos(0), [sessionId])
  useEffect(() => {
    if (open === null && walk.length && !showRecap) setOpen(walk[0])
  }, [walk, open, showRecap])

  // Round of the exercise currently at `pos` (nth time it appears in the walk).
  const curId = walk[pos]
  const roundOf = (upto: number) =>
    walk.slice(0, upto + 1).filter((id) => id === walk[upto]).length
  const totalRoundsOf = (id: string) => walk.filter((x) => x === id).length
  const curRound = curId ? roundOf(pos) : 1
  const curTotal = curId ? totalRoundsOf(curId) : 1

  // Capture GPS once, when a workout is freshly started on this device.
  const triedGeo = useRef(false)
  useEffect(() => {
    if (!session || triedGeo.current) return
    const fresh =
      session.deviceId === getDeviceId() &&
      session.lat == null &&
      Date.now() - session.createdAt < 5 * 60 * 1000
    if (fresh && !sessionStorage.getItem(`geo-${session.id}`)) {
      triedGeo.current = true
      sessionStorage.setItem(`geo-${session.id}`, '1')
      void capturePosition(session.id, !session.location)
    }
  }, [session])

  const live = (sets ?? []).filter((s) => !s.deleted)
  const totalSets = live.length
  const totalReps = live.reduce((a, s) => a + s.reps, 0)
  const tonnage = live.reduce(
    (a, s) => a + (s.weightKg ? s.reps * s.weightKg : 0),
    0,
  )

  function handleLogged(exerciseId: string) {
    if (!walk.length) return
    // Advance from this exercise's slot in the walk to the next slot.
    let from = walk.indexOf(exerciseId, pos)
    if (from === -1) from = pos
    const nextPos = from + 1
    if (nextPos < walk.length) {
      setPos(nextPos)
      setOpen(walk[nextPos])
    } else {
      setOpen(null)
      setShowRecap(true)
    }
  }

  async function handleDelete() {
    const ok = window.confirm(
      'Delete this session? Its logged sets are removed too.',
    )
    if (!ok) return
    await deleteSession(sessionId)
    onBack()
  }

  if (showRecap) {
    return (
      <Recap
        sessionId={sessionId}
        onBack={() => setShowRecap(false)}
        onExit={onBack}
      />
    )
  }

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
          <div className="flex items-center gap-2 leading-tight font-semibold capitalize">
            {template?.name ?? '…'}
            {curTotal > 1 && (
              <span className="rounded bg-sky-500/20 px-1.5 py-0.5 font-mono text-xs font-medium tracking-wide text-sky-300">
                round {curRound}/{curTotal}
              </span>
            )}
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
        <button
          onClick={() => setShowRecap(true)}
          aria-label="finish workout"
          title="finish — recap vs previous sessions"
          className="text-emerald-400 active:text-emerald-300"
        >
          <Flag size={18} />
        </button>
        <button
          onClick={handleDelete}
          aria-label="delete session"
          title="delete this session"
          className="text-zinc-600 active:text-rose-400"
        >
          <Trash2 size={18} />
        </button>
      </div>

      <div className="space-y-2.5 px-4 pt-4 pb-24">
        {session && <SessionMeta session={session} />}
        {exercises?.map((ex) => (
          <ExerciseCard
            key={ex.id}
            exercise={ex}
            sessionId={sessionId}
            isOpen={open === ex.id}
            onToggle={() => setOpen(open === ex.id ? null : ex.id)}
            onLogged={handleLogged}
          />
        ))}
      </div>
    </div>
  )
}
