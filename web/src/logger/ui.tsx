import { useState, type ReactNode } from 'react'
import { Minus, Plus } from 'lucide-react'

/* Small presentational atoms shared across the logger — sleek, tactile, no
 * monospace. Numbers render with tabular figures for clean alignment. */

/**
 * A number you can nudge with − / + OR tap and type. Typing is the fast path
 * for any change bigger than a rep or two.
 */
export function Stepper({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  accent = 'emerald',
  valueColor,
  decimal = false,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  accent?: 'emerald' | 'sky'
  /** Explicit value colour (hex) — used for live effort colour coding. */
  valueColor?: string
  /** Allow a decimal point (plate weights like 2.5 / 17.5 kg). */
  decimal?: boolean
}) {
  const tint = valueColor ?? (accent === 'sky' ? '#33cbff' : '#34f5a0')
  const bump = (dir: number) => onChange(Math.max(min, value + dir * step))
  // While focused the field shows exactly what was typed (an empty field, a
  // trailing "17."), and only parseable values reach the caller.
  const [draft, setDraft] = useState<string | null>(null)
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
        <input
          aria-label={label}
          type="text"
          inputMode={decimal ? 'decimal' : 'numeric'}
          pattern={decimal ? '[0-9]*[.,]?[0-9]*' : '[0-9]*'}
          autoComplete="off"
          value={draft ?? String(value)}
          placeholder={String(value)}
          // Focus empties the field, with the current value as placeholder:
          // the first digit typed starts a fresh number, and tapping away
          // without typing leaves the value untouched.
          onFocus={() => setDraft('')}
          onChange={(e) => {
            const raw = e.target.value.replace(',', '.')
            const clean = decimal
              ? raw.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
              : raw.replace(/[^0-9]/g, '')
            setDraft(clean)
            const n = Number(clean)
            if (clean !== '' && Number.isFinite(n)) onChange(Math.max(min, n))
          }}
          onBlur={() => setDraft(null)}
          className="nums w-0 min-w-0 flex-1 bg-transparent text-center text-3xl font-bold caret-current outline-none placeholder:opacity-35"
          style={{ color: tint }}
        />
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
