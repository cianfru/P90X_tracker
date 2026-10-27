import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowRight, Flame, Plus, Weight, X } from 'lucide-react'
import type { Exercise, Modifier, Session } from '../db'
import { MODIFIERS, MODIFIER_META } from '../db'
import { logSet, sessionExerciseSets, softDeleteSet } from '../db/repo'
import { effortOf } from './effort'
import { lastTimeFor, prevSetAt, type PrevSet } from './lastTime'
import { fmtDate } from '../lib/id'
import { Chip, Stepper } from './ui'

/*
 * One performed slot of the routine. The open card is built for speed:
 *
 *  - it opens already holding what you did LAST TIME on this set of this
 *    workout — reps, kg and modifiers — so a repeat is a single tap;
 *  - any number can be typed (tap it) or nudged (− / +);
 *  - the colour says how today compares: accent = matching last time,
 *    amber = beating it, rose = best ever in this workout.
 *
 * "Log & next" logs and opens the card below; "+ Set" logs and stays.
 */

type Tone = 'ok' | 'push' | 'record'

function toneHex(tone: Tone, accent: string): string {
  if (tone === 'push') return '#fbbf24'
  if (tone === 'record') return '#fb7185'
  return accent
}

function setLabel(s: PrevSet): string {
  const mods = s.modifiers.map((m) => MODIFIER_META[m].label).join(',')
  return `${s.reps}${s.weightKg ? `×${s.weightKg}` : ''}${mods ? ` ·${mods}` : ''}`
}

