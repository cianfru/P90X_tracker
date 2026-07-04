import { useState } from 'react'
import { Check, ChevronLeft } from 'lucide-react'
import type { Session, Supplement } from '../db'
import { SUPPLEMENTS } from '../db'
import { updateSessionMeta } from '../db/repo'
import { Chip } from './ui'

/*
 * End-of-workout prompt. Shown when you finish a session (the flag, or logging
 * the last exercise): rate how it went, tick the supplements you took, jot a
 * note — then "End workout" moves on to the recap. "Keep going" returns you to
 * the logger to add more sets.
 */

const SUPP_LABEL: Record<Supplement, string> = {
  creatine: 'Creatine',
  protein: 'Protein',
  maca: 'Maca',
  aminos: 'Aminos',
}

export function SessionFinish({
  session,
  accent,
  onEnd,
  onBack,
}: {
  session: Session
  accent: string
  onEnd: () => void
  onBack: () => void
}) {
  const [notes, setNotes] = useState(session.notes ?? '')
  const form = session.form ?? null
  const supplements = session.supplements ?? []

  const setForm = (v: number | null) =>
    updateSessionMeta(session.id, { form: v ?? undefined })
  const toggleSupp = (s: Supplement) => {
    const next = supplements.includes(s)
      ? supplements.filter((x) => x !== s)
      : [...supplements, s]
    updateSessionMeta(session.id, { supplements: next.length ? next : undefined })
  }
  const commitNotes = (v: string) =>
    updateSessionMeta(session.id, { notes: v.trim() || undefined })

  return (
    <div className="mx-auto max-w-md px-4 pt-5 pb-28">
      <button
        onClick={onBack}
        className="press mb-5 flex items-center gap-1 text-sm font-semibold text-ink-2"
      >
        <ChevronLeft size={18} /> Keep going
      </button>

      <h2 className="display text-2xl">Finish workout?</h2>
      <p className="mt-1 text-[13px] text-ink-3">
        Log how it went, then see your recap.
      </p>

      <div className="card mt-5 space-y-6 p-4">
        {/* Rating */}
        <div>
          <div className="eyebrow mb-2">How was your workout? · rate 1–10</div>
          <div className="grid grid-cols-10 gap-1.5">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                onClick={() => setForm(form === n ? null : n)}
                className={`nums press flex aspect-square items-center justify-center rounded-xl border text-sm font-bold ${
                  form === n ? '' : 'border-hair bg-white/[0.04] text-ink-3'
                }`}
                style={
                  form === n
                    ? {
                        borderColor: `${accent}99`,
                        background: `${accent}22`,
                        color: accent,
                      }
                    : undefined
                }
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Supplements */}
        <div>
          <div className="eyebrow mb-2">Supplements</div>
          <div className="flex flex-wrap gap-1.5">
            {SUPPLEMENTS.map((s) => (
              <Chip
                key={s}
                active={supplements.includes(s)}
                tone="sky"
                onClick={() => toggleSupp(s)}
              >
                {SUPP_LABEL[s]}
              </Chip>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div>
          <div className="eyebrow mb-2">Notes</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={(e) => commitNotes(e.target.value)}
            rows={3}
            placeholder="Caldo, stanco, dolore schiena…"
            className="w-full resize-none rounded-xl border border-hair bg-black/25 px-3.5 py-3 text-sm outline-none transition focus:border-sky-400/60"
          />
        </div>
      </div>

      <button
        onClick={onEnd}
        className="press mt-5 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-bold text-[#04140d]"
        style={{ background: accent, boxShadow: `0 10px 28px -10px ${accent}99` }}
      >
        <Check size={18} strokeWidth={2.6} /> End workout
      </button>
    </div>
  )
}
