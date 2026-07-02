import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowRight, Flame, Weight, X } from 'lucide-react'
import type { Exercise, Modifier } from '../db'
import { MODIFIERS, MODIFIER_META } from '../db'
import { logSet, sessionExerciseSets, softDeleteSet } from '../db/repo'
import { effortOf, effortTone, exerciseStats } from './effort'
import type { EffortTone, HistEntry } from './effort'
import { fmtDate } from '../lib/id'
import { Chip, Stepper } from './ui'

/*
 * One exercise in a session. Open card shows:
 *  - stat chips (prev / avg / max / min) + the last 4 sessions for this move
 *  - reps (+kg for weighted moves, optional vest/belt kg for bodyweight ones)
 *  - modifier chips and a struggle toggle
 *  - a LIVE effort colour (green ≤ your recent average, amber = pushing,
 *    red = at/over your all-time max) driven by the effort engine
 *  - "Log & next": one tap logs the set and advances to the next exercise.
 */

const TONE_TEXT: Record<EffortTone, string> = {
  ok: 'text-emerald-400',
  push: 'text-amber-400',
  record: 'text-rose-400',
  none: 'text-emerald-400',
}
const TONE_BTN: Record<EffortTone, string> = {
  ok: 'bg-emerald-500',
  push: 'bg-amber-500',
  record: 'bg-rose-500',
  none: 'bg-emerald-500',
}

function histLabel(h: HistEntry): string {
  const mods = h.modifiers.map((m) => MODIFIER_META[m].label).join(',')
  return `${h.reps}${h.weightKg ? `×${h.weightKg}` : ''}${mods ? ` ·${mods}` : ''}`
}

export function ExerciseCard({
  exercise,
  sessionId,
  isOpen,
  onToggle,
  onLogged,
}: {
  exercise: Exercise
  sessionId: string
  isOpen: boolean
  onToggle: () => void
  onLogged?: (exerciseId: string) => void
}) {
  const weighted = exercise.type === 'weighted'
  const sets =
    useLiveQuery(
      () => sessionExerciseSets(sessionId, exercise.id),
      [sessionId, exercise.id],
    ) ?? []
  const stats = useLiveQuery(
    () => exerciseStats(exercise.id, exercise.type),
    [exercise.id, exercise.type],
  )

  const [reps, setReps] = useState(weighted ? 10 : 20)
  const [weight, setWeight] = useState(20)
  const [vestOn, setVestOn] = useState(false)
  const [vestKg, setVestKg] = useState(10)
  const [mods, setMods] = useState<Modifier[]>([])
  const [struggle, setStruggle] = useState(false)
  const touched = useRef(false)
  const cardRef = useRef<HTMLDivElement>(null)

  // Pre-fill from the recent standard average (the "target"), until adjusted.
  useEffect(() => {
    if (stats && !touched.current) {
      if (stats.targetReps != null) setReps(stats.targetReps)
      if (weighted && stats.targetWeightKg != null) setWeight(stats.targetWeightKg)
    }
  }, [stats, weighted])

  // Log-&-next opens the next card programmatically — bring it into view.
  useEffect(() => {
    if (isOpen) {
      cardRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [isOpen])

  const round = sets.length + 1
  const label = exercise.displayName ?? exercise.name
  const addedKg = !weighted && vestOn ? vestKg : null
  const currentEffort = effortOf(
    { reps, weightKg: weighted ? weight : addedKg, modifiers: mods },
    exercise.type,
  )
  const tone: EffortTone = stats ? effortTone(currentEffort, stats) : 'none'

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
      weightKg: weighted ? weight : addedKg,
      modifiers: mods,
      struggle,
    })
    setMods([])
    setStruggle(false)
    setVestOn(false)
    onLogged?.(exercise.id)
  }

  return (
    <div
      ref={cardRef}
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
          {sets.length === 0 && stats?.prev && (
            <span className="font-mono text-xs text-zinc-500">
              last {histLabel(stats.prev)}
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
          {/* Stat chips: prev / avg (target) / max / min — standard baseline */}
          {stats && stats.history.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5 font-mono text-xs">
              {stats.prev && (
                <span className="rounded-md bg-sky-500/10 px-2 py-1 text-sky-300">
                  prev {histLabel(stats.prev)}
                </span>
              )}
              {(weighted ? stats.targetWeightKg : stats.targetReps) != null && (
                <span className="rounded-md bg-emerald-500/10 px-2 py-1 text-emerald-300">
                  avg {weighted ? stats.targetWeightKg : stats.targetReps}
                </span>
              )}
              {stats.maxRaw != null && (
                <span className="rounded-md bg-amber-500/10 px-2 py-1 text-amber-300">
                  max {stats.maxRaw}
                </span>
              )}
              {stats.minRaw != null && (
                <span className="rounded-md bg-zinc-500/10 px-2 py-1 text-zinc-400">
                  min {stats.minRaw}
                </span>
              )}
            </div>
          )}

          {/* Last sessions for this move */}
          {stats && stats.history.length > 1 && (
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-xs text-zinc-500">
              {stats.history.map((h, i) => (
                <div key={i} className="flex justify-between">
                  <span>{fmtDate(h.date)}</span>
                  <span className="text-zinc-300">{histLabel(h)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between gap-3">
            <Stepper
              label={`reps · R${round}`}
              value={reps}
              onChange={changeReps}
              valueClass={TONE_TEXT[tone]}
            />
            {weighted && (
              <Stepper
                label="kg"
                value={weight}
                onChange={changeWeight}
                accent="sky"
              />
            )}
            {!weighted && vestOn && (
              <Stepper
                label="vest kg"
                value={vestKg}
                onChange={setVestKg}
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
            {!weighted && (
              <Chip
                active={vestOn}
                tone="sky"
                onClick={() => setVestOn((v) => !v)}
                title="weighted vest / belt"
              >
                <Weight size={11} className="-mt-0.5 inline" /> +kg
              </Chip>
            )}
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
            className={`mt-3.5 flex w-full items-center justify-center gap-2 rounded-xl py-3 font-bold text-zinc-950 transition active:scale-95 ${TONE_BTN[tone]}`}
          >
            Log & next <ArrowRight size={18} />
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