export function ExerciseCard({
  exercise,
  session,
  accent,
  target,
  round,
  rounds,
  isOpen,
  onToggle,
  onLogged,
}: {
  exercise: Exercise
  session: Session
  accent: string
  /** Mixer pre-fill target (reps/weight) — overrides last time. */
  target?: { reps?: number; weightKg?: number }
  /** Which time round this move comes up, and how many times in total. Only
   *  shown when a move is performed more than once in the routine. */
  round?: number
  rounds?: number
  isOpen: boolean
  onToggle: () => void
  onLogged?: (exerciseId: string) => void
}) {
  const weighted = exercise.type === 'weighted'
  const sessionId = session.id
  const allSets =
    useLiveQuery(
      () => sessionExerciseSets(sessionId, exercise.id),
      [sessionId, exercise.id],
    ) ?? []
  // A move done in separate rounds has one card per round, and each card
  // shows only its own set(s): set N belongs to round N, and any extra sets
  // added with "+ Set" stay on the last round's card.
  const repeated = !!rounds && rounds > 1
  const r = round ?? 1
  const sets = repeated
    ? allSets.filter((_, i) => (r === rounds ? i >= r - 1 : i === r - 1))
    : allSets
  const last = useLiveQuery(
    () => lastTimeFor(session, exercise.id, exercise.type),
    [session.id, session.workoutId, session.date, session.createdAt, exercise.id],
  )

  const [reps, setReps] = useState(weighted ? 10 : 20)
  const [weight, setWeight] = useState(20)
  const [vestOn, setVestOn] = useState(false)
  const [vestKg, setVestKg] = useState(10)
  const [mods, setMods] = useState<Modifier[]>([])
  const [struggle, setStruggle] = useState(false)
  const touched = useRef(false)
  const cardRef = useRef<HTMLDivElement>(null)

  // Which set of this move the card is about to log: round N's first set is
  // set N even if you reach it first; after that, the next one in sequence.
  const setIndex = repeated && !sets.length ? r - 1 : allSets.length
  const prev = prevSetAt(last, setIndex)

  // Pre-fill: a Mixer target wins; otherwise the same set last time.
  useEffect(() => {
    if (touched.current) return
    if (target) {
      if (target.reps != null) setReps(target.reps)
      if (weighted && target.weightKg != null) setWeight(target.weightKg)
      return
    }
    if (!prev) return
    setReps(prev.reps)
    if (weighted) {
      // Last time without kg means no kg this time too, not a 20 kg default.
      setWeight(prev.weightKg ?? 0)
    } else {
      setVestOn(!!prev.weightKg)
      if (prev.weightKg) setVestKg(prev.weightKg)
    }
    setMods(prev.modifiers)
    // `prev` is derived from these; depending on the object would re-run on
    // every live-query refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last, setIndex, target, weighted])

  // Log-&-next opens the next card programmatically — bring it into view.
  useEffect(() => {
    if (isOpen) {
      cardRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [isOpen])

  const label = exercise.displayName ?? exercise.name
  const addedKg = !weighted && vestOn ? vestKg : null
  const now = { reps, weightKg: weighted ? weight : addedKg, modifiers: mods }
  const effort = effortOf(now, exercise.type)
  const prevEffort = prev ? effortOf(prev, exercise.type) : undefined
  const tone: Tone =
    last?.bestEffort != null && effort > last.bestEffort + 1e-9
      ? 'record'
      : prevEffort != null && effort > prevEffort + 1e-9
        ? 'push'
        : 'ok'
  const toneColor = toneHex(tone, accent)

  // What changed since last time, in the units you'd say it out loud.
  let delta: string | null = null
  if (prev) {
    const dKg = (now.weightKg ?? 0) - (prev.weightKg ?? 0)
    const dReps = reps - prev.reps
    const parts = []
    if (dReps) parts.push(`${dReps > 0 ? '+' : ''}${dReps} reps`)
    if (dKg) parts.push(`${dKg > 0 ? '+' : ''}${+dKg.toFixed(1)} kg`)
    delta = parts.length ? parts.join(' · ') : 'same as last time'
  }

  const touch = () => {
    touched.current = true
  }
  const toggleMod = (m: Modifier) => {
    touch()
    setMods((p) => (p.includes(m) ? p.filter((x) => x !== m) : [...p, m]))
  }

  async function commit() {
    await logSet({
      sessionId,
      exerciseId: exercise.id,
      reps,
      // 0 kg on a weighted move is stored as "no weight", like the history.
      weightKg: weighted ? weight || null : addedKg,
      modifiers: mods,
      struggle,
    })
    setStruggle(false)
    // Let the next set pre-fill from its own counterpart last time.
    touched.current = false
  }
  async function logNext() {
    await commit()
    onLogged?.(exercise.id)
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
        className="flex w-full items-center justify-between gap-3 px-4 py-4"
      >
        <div className="flex min-w-0 items-center gap-2.5 text-left">
          <span className="truncate font-semibold">{label}</span>
          {rounds && rounds > 1 && (
            <span className="nums shrink-0 rounded-full bg-white/[0.07] px-2 py-0.5 text-[11px] font-bold text-ink-3">
              {round}/{rounds}
            </span>
          )}
          {sets.length > 0 && (
            <span
              className="nums shrink-0 rounded-full px-2 py-0.5 text-xs font-bold"
              style={{ background: `${accent}30`, color: accent }}
            >
              {sets.length}×
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {sets.length === 0 && prev && (
            <span className="nums text-xs text-ink-3">last {setLabel(prev)}</span>
          )}
          <div className="flex gap-1">
            {sets.map((s) => (
              <span
                key={s.id}
                className="nums rounded-md bg-white/5 px-1.5 py-0.5 text-xs font-medium text-ink-2"
              >
                {s.reps}
                {s.weightKg ? `×${s.weightKg}` : ''}
              </span>
            ))}
          </div>
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-hair px-4 pt-3 pb-4">
          {/* Last time, this workout */}
          <div className="nums flex items-center justify-between gap-2 text-xs">
            {prev ? (
              <span className="rounded-lg bg-sky-400/10 px-2.5 py-1 font-semibold text-sky-300">
                last time {setLabel(prev)}
              </span>
            ) : (
              <span className="font-medium text-ink-3">
                First time in this workout
              </span>
            )}
            {delta && (
              <span className="font-semibold" style={{ color: toneColor }}>
                {tone === 'record' ? 'best ever · ' : ''}
                {delta}
              </span>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              void logNext()
            }}
            // Two numbers (reps + kg) stack, so each keeps a full-width
            // field and no digit hides behind the − / + buttons.
            className="mt-3 flex flex-col gap-3"
          >
            <Stepper
              label={`reps · set ${setIndex + 1}`}
              value={reps}
              onChange={(v) => {
                touch()
                setReps(v)
              }}
              valueColor={toneColor}
            />
            {weighted && (
              <Stepper
                label="kg"
                value={weight}
                decimal
                onChange={(v) => {
                  touch()
                  setWeight(v)
                }}
                accent="sky"
              />
            )}
            {!weighted && vestOn && (
              <Stepper
                label="vest kg"
                value={vestKg}
                decimal
                onChange={(v) => {
                  touch()
                  setVestKg(v)
                }}
                accent="sky"
              />
            )}
            <button type="submit" hidden aria-hidden tabIndex={-1} />
          </form>

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
                onClick={() => {
                  touch()
                  setVestOn((v) => !v)
                }}
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
              onClick={() => void commit()}
              aria-label="log set and stay for another"
              title="log this set, stay for another"
              className="press flex shrink-0 items-center justify-center gap-1 rounded-2xl border px-4 py-3.5 text-[15px] font-bold"
              style={{ borderColor: `${toneColor}66`, color: toneColor }}
            >
              <Plus size={18} strokeWidth={2.6} /> Set
            </button>
            <button
              onClick={() => void logNext()}
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
                    <span className="font-semibold text-ink-3">Set {s.round}</span>{' '}
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

          {/* This move in the previous sessions of THIS workout */}
          {last && last.sessions.length > 0 && (
            <div className="nums mt-3 space-y-1 border-t border-hair pt-3 text-xs text-ink-3">
              {last.sessions.map((p, i) => (
                <div key={i} className="flex justify-between gap-3">
                  <span className="shrink-0">{fmtDate(p.date)}</span>
                  <span className="truncate text-right font-medium text-ink-2">
                    {p.sets.map(setLabel).join('  ·  ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
