import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Flame, X } from 'lucide-react'
import type { Exercise, Modifier } from '../db'
import { MODIFIERS, MODIFIER_META } from '../db'
import { lastSetFor, logSet, sessionExerciseSets, softDeleteSet } from '../db/repo'
import { Chip, Stepper } from './ui'

/*
 * One exercise in a session: collapsed shows logged sets + last-time target;
 * open shows reps/weight steppers, typed modifier chips, a struggle toggle, and
 * a two-tap "Log set". Writes go straight to Dexie; the set list is live.
 */
export function ExerciseCard({
  exercise,
  sessionId,
  isOpen,
  onToggle,
}: {
  exercise: Exercise
  sessionId: string
  isOpen: boolean
  onToggle: () => void
}) {
  const weighted = exercise.type === 'weighted'
  const sets =
    useLiveQuery(
      () => sessionExerciseSets(sessionId, exercise.id),
      [sessionId, exercise.id],
    ) ?? []
  const last = useLiveQuery(() => lastSetFor(exercise.id), [exercise.id])

  const [reps, setReps] = useState(weighted ? 10 : 20)
  const [weight, setWeight] = useState(20)
  const [mods, setMods] = useState<Modifier[]>([])
  const [struggle, setStruggle] = useState(false)
  const touched = useRef(false)

  // Pre-fill from the last time this move was done, until the user adjusts.
  useEffect(() => {
    if (last && !touched.current) {
      setReps(last.reps)
      if (last.weightKg != null) setWeight(last.weightKg)
    }
  }, [last])

  const round = sets.length + 1
  const label = exercise.displayName ?? exercise.name

  const changeReps = (v: number) => {
    touched.current = true
    setReps(v)
  }
  const changeWeight = (v: number) => {
    touched.current = true
    setWeight(v)
  }
  const toggleMod = (m: Modifier) =>
    setMods((p) => (p.includes(m) ? p.filter((x) => x !== m) : [...p, m]))

  async function log() {
    await logSet({
      sessionId,
      exerciseId: exercise.id,
      reps,
      weightKg: weighted ? weight : null,
      modifiers: mods,
      struggle,
    })
    setMods([])
    setStruggle(false)
  }

  return (
    <div
      className={`rounded-2xl border transition ${
        isOpen ? 'border-zinc-700 bg-zinc-900' : 'border-zinc-800 bg-zinc-900/50'
      }`}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3.5"
      >
        <div className="flex items-center gap-2.5 text-left">
          <span className="font-semibold">{label}</span>
          {sets.length > 0 && (
            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-xs text-emerald-400">
              {sets.length}×
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {sets.length === 0 && last && (
            <span className="font-mono text-xs text-zinc-500">
              last {last.reps}
              {weighted && last.weightKg ? `×${last.weightKg}` : ''}
            </span>
          )}
          <div className="flex gap-1">
            {sets.map((s) => (
              <span
                key={s.id}
                className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-300"
              >
                {s.reps}
                {s.weightKg ? `×${s.weightKg}` : ''}
                {s.struggle ? '·' : ''}
              </span>
            ))}
          </div>
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-zinc-800/70 px-4 pt-1 pb-4">
          <div className="mt-3 flex items-center justify-between gap-3">
            <Stepper
              label={`reps · R${round}`}
              value={reps}
              onChange={changeReps}
              accent="emerald"
            />
            {weighted && (
              <Stepper
                label="kg"
                value={weight}
                onChange={changeWeight}
                accent="sky"
              />
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {MODIFIERS.map((m) => {
              const meta = MODIFIER_META[m]
              return (
                <Chip
                  key={m}
                  active={mods.includes(m)}
                  tone={meta.tone}
                  onClick={() => toggleMod(m)}
                  title={meta.hint}
                >
                  {meta.label}
                </Chip>
              )
            })}
            <Chip
              active={struggle}
              tone="rose"
              onClick={() => setStruggle((v) => !v)}
              title="hard set"
            >
              <Flame size={11} className="-mt-0.5 inline" />
            </Chip>
          </div>

          <button
            onClick={log}
            className="mt-3.5 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 font-bold text-zinc-950 transition active:scale-95"
          >
            <Check size={18} /> Log set R{round}
          </button>

          {sets.length > 0 && (
            <div className="mt-3 space-y-1">
              {sets.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded-lg bg-zinc-950/50 px-3 py-1.5 font-mono text-xs text-zinc-400"
                >
                  <span>
                    R{s.round} · {s.reps}
                    {s.weightKg ? `×${s.weightKg}kg` : ' reps'}
                    {s.modifiers.length
                      ? ' · ' +
                        s.modifiers.map((m) => MODIFIER_META[m].label).join(',')
                      : ''}
                    {s.struggle ? ' · 🔥' : ''}
                  </span>
                  <button
                    onClick={() => softDeleteSet(s.id)}
                    aria-label="remove set"
                    className="text-zinc-600 active:text-rose-400"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
