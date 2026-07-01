import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight } from 'lucide-react'
import { db } from '../db'
import { startOrResumeSession } from '../db/repo'
import { fmtDate, todayISO } from '../lib/id'
import { Label } from './ui'

/*
 * Home — pick a workout template (exercises in performed order), resume today's
 * session, or glance at recent sessions. Everything reads live from Dexie.
 */

export function Home({ onOpen }: { onOpen: (sessionId: string) => void }) {
  const templates = useLiveQuery(() => db.templates.orderBy('name').toArray())
  const today = todayISO()

  const todaySessions = useLiveQuery(
    () => db.sessions.where('date').equals(today).toArray(),
    [today],
  )
  const recent = useLiveQuery(() =>
    db.sessions.orderBy('createdAt').reverse().limit(5).toArray(),
  )
  // Non-deleted set counts per session, for the little "N sets" badges.
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

      <Label>Start a workout</Label>
      <div className="mt-2 space-y-2.5">
        {templates?.map((t) => (
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
    </div>
  )
}
