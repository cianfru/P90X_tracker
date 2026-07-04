import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Trash2, X } from 'lucide-react'
import { db } from '../db'
import type { BeastGroupKind, Exercise, WorkoutSet, WorkoutTemplate } from '../db'
import { logSetAt, softDeleteSet } from '../db/repo'
import { exerciseStats } from './effort'
import { Stepper } from './ui'

/*
 * Body Beast worksheet grid. Each set-group (Single / Super / Giant …) is a
 * block; each exercise is a row with a cell per set (S1 S2 S3 S4). Tap a cell to
 * log reps (+kg) for that set — in any order, so the A→B→A→B superset flow just
 * works. A filled cell shows its value; tap again to edit or clear it.
 */

const GROUP_LABEL: Record<BeastGroupKind, string> = {
  single: 'Single Set',
  super: 'Super Set',
  giant: 'Giant Set',
  circuit: 'Circuit Set',
  progressive: 'Progressive Set',
  force: 'Force Set',
  combo: 'Combo Set',
  multi: 'Multi Set',
}

export function BeastGrid({
  sessionId,
  template,
  exById,
  accent,
}: {
  sessionId: string
  template: WorkoutTemplate
  exById: Map<string, Exercise>
  accent: string
}) {
  const sets = useLiveQuery(
    () => db.sets.where('sessionId').equals(sessionId).toArray(),
    [sessionId],
  )

  // exId -> round -> latest live set in that slot
  const byExRound = useMemo(() => {
    const m = new Map<string, Map<number, WorkoutSet>>()
    for (const s of sets ?? []) {
      if (s.deleted) continue
      let r = m.get(s.exerciseId)
      if (!r) m.set(s.exerciseId, (r = new Map()))
      const prev = r.get(s.round)
      if (!prev || s.loggedAt >= prev.loggedAt) r.set(s.round, s)
    }
    return m
  }, [sets])

  const [editing, setEditing] = useState<{ id: string; round: number } | null>(
    null,
  )

  return (
    <div className="space-y-5">
      {(template.plan ?? []).map((g, gi) => (
        <div key={gi}>
          <div className="eyebrow mb-2" style={{ color: accent }}>
            {GROUP_LABEL[g.kind]}
          </div>
          <div className="card p-0">
            {g.items.map((item, ii) => {
              const ex = exById.get(item.id)
              const rounds = byExRound.get(item.id)
              return (
                <div
                  key={`${item.id}-${ii}`}
                  className={`px-3 py-3 ${ii > 0 ? 'border-t border-hair' : ''}`}
                >
                  <div className="mb-2 truncate text-sm font-semibold">
                    {ex?.displayName ?? ex?.name ?? item.id}
                  </div>
                  <div className="flex gap-1.5">
                    {Array.from({ length: item.sets }, (_, i) => i + 1).map(
                      (round) => {
                        const s = rounds?.get(round)
                        return (
                          <button
                            key={round}
                            onClick={() => setEditing({ id: item.id, round })}
                            className="press flex h-12 flex-1 flex-col items-center justify-center rounded-lg border"
                            style={
                              s
                                ? {
                                    borderColor: `${accent}80`,
                                    background: `${accent}1f`,
                                    color: accent,
                                  }
                                : { borderColor: 'var(--color-hair)' }
                            }
                          >
                            {s ? (
                              <span className="nums text-sm font-bold leading-none">
                                {s.reps}
                                {s.weightKg ? (
                                  <span className="text-[11px] font-medium">
                                    ×{s.weightKg}
                                  </span>
                                ) : null}
                              </span>
                            ) : (
                              <span className="nums text-xs text-ink-3">
                                {round}
                              </span>
                            )}
                          </button>
                        )
                      },
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {editing && exById.get(editing.id) && (
        <CellEditor
          sessionId={sessionId}
          exercise={exById.get(editing.id)!}
          round={editing.round}
          existing={byExRound.get(editing.id)?.get(editing.round) ?? null}
          accent={accent}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function CellEditor({
  sessionId,
  exercise,
  round,
  existing,
  accent,
  onClose,
}: {
  sessionId: string
  exercise: Exercise
  round: number
  existing: WorkoutSet | null
  accent: string
  onClose: () => void
}) {
  const weighted = exercise.type === 'weighted'
  const stats = useLiveQuery(
    () => exerciseStats(exercise.id, exercise.type),
    [exercise.id],
  )
  const [reps, setReps] = useState<number | null>(null)
  const [weight, setWeight] = useState<number | null>(null)

  // Prefill once: the existing cell → else this move's recent target → default.
  useEffect(() => {
    if (reps !== null) return
    if (existing) {
      setReps(existing.reps)
      setWeight(existing.weightKg ?? 20)
    } else if (stats) {
      setReps(stats.targetReps ?? (weighted ? 10 : 15))
      setWeight(stats.targetWeightKg ?? 20)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, existing])

  const save = async () => {
    await logSetAt({
      sessionId,
      exerciseId: exercise.id,
      round,
      reps: reps ?? 0,
      weightKg: weighted ? (weight ?? 0) : null,
    })
    onClose()
  }
  const clear = async () => {
    if (existing) await softDeleteSet(existing.id)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        aria-label="close"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <div className="frost relative mx-auto w-full max-w-md rounded-t-3xl border-t border-hair px-5 pt-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-[15px] font-bold">
              {exercise.displayName ?? exercise.name}
            </div>
            <div className="eyebrow mt-0.5" style={{ color: accent }}>
              Set {round}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="close"
            className="press flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-ink-2"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center justify-between gap-3">
          <Stepper
            label="reps"
            value={reps ?? 0}
            onChange={setReps}
            valueColor={accent}
          />
          {weighted && (
            <Stepper
              label="kg"
              value={weight ?? 0}
              onChange={setWeight}
              accent="sky"
            />
          )}
        </div>

        <div className="mt-5 flex gap-2">
          {existing && (
            <button
              onClick={clear}
              aria-label="clear set"
              className="press flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-hair text-ink-3 active:text-rose-400"
            >
              <Trash2 size={18} />
            </button>
          )}
          <button
            onClick={save}
            className="press flex flex-1 items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-bold text-[#06140d]"
            style={{ background: accent, boxShadow: `0 10px 28px -10px ${accent}99` }}
          >
            <Check size={18} strokeWidth={2.6} /> Save set {round}
          </button>
        </div>
      </div>
    </div>
  )
}
