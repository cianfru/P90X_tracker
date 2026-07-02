import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight, Dumbbell, Minus, Plus } from 'lucide-react'
import { db } from '../db'
import type { Program } from '../db'
import { startOrResumeSession } from '../db/repo'
import { getBodyweight, setBodyweight } from './effort'
import { fmtDate, todayISO } from '../lib/id'
import { Label } from './ui'

/*
 * Home — two steps: first pick a program (P90X / P90X2 / P90X3 / Body Beast),
 * then pick a workout from that program. Resume-today and recent sessions
 * (which span all programs) stay on the program screen as shortcuts. Programs
 * with no workouts yet (Body Beast) show a "coming soon" slot. All reads live.
 */

const PROGRAMS: { id: Program; blurb: string; accent: string }[] = [
  {
    id: 'P90X',
    blurb: 'Classic resistance block',
    accent: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  },
  {
    id: 'P90X2',
    blurb: 'X2 stability & power block',
    accent: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  },
  {
    id: 'P90X3',
    blurb: '30-min resistance block',
    accent: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  },
  {
    id: 'Body Beast',
    blurb: 'Coming soon',
    accent: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  },
]

export function Home({ onOpen }: { onOpen: (sessionId: string) => void }) {
  const templates = useLiveQuery(() => db.templates.orderBy('name').toArray())
  const [program, setProgram] = useState<Program | null>(null)
  const [bw, setBw] = useState(getBodyweight())
  const today = todayISO()

  const changeBw = (delta: number) => {
    const v = Math.max(40, Math.min(200, bw + delta))
    setBw(v)
    setBodyweight(v)
  }

  const todaySessions = useLiveQuery(
    async () =>
      (await db.sessions.where('date').equals(today).toArray()).filter(
        (s) => !s.deleted,
      ),
    [today],
  )
  const recent = useLiveQuery(() =>
    db.sessions
      .orderBy('createdAt')
      .reverse()
      .filter((s) => !s.deleted)
      .limit(5)
      .toArray(),
  )
  const counts = useLiveQuery(async () => {
    const ids = [
      ...new Set([
        ...(todaySessions ?? []).map((s) => s.id),
        ...(recent ?? []).map((s) => s.id),
      ]),
    ]
    const entries = await Promise.all(
      ids.map(async (id) => {
        const rows = await db.sets.where('sessionId').equals(id).toArray()
        return [id, rows.filter((r) => !r.deleted).length] as const
      }),
    )
    return Object.fromEntries(entries) as Record<string, number>
  }, [todaySessions, recent])

  const nameFor = (workoutId: string) =>
    templates?.find((t) => t.id === workoutId)?.name ?? workoutId

  async function start(workoutId: string) {
    onOpen(await startOrResumeSession(workoutId))
  }

  // ---- Step 2: workouts within the chosen program ----
  if (program) {
    const workouts = (templates ?? []).filter((t) => t.program === program)
    return (
      <div className="pt-2">
        <button
          onClick={() => setProgram(null)}
          className="mb-4 flex items-center gap-1.5 font-mono text-sm text-zinc-400 active:text-zinc-200"
        >
          <ChevronLeft size={18} /> programs
        </button>
        <Label>{program} · start a workout</Label>
        {workouts.length === 0 && (
          <div className="mt-3 rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 px-4 py-8 text-center">
            <p className="font-semibold text-zinc-300">No workouts yet</p>
            <p className="mt-1 font-mono text-xs text-zinc-500">
              {program} routines land here once the full sheet is added.
            </p>
          </div>
        )}
        <div className="mt-2 space-y-2.5">
          {workouts.map((t) => (
            <button
              key={t.id}
              onClick={() => start(t.id)}
              className="flex w-full items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-4 transition hover:border-zinc-700 active:scale-95"
            >
              <span className="font-semibold capitalize">{t.name}</span>
              <span className="flex items-center gap-1 font-mono text-xs text-zinc-500">
                {t.exerciseIds.length} moves
                <ChevronRight size={14} />
              </span>
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
    <div className="pt-2">
      {(todaySessions?.length ?? 0) > 0 && (
        <div className="mb-6">
          <Label>Resume today</Label>
          {todaySessions?.map((s) => (
            <button
              key={s.id}
              onClick={() => onOpen(s.id)}
              className="mt-2 flex w-full items-center justify-between rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 transition active:scale-95"
            >
              <span className="font-semibold text-emerald-300 capitalize">
                {nameFor(s.workoutId)}
              </span>
              <span className="font-mono text-xs text-emerald-400/80">
                {counts?.[s.id] ?? 0} sets · continue →
              </span>
            </button>
          ))}
        </div>
      )}

      <Label>Choose a program</Label>
      <div className="mt-2 space-y-2.5">
        {PROGRAMS.map((p) => (
          <button
            key={p.id}
            onClick={() => setProgram(p.id)}
            className={`flex w-full items-center justify-between rounded-2xl border px-4 py-5 transition active:scale-95 ${p.accent}`}
          >
            <span className="flex items-center gap-3">
              <Dumbbell size={22} />
              <span className="text-left">
                <span className="block text-lg font-bold">{p.id}</span>
                <span className="block text-xs opacity-70">{p.blurb}</span>
              </span>
            </span>
            <span className="flex items-center gap-1 font-mono text-xs opacity-80">
              {countFor(p.id)} workouts
              <ChevronRight size={14} />
            </span>
          </button>
        ))}
      </div>

      {(recent?.length ?? 0) > 0 && (
        <div className="mt-7">
          <Label>Recent sessions</Label>
          <div className="mt-2 space-y-1.5">
            {recent?.map((s) => (
              <button
                key={s.id}
                onClick={() => onOpen(s.id)}
                className="flex w-full items-center justify-between rounded-xl bg-zinc-900/60 px-3.5 py-2.5 text-sm"
              >
                <span className="text-zinc-300 capitalize">
                  {nameFor(s.workoutId)}
                </span>
                <span className="font-mono text-xs text-zinc-500">
                  {fmtDate(s.date)} · {counts?.[s.id] ?? 0} sets
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bodyweight — feeds the effort colour coding (vest math, thresholds). */}
      <div className="mt-7 flex items-center justify-between rounded-xl border border-zinc-800/70 bg-zinc-900/40 px-3.5 py-2.5">
        <span className="font-mono text-xs tracking-wide text-zinc-500 uppercase">
          bodyweight
        </span>
        <span className="flex items-center gap-2">
          <button
            onClick={() => changeBw(-1)}
            aria-label="decrease bodyweight"
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-800 text-zinc-300 active:scale-95"
          >
            <Minus size={14} />
          </button>
          <span className="w-16 text-center font-mono text-sm text-zinc-200">
            {bw} kg
          </span>
          <button
            onClick={() => changeBw(1)}
            aria-label="increase bodyweight"
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-800 text-zinc-300 active:scale-95"
          >
            <Plus size={14} />
          </button>
        </span>
      </div>
    </div>
  )
}
