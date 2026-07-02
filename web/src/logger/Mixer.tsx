import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, PlayCircle, Shuffle, Sparkles } from 'lucide-react'
import { db } from '../db'
import type { Exercise } from '../db'
import { startOrResumeSession } from '../db/repo'
import {
  baseCandidates,
  exerciseStatsMap,
  generateMix,
  type Focus,
  type Intensity,
  type MixResult,
} from './mixer'

/*
 * Mixer — pick a focus + intensity and the app remixes one of your routines:
 * same structure (so its video keeps the pace), fresh exercises for variety,
 * targets from your own history. "Start" opens it in the logger like any
 * workout, pre-filled with the targets.
 */

const ACCENT = '#ff5cc8'
const FOCI: { id: Focus; label: string }[] = [
  { id: 'upper', label: 'Upper' },
  { id: 'lower', label: 'Lower' },
  { id: 'total', label: 'Total' },
]
const INTENSITIES: { id: Intensity; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'medium', label: 'Medium' },
  { id: 'hard', label: 'Hard' },
]
const REGION_COLOR: Record<string, string> = {
  upper: '#33cbff',
  lower: '#34f5a0',
  core: '#b26bff',
  total: '#ff9636',
}
const MUSCLE_LABEL: Record<string, string> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  quads: 'Quads',
  hamsglutes: 'Glutes',
  calves: 'Calves',
  core: 'Core',
  total: 'Total',
}

export function Mixer({
  onStart,
  onBack,
}: {
  onStart: (sessionId: string) => void
  onBack: () => void
}) {
  const sessions = useLiveQuery(() => db.sessions.toArray())
  const sets = useLiveQuery(() => db.sets.toArray())
  const exercises = useLiveQuery(() => db.exercises.toArray())
  const templates = useLiveQuery(() => db.templates.toArray())

  const [focus, setFocus] = useState<Focus>('total')
  const [intensity, setIntensity] = useState<Intensity>('medium')
  const [nonce, setNonce] = useState(0)
  const [mix, setMix] = useState<MixResult | null>(null)
  const [starting, setStarting] = useState(false)

  const exById = useMemo(
    () => new Map((exercises ?? []).map((e) => [e.id, e] as const)),
    [exercises],
  )
  const stats = useMemo(
    () =>
      sets && sessions ? exerciseStatsMap(sets, sessions, exById) : new Map(),
    [sets, sessions, exById],
  )
  const logged = useMemo(() => {
    if (!exercises || !sets) return [] as Exercise[]
    const ids = new Set(sets.filter((s) => !s.deleted).map((s) => s.exerciseId))
    return exercises.filter((e) => ids.has(e.id))
  }, [exercises, sets])

  useEffect(() => {
    if (!templates || !logged.length) return
    const bases = baseCandidates(templates, exById, focus)
    if (!bases.length) return setMix(null)
    const base = bases[Math.floor(Math.random() * bases.length)]
    setMix(generateMix(base, intensity, exById, logged, stats, Date.now()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, intensity, nonce, templates, logged.length])

  async function start() {
    if (!mix) return
    setStarting(true)
    await db.templates.put(mix.template)
    const id = await startOrResumeSession(mix.template.id)
    onStart(id)
  }

  const Segment = <T extends string>({
    value,
    options,
    onChange,
  }: {
    value: T
    options: { id: T; label: string }[]
    onChange: (v: T) => void
  }) => (
    <div className="flex gap-1 rounded-2xl border border-hair bg-black/25 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`press flex-1 rounded-xl py-2.5 text-sm font-semibold transition ${
            value === o.id ? 'text-[#06140d]' : 'text-ink-3'
          }`}
          style={value === o.id ? { background: ACCENT } : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  )

  return (
    <div className="mx-auto min-h-full max-w-md px-4 pt-3 pb-28">
      <button
        onClick={onBack}
        className="press mb-5 flex items-center gap-1 text-sm font-semibold text-ink-2"
      >
        <ChevronLeft size={18} /> Back
      </button>

      <div className="mb-5 flex items-center gap-2.5">
        <span
          className="flex h-11 w-11 items-center justify-center rounded-2xl"
          style={{ background: `${ACCENT}22`, color: ACCENT }}
        >
          <Sparkles size={22} />
        </span>
        <div>
          <h2 className="display text-2xl">Mixer</h2>
          <p className="text-[13px] text-ink-3">
            A fresh workout, paced by a video you know.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <div className="eyebrow mb-2">Focus</div>
          <Segment value={focus} options={FOCI} onChange={setFocus} />
        </div>
        <div>
          <div className="eyebrow mb-2">Intensity</div>
          <Segment
            value={intensity}
            options={INTENSITIES}
            onChange={setIntensity}
          />
        </div>
      </div>

      {mix ? (
        <>
          <div className="mt-5 card p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="eyebrow" style={{ color: ACCENT }}>
                  Paced by
                </div>
                <div className="text-lg font-bold capitalize">{mix.baseName}</div>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  Play the {mix.baseName} video for the pace — do these moves
                  instead.
                </p>
              </div>
              <button
                onClick={() => setNonce((n) => n + 1)}
                aria-label="shuffle"
                className="press flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/5 text-ink-2"
              >
                <Shuffle size={18} />
              </button>
            </div>

            <div className="mt-4 space-y-1.5">
              {mix.moves.map((m, i) => (
                <div
                  key={`${m.id}-${i}`}
                  className="flex items-center gap-2.5 rounded-xl bg-white/[0.03] px-3 py-2"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: REGION_COLOR[m.region] }}
                    title={m.region}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {m.name}
                    </span>
                    <span className="text-[11px] text-ink-3">
                      {MUSCLE_LABEL[m.muscle] ?? m.muscle}
                    </span>
                  </span>
                  <span className="nums shrink-0 text-sm font-bold text-ink">
                    {m.target}
                    <span className="text-xs font-normal text-ink-3">
                      {' '}
                      {m.unit}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={start}
            disabled={starting}
            className="press mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-bold text-[#06140d] disabled:opacity-60"
            style={{ background: ACCENT, boxShadow: `0 10px 28px -10px ${ACCENT}` }}
          >
            <PlayCircle size={19} strokeWidth={2.4} /> Start workout
          </button>
        </>
      ) : (
        <p className="mt-8 text-center text-sm text-ink-3">
          Log a few workouts first — the Mixer builds from your own history.
        </p>
      )}
    </div>
  )
}
