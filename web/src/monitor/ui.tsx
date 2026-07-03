import { ResponsiveContainer } from 'recharts'
import type { ReactElement, ReactNode } from 'react'

/* Shared Progress visuals: chart palette, tooltip style, and the Card / Kpi /
 * ChartBox primitives used across the Overview, Map and Exercise tabs. */

export const C = {
  emerald: '#34f5a0',
  sky: '#33cbff',
  amber: '#fbbf24',
  rose: '#fb7185',
  violet: '#b26bff',
  grid: 'rgba(255,255,255,.08)',
  mut: '#aab3c2',
}

export const tip = {
  contentStyle: {
    background: '#14161d',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: 12,
    fontSize: 12,
  },
  labelStyle: { color: '#c3cad6' },
}

type KpiTone = 'ink' | 'emerald' | 'sky' | 'amber' | 'violet' | 'rose'

export function Kpi({
  label,
  value,
  unit,
  tone,
}: {
  label: string
  value: string
  unit?: string
  tone: KpiTone
}) {
  const colors: Record<KpiTone, string> = {
    ink: 'text-ink',
    emerald: 'text-[#34f5a0]',
    sky: 'text-[#33cbff]',
    amber: 'text-amber-400',
    violet: 'text-[#b26bff]',
    rose: 'text-rose-400',
  }
  return (
    <div className="card flex flex-col items-center justify-center px-2 py-3.5 text-center">
      <div className="eyebrow text-[10px] leading-tight">{label}</div>
      <div
        className={`nums mt-1.5 text-[17px] leading-none font-bold whitespace-nowrap ${colors[tone]}`}
      >
        {value}
        {unit && <span className="text-xs font-medium text-ink-3"> {unit}</span>}
      </div>
    </div>
  )
}

export function Card({
  title,
  subtitle,
  right,
  children,
}: {
  title: string
  subtitle?: string
  right?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="card p-4">
      <div className="mb-3.5 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-bold tracking-tight">{title}</h3>
          {subtitle && (
            <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p>
          )}
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

export function ChartBox({
  children,
  height = 200,
}: {
  children: ReactElement
  height?: number
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  )
}
