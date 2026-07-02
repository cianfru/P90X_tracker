import type { ReactNode } from 'react'
import { Minus, Plus } from 'lucide-react'

/* Small presentational atoms shared across the logger — sleek, tactile, no
 * monospace. Numbers render with tabular figures for clean alignment. */

export function Stepper({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  accent = 'emerald',
  valueClass,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  accent?: 'emerald' | 'sky'
  /** Overrides the value colour (used for live effort colour coding). */
  valueClass?: string
}) {
  const tint =
    valueClass ?? (accent === 'sky' ? 'text-[#3bc6ff]' : 'text-[#37e29a]')
  const bump = (dir: number) => onChange(Math.max(min, value + dir * step))
  return (
    <div className="flex-1">
      <div className="eyebrow mb-2 text-center">{label}</div>
      <div className="flex items-center justify-between gap-2 rounded-2xl border border-hair bg-black/25 p-1.5">
        <button
          type="button"
          aria-label={`decrease ${label}`}
          onClick={() => bump(-1)}
          className="press flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 text-ink-2 active:bg-white/10"
        >
          <Minus size={18} strokeWidth={2.5} />
        </button>
        <div className={`nums flex-1 text-center text-3xl font-bold ${tint}`}>
          {value}
        </div>
        <button
          type="button"
          aria-label={`increase ${label}`}
          onClick={() => bump(1)}
          className="press flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 text-ink-2 active:bg-white/10"
        >
          <Plus size={18} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  )
}

export function Chip({
  active,
  tone,
  onClick,
  title,
  children,
}: {
  active: boolean
  tone: 'amber' | 'sky' | 'rose'
  onClick: () => void
  title?: string
  children: ReactNode
}) {
  const tones: Record<typeof tone, string> = {
    amber: 'border-amber-400/50 bg-amber-400/15 text-amber-300',
    sky: 'border-sky-400/50 bg-sky-400/15 text-sky-300',
    rose: 'border-rose-400/50 bg-rose-400/15 text-rose-300',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`press rounded-full border px-3 py-1.5 text-xs font-semibold ${
        active ? tones[tone] : 'border-hair bg-white/[0.04] text-ink-3'
      }`}
    >
      {children}
    </button>
  )
}

export function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="text-center">
      <div className="nums text-base font-bold text-ink">{n}</div>
      <div className="-mt-0.5 text-[11px] font-medium text-ink-3">{label}</div>
    </div>
  )
}

export function Label({ children }: { children: ReactNode }) {
  return <div className="eyebrow">{children}</div>
}
