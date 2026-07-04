import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight, Dumbbell } from 'lucide-react'
import { db } from '../db'
import type { Program } from '../db'
import { startOrResumeSession } from '../db/repo'
import { auraFor, programAccent, setAura } from './programColor'
import { todayISO } from '../lib/id'
import { Label } from './ui'
import { useSwipeBack } from '../lib/gestures'

/*
 * Home — pure workout picker: first pick a program (P90X / P90X2 / P90X3 /
 * Body Beast) or the Mixer, then pick a workout from that program. Resume-today
 * stays as a shortcut to an in-progress session. Bodyweight and history live in
 * the Account and Progress screens; the home stays focused on starting a workout.
 */

const PROGRAMS: Program[] = ['P90X', 'P90X2', 'P90X3', 'Body Beast']

/* Official logos (keyed transparent) shown on the program buttons in place of
   text — the landing page reads as a clean stack of brand marks. A program
   without a logo falls back to styled text. */
const PROGRAM_LOGO: Partial<Record<Program, string>> = {
  P90X: '/logo-p90x.png',
  P90X2: '/logo-p90x2.png',
  P90X3: '/logo-p90x3.png',
  'Body Beast': '/logo-bodybeast.png', // full lockup on the button
}

/* Inside a program's section the drill-in header prefers a simpler mark:
   Body Beast shows just the "BODY BEAST" wordmark (no gorilla / dumbbells). */
const PROGRAM_LOGO_MARK: Partial<Record<Program, string>> = {
  'Body Beast': '/logo-bodybeast-mark.png',
}
const sectionLogo = (p: Program): string | undefined =>
  PROGRAM_LOGO_MARK[p] ?? PROGRAM_LOGO[p]

