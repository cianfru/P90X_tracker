import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowRight, Flame, Plus, Weight, X } from 'lucide-react'
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

/** Live effort colour: baseline uses the program accent; amber = pushing above
 *  your recent average; rose = at/over your all-time max. */
function toneHex(tone: EffortTone, accent: string): string {
  if (tone === 'push') return '#fbbf24'
  if (tone === 'record') return '#fb7185'
  return accent
}

function histLabel(h: HistEntry): string {
  const mods = h.modifiers.map((m) => MODIFIER_META[m].label).join(',')
  return `${h.reps}${h.weightKg ? `×${h.weightKg}` : ''}${mods ? ` ·${mods}` : ''}`
}

export function ExerciseCard({
  exercise,
  sessionId,
  accent,
  target,
  isOpen,
  onToggle,
  onLogged,
}: {
  exercise: Exercise
  sessionId: string
  accent: string
  /** Mixer pre-fill target (reps/weight) — overrides the history default. */
  target?: { reps?: number; weightKg?: number }
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

  // Pre-fill: a Mixer target wins; otherwise the recent standard average.
  useEffect(() => {
    if (touched.current) return
    if (target) {
      if (target.reps != null) setReps(target.reps)
      if (weighted && target.weightKg != null) setWeight(target.weightKg)
      return
    }
    if (stats) {
      if (stats.targetReps != null) setReps(stats.targetReps)
      if (weighted && stats.targetWeightKg != null) setWeight(stats.targetWeightKg)
    }
  }, [stats, weighted, target])

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
  const toneColor = toneHex(tone, accent)

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

  async function commit() {
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
  }
  // Log this set and advance to the next exercise (the circuit flow).
  async function logNext() {
    await commit()
    onLogged?.(exercise.id)
  }
  // Log this set but STAY on the exercise — for set-based moves (e.g. Body
  // Beast) where you do several sets before moving on. The card reopens the
  // next round automatically.
  async function logStay() {
    await commit()
  }

  return (
    <div
      ref={cardRef}
      className={`press overflow-hidden rounded-2xl border transition ${
        isOpen
          ? 'border-hair-2 bg-surface shadow-[0_12px_32px_-16px_rgba(0,0,0,0.7)]'
          : 'border-hair bg-white/[0.02]'
      }`}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-4"
      >
        <div className="flex items-center gap-2.5 text-left">
          <span className="font-semibold">{label}</span>
          {sets.length > 0 && (
            <span
              className="nums rounded-full px-2 py-0.5 text-xs font-bold"
              style={{ background: `${accent}30`, color: accent }}
            >
              {sets.length}×
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {sets.length === 0 && stats?.prev && (
            <span className="nums text-xs text-ink-3">
              last {histLabel(stats.prev)}
            </span>
          )}
          <div className="flex gap-1">
            {sets.map((s) => (
              <span
                key={s.id}
                className="nums rounded-md bg-white/5 px-1.5 py-0.5 text-xs font-medium text-ink-2"
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
        <div className="border-t border-hair px-4 pt-1 pb-4">
          {/* Stat chips: prev / avg (target) / max / min — standard baseline */}
          {stats && stats.history.length > 0 && (
            <div className="nums mt-3 flex flex-wrap gap-1.5 text-xs font-semibold">
              {stats.prev && (
                <span className="rounded-lg bg-sky-400/10 px-2.5 py-1 text-sky-300">
                  prev {histLabel(stats.prev)}
                </span>
              )}
              {(weighted ? stats.targetWeightKg : stats.targetReps) != null && (
                <span
                  className="rounded-lg px-2.5 py-1"
                  style={{ background: `${accent}1f`, color: accent }}
                >
                  avg {weighted ? stats.targetWeightKg : stats.targetReps}
                </span>
              )}
              {stats.maxRaw != null && (
                <span className="rounded-lg bg-amber-400/10 px-2.5 py-1 text-amber-300">
                  max {stats.maxRaw}
                </span>
              )}
              {stats.minRaw != null && (
                <span className="rounded-lg bg-white/[0.06] px-2.5 py-1 text-ink-3">
                  min {stats.minRaw}
                </span>
              )}
            </div>
          )}

          {/* Last sessions for this move */}
          {stats && stats.history.length > 1 && (
            <div className="nums mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-3">
              {stats.history.map((h, i) => (
                <div key={i} className="flex justify-between">
                  <span>{fmtDate(h.date)}</span>
                  <span className="font-medium text-ink-2">{histLabel(h)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between gap-3">
            <Stepper
              label={`reps · R${round}`}
              value={reps}
              onChange={changeReps}
              valueColor={toneColor}
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

          <div className="mt-4 flex gap-2">
            <button
              onClick={logStay}
              aria-label="log set and stay for another"
              title="log this set, stay for another"
              className="press flex shrink-0 items-center justify-center gap-1 rounded-2xl border px-4 py-3.5 text-[15px] font-bold"
              style={{ borderColor: `${toneColor}66`, color: toneColor }}
            >
              <Plus size={18} strokeWidth={2.6} /> Set
            </button>
            <button
              onClick={logNext}
              className="press flex flex-1 items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-bold text-[#06140d]"
              style={{
                background: toneColor,
                boxShadow: `0 8px 24px -8px ${toneColor}99`,
              }}
            >
              Log &amp; next <ArrowRight size={18} strokeWidth={2.6} />
            </button>
          </div>

          {sets.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {sets.map((s) => (
                <div
                  key={s.id}
                  className="nums flex items-center justify-between rounded-xl bg-black/25 px-3 py-2 text-xs text-ink-2"
                >
                  <span>
                    <span className="font-semibold text-ink-3">R{s.round}</span>{' '}
                    · {s.reps}
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
                    className="text-ink-3 active:text-rose-400"
                  >
                    <X size={15} />
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
