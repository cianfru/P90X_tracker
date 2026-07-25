import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowRight, RefreshCw } from 'lucide-react'
import { db, CATALOG } from '../db'
import type { Session } from '../db'
import { computeStaleness, optionNames } from '../schedule/staleness'
import { Card } from './ui'

/*
 * Rotation status — which workout each slot of the cycle is currently on, and
 * whether it's been running longer than usual. The owner has always judged this
 * by feel ("if I feel I ran chest and back too long"); this just makes the
 * evidence visible. Each slot is measured against its OWN switching rhythm, so
 * the suggestion reflects how this person actually trains.
 */

export function RotationCard({ sessions }: { sessions: Session[] }) {
  const templates = useLiveQuery(() => db.templates.toArray()) ?? []
  const rotation = CATALOG.rotation

  const units = useMemo(
    () => (rotation ? computeStaleness(rotation, sessions) : []),
    [rotation, sessions],
  )
  if (!rotation || !units.length) return null

  const stale = units.filter((u) => u.stale).length

  return (
    <Card
      title="Rotation"
      subtitle={
        stale
          ? `${stale} slot${stale > 1 ? 's' : ''} running longer than you usually go`
          : 'Every slot within your usual range'
      }
      right={
        <RefreshCw size={16} className={stale ? 'text-amber-300' : 'text-ink-3'} />
      }
    >
      <div className="space-y-2.5">
        {units.map((u) => {
          const current =
            u.currentIndex == null
              ? null
              : optionNames(u.options[u.currentIndex], templates)
          const next =
            u.nextIndex == null
              ? null
              : optionNames(u.options[u.nextIndex], templates)
          return (
            <div
              key={u.key}
              className={`rounded-xl border px-3.5 py-3 ${
                u.stale
                  ? 'border-amber-400/30 bg-amber-400/[0.07]'
                  : 'border-hair bg-white/[0.02]'
              }`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-semibold text-ink">
                  {u.label}
                </span>
                <span className="nums shrink-0 text-[11px] text-ink-3">
                  day {u.days.join(' + ')}
                </span>
              </div>

              {current ? (
                <>
                  <div className="mt-1 truncate text-sm font-semibold capitalize">
                    {current}
                  </div>
                  <div className="nums mt-0.5 text-[12px] text-ink-3">
                    {u.run}× in a row
                    {u.typical != null
                      ? ` · you usually switch by ${u.threshold}`
                      : ' · never switched'}
                  </div>
                  {u.stale && next && (
                    <div className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-amber-300">
                      <ArrowRight size={13} className="shrink-0" />
                      <span className="truncate capitalize">try {next}</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-1 text-[12px] text-ink-3">
                  Nothing logged for this slot yet.
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
