import type { ReactNode } from 'react'
import { Minus, Plus } from 'lucide-react'

/* Small presentational atoms shared across the logger, ported from the
 * workout-logger.jsx prototype (same look; typed, no behavioural change). */

export function Stepper({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  accent = 'emerald',
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  accent?: 'emerald' | 'sky'
}) {
  const ring = accent === 'sky' ? 'text-sky-400' : 'text-emerald-400'
  const bump = (dir: number) => onChange(Math.max(min, value + dir * step))
  return (
    <div className="flex-1">
      <div className="mb-1.5 font-mono text-xs tracking-wide text-zinc-500 uppercase">
        {label}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`decrease ${label}`}
          onClick={() => bump(-1)}
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-800 transition active:scale-95"
        >
          <Minus size={18} />
        </button>
        <div className={`flex-1 text-center font-mono text-2xl font-bold ${ring}`}>
          {value}
        </div>
        <button
          type="button"
          aria-label={`increase ${label}`}
          onClick={() => bump(1)}
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-800 transition active:scale-95"
        >
          <Plus size={18} />
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
    amber: 'bg-amber-500/20 border-amber-500/50 text-amber-300',
    sky: 'bg-sky-500/20 border-sky-500/50 text-sky-300',
    rose: 'bg-rose-500/20 border-rose-500/50 text-rose-300',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
        active ? tones[tone] : 'border-zinc-700 bg-zinc-800/60 text-zinc-400'
      }`}
    >
      {children}
    </button>
  )
}

export function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="text-center">
      <div className="font-semibold text-zinc-200">{n}</div>
      <div className="-mt-0.5 text-xs text-zinc-500">{label}</div>
    </div>
  )
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-xs tracking-widest text-zinc-500 uppercase">
      {children}
    </div>
  )
}
