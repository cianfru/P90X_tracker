import { lazy, Suspense, useMemo, useState } from 'react'
import { ChevronRight, MapPin, X } from 'lucide-react'
import type { Session, WorkoutTemplate } from '../db'
import { fmtDate } from '../lib/id'
import {
  INTENSITY_LEGEND,
  intensityColor,
  intensityLabel,
  type Intensity,
} from './intensity'
import { aggregatePlaces, travelStats } from './places'
import { Card, Kpi } from './ui'
import { SessionDetail } from './SessionDetail'

// MapLibre is heavy — load it only when the Map tab is opened.
const TravelMap = lazy(() =>
  import('./TravelMap').then((m) => ({ default: m.TravelMap })),
)

const TOP = 8

export function MapTab({
  sessions,
  templates,
  intensity,
  located,
}: {
  sessions: Session[]
  templates: WorkoutTemplate[]
  intensity: Map<string, Intensity>
  located: number
}) {
  const [open, setOpen] = useState<{ id: string; score: number } | null>(null)
  const [year, setYear] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const nameFor = useMemo(() => {
    const m = new Map(templates.map((t) => [t.id, t.name]))
    return (id: string) => m.get(id) ?? id
  }, [templates])

  const years = useMemo(() => {
    const ys = new Set(
      sessions.filter((s) => !s.deleted).map((s) => s.date.slice(0, 4)),
    )
    return [...ys].sort().reverse()
  }, [sessions])

  const places = useMemo(
    () => aggregatePlaces(sessions, intensity, nameFor, year ?? undefined),
    [sessions, intensity, nameFor, year],
  )
  const stats = useMemo(() => travelStats(places), [places])
  const place = places.find((p) => p.key === selected) ?? null
  const max = Math.max(1, ...places.map((p) => p.sessions.length))

  if (open) {
    return (
      <SessionDetail
        sessionId={open.id}
        score={open.score}
        onBack={() => setOpen(null)}
      />
    )
  }

  if (located === 0) {
    return (
      <div className="mt-10 text-center text-sm text-ink-3">
        No located sessions yet — add a location when you train and they'll appear
        on the map.
      </div>
    )
  }

  const pickYear = (y: string | null) => {
    setYear(y)
    setSelected(null)
  }

  return (
    <div className="space-y-4 pt-1">
      <Card
        title="Training around the world"
        subtitle={`${stats.sessions.toLocaleString()} sessions · ${stats.places} places${year ? ` in ${year}` : ''}`}
        right={<MapPin size={16} className="text-[#33cbff]" />}
      >
        {/* Year filter */}
        <div className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {[null, ...years].map((y) => {
            const active = year === y
            return (
              <button
                key={y ?? 'all'}
                onClick={() => pickYear(y)}
                className={`press nums shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  active
                    ? 'border-[#33cbff]/50 bg-[#33cbff]/15 text-[#33cbff]'
                    : 'border-hair bg-white/[0.04] text-ink-3'
                }`}
              >
                {y ?? 'All years'}
              </button>
            )
          })}
        </div>

        <Suspense
          fallback={
            <div className="flex h-[360px] items-center justify-center rounded-xl border border-hair bg-[#05070b] text-xs text-ink-3">
              Loading map…
            </div>
          }
        >
          <TravelMap places={places} selected={selected} onSelect={setSelected} />
        </Suspense>

        {/* Intensity legend */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[10px] tracking-wider text-ink-3 uppercase">
            avg intensity
          </span>
          {INTENSITY_LEGEND.map((b) => (
            <span key={b.label} className="flex items-center gap-1">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: b.color }}
              />
              <span className="text-xs text-ink-3">{b.label}</span>
            </span>
          ))}
        </div>

        {/* The selected place's sessions */}
        {place && (
          <div className="mt-3 rounded-xl border border-hair bg-black/25">
            <div className="flex items-center justify-between gap-2 border-b border-hair px-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {place.name}
                  {place.country && (
                    <span className="font-normal text-ink-3">
                      {' '}
                      · {place.country}
                    </span>
                  )}
                </div>
                <div className="nums text-xs text-ink-3">
                  {place.sessions.length} session
                  {place.sessions.length > 1 ? 's' : ''} ·{' '}
                  {fmtDate(place.sessions.at(-1)!.date)}
                  {place.sessions.length > 1
                    ? ` – ${fmtDate(place.sessions[0].date)}`
                    : ''}
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                aria-label="close place"
                className="press flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-ink-3"
              >
                <X size={15} />
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {place.sessions.map((s) => {
                const color = intensityColor(s.score)
                return (
                  <button
                    key={s.id}
                    onClick={() => setOpen({ id: s.id, score: s.score })}
                    className="flex w-full items-center gap-2.5 border-b border-hair/50 px-3 py-2.5 text-left text-sm last:border-0 active:bg-white/[0.04]"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: color }}
                      title={intensityLabel(s.score)}
                    />
                    <span className="nums w-20 shrink-0 text-xs text-ink-3">
                      {fmtDate(s.date)}
                    </span>
                    <span className="flex-1 truncate text-ink-2 capitalize">
                      {s.workout}
                    </span>
                    <span className="nums text-xs font-bold" style={{ color }}>
                      {s.score}
                    </span>
                    <ChevronRight size={14} className="shrink-0 text-ink-3" />
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </Card>

      {/* Travel numbers */}
      <div className="grid grid-cols-2 gap-2.5">
        <Kpi label="Places" value={String(stats.places)} tone="sky" />
        <Kpi label="Countries" value={String(stats.countries)} tone="violet" />
        <Kpi
          label={stats.home ? `Away from ${stats.home.name}` : 'Away from home'}
          value={`${stats.awayPct}%`}
          tone="amber"
        />
        <Kpi
          label={
            stats.furthest ? `Furthest · ${stats.furthest.place.name}` : 'Furthest'
          }
          value={
            stats.furthest ? Math.round(stats.furthest.km).toLocaleString() : '—'
          }
          unit={stats.furthest ? 'km' : undefined}
          tone="emerald"
        />
      </div>

      {/* Where you train most */}
      <Card title="Top places" subtitle="Tap one to fly there">
        <div className="space-y-1">
          {(showAll ? places : places.slice(0, TOP)).map((p, i) => {
            const color = intensityColor(p.avgScore)
            const active = p.key === selected
            return (
              <button
                key={p.key}
                onClick={() => {
                  setSelected(p.key)
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
                className={`press flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left ${
                  active ? 'bg-white/[0.06]' : ''
                }`}
              >
                <span className="nums w-5 shrink-0 text-right text-xs font-semibold text-ink-3">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold">
                      {p.name}
                      {p.country && (
                        <span className="font-normal text-ink-3">
                          {' '}
                          · {p.country}
                        </span>
                      )}
                    </span>
                    <span className="nums shrink-0 text-xs font-bold text-ink-2">
                      {p.sessions.length}
                    </span>
                  </span>
                  <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.max(3, (100 * p.sessions.length) / max)}%`,
                        background: color,
                      }}
                    />
                  </span>
                </span>
              </button>
            )
          })}
        </div>
        {places.length > TOP && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="press mt-2 w-full rounded-xl bg-white/[0.04] py-2 text-xs font-semibold text-ink-2"
          >
            {showAll ? 'Show fewer' : `Show all ${places.length}`}
          </button>
        )}
      </Card>
    </div>
  )
}