export function Home({
  onOpen,
  onMix,
}: {
  onOpen: (sessionId: string) => void
  onMix: () => void
}) {
  const templates = useLiveQuery(() => db.templates.orderBy('name').toArray())
  const [programId, setProgramId] = useState<Program | null>(null)
  // Paint the aura the selected program's colour (green on the main list).
  useEffect(() => setAura(auraFor(programId)), [programId])
  // Edge-swipe from a program's workout list back to the program picker.
  useSwipeBack(() => setProgramId(null), programId !== null)
  const program = programId
    ? { id: programId, accent: programAccent(programId) }
    : null
  const today = todayISO()

  const todaySessions = useLiveQuery(
    async () =>
      (await db.sessions.where('date').equals(today).toArray()).filter(
        (s) => !s.deleted,
      ),
    [today],
  )
  const counts = useLiveQuery(async () => {
    const ids = (todaySessions ?? []).map((s) => s.id)
    const entries = await Promise.all(
      ids.map(async (id) => {
        const rows = await db.sets.where('sessionId').equals(id).toArray()
        return [id, rows.filter((r) => !r.deleted).length] as const
      }),
    )
    return Object.fromEntries(entries) as Record<string, number>
  }, [todaySessions])

  const nameFor = (workoutId: string) =>
    templates?.find((t) => t.id === workoutId)?.name ?? workoutId

  async function start(workoutId: string) {
    onOpen(await startOrResumeSession(workoutId))
  }

  // ---- Step 2: workouts within the chosen program ----
  if (program) {
    const workouts = (templates ?? []).filter((t) => t.program === program.id)
    return (
      <div className="pt-3">
        <button
          onClick={() => setProgramId(null)}
          className="press mb-5 flex items-center gap-1 text-sm font-semibold text-ink-2"
        >
          <ChevronLeft size={18} /> Programs
        </button>
        <h2 className="display flex items-center gap-2.5 text-2xl">
          {sectionLogo(program.id) ? (
            <img
              src={sectionLogo(program.id)}
              alt={program.id}
              className="max-h-9 w-auto object-contain"
            />
          ) : (
            program.id
          )}
          <span
            className="align-middle text-sm font-semibold"
            style={{ color: program.accent }}
          >
            {workouts.length} workouts
          </span>
        </h2>
        {workouts.length === 0 && (
          <div className="card mt-5 border-dashed px-4 py-10 text-center">
            <p className="font-semibold text-ink">No workouts yet</p>
            <p className="mt-1 text-[13px] text-ink-3">
              {program.id} routines land here once the full sheet is added.
            </p>
          </div>
        )}
        <div className="mt-4 space-y-2.5">
          {workouts.map((t) => (
            <button
              key={t.id}
              onClick={() => start(t.id)}
              className="press card flex w-full items-center gap-3 px-4 py-4 text-left"
            >
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                style={{
                  background: `${program.accent}1f`,
                  color: program.accent,
                }}
              >
                <Dumbbell size={20} strokeWidth={2.4} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold capitalize">
                  {t.name}
                </span>
                <span className="nums block text-[13px] text-ink-3">
                  {t.exerciseIds.length} moves
                  {(t.rounds ?? 1) > 1
                    ? ` · ${t.rounds} rounds`
                    : t.sequence
                      ? ' · mixed rounds'
                      : ''}
                </span>
              </span>
              <ChevronRight size={18} className="shrink-0 text-ink-3" />
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ---- Step 1: choose a program (+ resume / recent shortcuts) ----
  const countFor = (p: Program) =>
    (templates ?? []).filter((t) => t.program === p).length

  return (
    <div className="pt-3">
      {(todaySessions?.length ?? 0) > 0 && (
        <div className="mb-7">
          <Label>Resume today</Label>
          <div className="mt-2.5 space-y-2">
            {todaySessions?.map((s) => (
              <button
                key={s.id}
                onClick={() => onOpen(s.id)}
                className="press flex w-full items-center justify-between rounded-2xl border border-[#37e29a]/30 bg-[#37e29a]/10 px-4 py-3.5"
              >
                <span className="font-semibold text-[#8ff0c6] capitalize">
                  {nameFor(s.workoutId)}
                </span>
                <span className="nums flex items-center gap-1 text-[13px] font-medium text-[#37e29a]">
                  {counts?.[s.id] ?? 0} sets <ChevronRight size={15} />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <Label>Choose a program</Label>
      <div className="mt-2.5 space-y-2.5">
        {PROGRAMS.map((p) => {
          const accent = programAccent(p)
          const logo = PROGRAM_LOGO[p]
          return (
            <button
              key={p}
              onClick={() => setProgramId(p)}
              className="press card flex w-full items-center gap-3 px-5 py-5 text-left"
            >
              {!logo && (
                <span
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
                  style={{
                    background: `linear-gradient(160deg, ${accent}33, ${accent}14)`,
                    color: accent,
                    boxShadow: `inset 0 0 0 1px ${accent}33`,
                  }}
                >
                  <Dumbbell size={22} strokeWidth={2.4} />
                </span>
              )}
              <span className="flex min-w-0 flex-1 items-center">
                {logo ? (
                  <img
                    src={logo}
                    alt={p}
                    className="max-h-12 w-auto max-w-full object-contain object-left"
                  />
                ) : (
                  <span className="text-xl font-bold tracking-tight">{p}</span>
                )}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="nums text-sm font-semibold text-ink-2">
                  {countFor(p)}
                </span>
                <ChevronRight size={18} className="text-ink-3" />
              </span>
            </button>
          )
        })}
      </div>

      {/* Mixer — auto-generated variety, paced by a video you know. */}
      <button
        onClick={onMix}
        aria-label="Mix a workout"
        className="press mt-3 block w-full overflow-hidden rounded-2xl border border-[#c6f24a]/35 bg-black/30"
      >
        <img
          src="/mix-banner.png"
          alt="Mix a workout"
          className="block h-[88px] w-full select-none object-cover"
        />
      </button>
    </div>
  )
}
