import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from 'react'
import {
  ChevronRight,
  ChevronUp,
  Expand,
  Globe,
  Map as MapIcon,
  X,
} from 'lucide-react'
import type { Session, WorkoutTemplate } from '../db'
import { fmtDate } from '../lib/id'
import {
  INTENSITY_LEGEND,
  intensityColor,
  intensityLabel,
  type Intensity,
} from './intensity'
import { aggregatePlaces, travelStats } from './places'
import { Kpi } from './ui'
import { SessionDetail } from './SessionDetail'

/*
 * The Map tab is the map: it fills the screen edge to edge, under the status
 * bar and the bottom dock, and everything else floats on it.
 *
 *   top      year chips, and two round buttons (flat / globe, show everything)
 *   bottom   a pull-up panel — collapsed it's one line of totals; pulled up it
 *            holds the travel numbers and the ranked places, or the sessions of
 *            the place you tapped
 *
 * Drag the panel's handle, or tap it, to move it between its three heights.
 * Tapping empty map drops it back down so the map is the whole view again.
 */

// MapLibre is heavy — load it only when the Map tab is opened.
const TravelMap = lazy(() =>
  import('./TravelMap').then((m) => ({ default: m.TravelMap })),
)

type Snap = 'peek' | 'half' | 'full'
const PEEK = 86
const GLOBE_KEY = 'p90x-map-globe'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

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
  const [snap, setSnap] = useState<Snap>('peek')
  const [refit, setRefit] = useState(0)
  const [globe, setGlobe] = useState(() => {
    try {
      return localStorage.getItem(GLOBE_KEY) === '1'
    } catch {
      return false
    }
  })

  // The panel sits on top of the bottom dock, so it needs the dock's real
  // height (which includes the phone's home-indicator inset).
  const [dims, setDims] = useState({ vh: window.innerHeight, nav: 72 })
  useEffect(() => {
    const measure = () =>
      setDims({
        vh: window.innerHeight,
        nav: document.querySelector('nav')?.getBoundingClientRect().height ?? 72,
      })
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  const heights: Record<Snap, number> = {
    peek: PEEK,
    half: Math.round((dims.vh - dims.nav) * 0.48),
    full: dims.vh - dims.nav - 170,
  }

  // While a finger is on the handle the panel follows it; on release it
  // settles on the nearest of the three heights. A tap (no movement) toggles.
  const [dragH, setDragH] = useState<number | null>(null)
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null)
  const height = dragH ?? heights[snap]
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { y: e.clientY, h: height, moved: false }
  }
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const dy = d.y - e.clientY
    if (Math.abs(dy) > 6) d.moved = true
    if (d.moved) setDragH(clamp(d.h + dy, PEEK, heights.full))
  }
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    setDragH(null)
    if (!d.moved) {
      setSnap((s) => (s === 'peek' ? 'half' : 'peek'))
      return
    }
    const h = clamp(d.h + d.y - e.clientY, PEEK, heights.full)
    const nearest = (Object.keys(heights) as Snap[]).reduce((a, b) =>
      Math.abs(heights[b] - h) < Math.abs(heights[a] - h) ? b : a,
    )
    setSnap(nearest)
  }

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

  // The camera centres in what the overlays leave uncovered. Past half
  // height the panel hides most of the map anyway, so stop chasing it.
  const pad = useMemo(
    () => ({ top: 96, bottom: dims.nav + Math.min(heights[snap], heights.half) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, dims.nav, dims.vh],
  )

  if (located === 0) {
    return (
      <div className="px-8 pt-[30vh] text-center text-sm text-ink-3">
        No located sessions yet — add a location when you train and they'll appear
        on the map.
      </div>
    )
  }

  const select = (key: string | null) => {
    setSelected(key)
    setSnap(key ? 'half' : 'peek')
  }
  const toggleGlobe = () =>
    setGlobe((g) => {
      try {
        localStorage.setItem(GLOBE_KEY, g ? '0' : '1')
      } catch {
        /* preference just won't persist */
      }
      return !g
    })

  const mapBtn =
    'frost press pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full border border-hair-2 text-ink-2 shadow-[0_6px_18px_-6px_rgba(0,0,0,0.7)]'

  return (
    <>
      {/* The map — the whole screen */}
      <div
        className="immersive-map fixed inset-0 z-0"
        style={{ ['--map-ctrl-bottom' as string]: `${dims.nav + PEEK + 8}px` }}
      >
        <Suspense
          fallback={
            <div className="absolute inset-0 flex items-center justify-center bg-[#05070b] text-xs text-ink-3">
              Loading map…
            </div>
          }
        >
          <TravelMap
            places={places}
            selected={selected}
            onSelect={select}
            globe={globe}
            pad={pad}
            refit={refit}
          />
        </Suspense>
      </div>

      {/* Top: year filter + map buttons */}
      <div
        className="pointer-events-none fixed inset-x-0 z-10 mx-auto max-w-md"
        style={{ top: 'calc(env(safe-area-inset-top) + 10px)' }}
      >
        <div className="pointer-events-auto flex gap-1.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none]">
          {[null, ...years].map((y) => {
            const active = year === y
            return (
              <button
                key={y ?? 'all'}
                onClick={() => {
                  setYear(y)
                  setSelected(null)
                }}
                className={`press nums shrink-0 rounded-full border px-3.5 py-2 text-xs font-bold shadow-[0_6px_18px_-6px_rgba(0,0,0,0.7)] ${
                  active
                    ? 'border-transparent bg-[#33cbff] text-[#04121a]'
                    : 'frost border-hair-2 text-ink-2'
                }`}
              >
                {y ?? 'All years'}
              </button>
            )
          })}
        </div>
        <div className="mt-2 flex flex-col items-end gap-2 px-3">
          <button
            onClick={toggleGlobe}
            aria-label={globe ? 'switch to flat map' : 'switch to globe'}
            className={mapBtn}
          >
            {globe ? <MapIcon size={18} /> : <Globe size={18} />}
          </button>
          <button
            onClick={() => {
              setSelected(null)
              setRefit((n) => n + 1)
            }}
            aria-label="show all places"
            className={mapBtn}
          >
            <Expand size={17} />
          </button>
        </div>
      </div>

      {/* Bottom: the pull-up panel */}
      <div
        className="fixed inset-x-0 z-30 mx-auto max-w-md"
        style={{ bottom: dims.nav }}
      >
        <div
          className="frost flex flex-col overflow-hidden rounded-t-3xl border-x border-t border-hair-2 shadow-[0_-12px_32px_-12px_rgba(0,0,0,0.8)]"
          style={{
            height,
            // Near-opaque: at 88% the map's labels read through the lists.
            background: 'rgba(10, 11, 15, 0.97)',
            maxHeight: `calc(100dvh - ${dims.nav}px - env(safe-area-inset-top) - 64px)`,
            transition:
              dragH == null ? 'height 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none',
          }}
        >
          <div
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            role="button"
            aria-label={snap === 'peek' ? 'expand panel' : 'collapse panel'}
            className="shrink-0 cursor-grab touch-none px-5 pt-2.5 pb-3 select-none"
          >
            <div className="mx-auto mb-2.5 h-1 w-10 rounded-full bg-white/25" />
            <div className="flex items-center justify-between gap-3">
              {place ? (
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-bold">
                    {place.name}
                    {place.country && (
                      <span className="font-normal text-ink-3">
                        {' '}
                        · {place.country}
                      </span>
                    )}
                  </div>
                  <div className="nums truncate text-xs text-ink-3">
                    {place.sessions.length} session
                    {place.sessions.length > 1 ? 's' : ''} ·{' '}
                    {fmtDate(place.sessions.at(-1)!.date)}
                    {place.sessions.length > 1
                      ? ` – ${fmtDate(place.sessions[0].date)}`
                      : ''}
                  </div>
                </div>
              ) : (
                <div className="min-w-0">
                  <div className="nums truncate text-[15px] font-bold">
                    {stats.places} places · {stats.countries} countries
                  </div>
                  <div className="nums truncate text-xs text-ink-3">
                    {stats.sessions.toLocaleString()} sessions
                    {year ? ` in ${year}` : ''}
                    {stats.home
                      ? ` · ${stats.awayPct}% away from ${stats.home.name}`
                      : ''}
                  </div>
                </div>
              )}
              {place ? (
                <button
                  onClick={() => setSelected(null)}
                  aria-label="close place"
                  className="press flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-ink-2"
                >
                  <X size={15} />
                </button>
              ) : (
                <ChevronUp
                  size={18}
                  className={`shrink-0 text-ink-3 transition-transform ${
                    snap === 'peek' ? '' : 'rotate-180'
                  }`}
                />
              )}
            </div>
          </div>

          <div
            className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 ${
              snap === 'peek' && dragH == null ? 'invisible' : ''
            }`}
          >
            {place ? (
              // The selected place's sessions
              <div className="rounded-xl border border-hair bg-black/25">
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
            ) : (
              <>
                {/* Travel numbers */}
                <div className="grid grid-cols-2 gap-2.5">
                  <Kpi label="Places" value={String(stats.places)} tone="sky" />
                  <Kpi
                    label="Countries"
                    value={String(stats.countries)}
                    tone="violet"
                  />
                  <Kpi
                    label={
                      stats.home ? `Away from ${stats.home.name}` : 'Away from home'
                    }
                    value={`${stats.awayPct}%`}
                    tone="amber"
                  />
                  <Kpi
                    label={
                      stats.furthest
                        ? `Furthest · ${stats.furthest.place.name}`
                        : 'Furthest'
                    }
                    value={
                      stats.furthest
                        ? Math.round(stats.furthest.km).toLocaleString()
                        : '—'
                    }
                    unit={stats.furthest ? 'km' : undefined}
                    tone="emerald"
                  />
                </div>

                {/* Dot colours */}
                <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1">
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

                {/* Where you train most — tap to fly there */}
                <div className="eyebrow mt-5 mb-1.5">Places</div>
                <div className="space-y-0.5">
                  {places.map((p, i) => (
                    <button
                      key={p.key}
                      onClick={() => select(p.key)}
                      className="press flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left"
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
                              background: intensityColor(p.avgScore),
                            }}
                          />
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* A session opened from a place: a full page over the map, which stays
          mounted underneath so coming back is instant and where you left it. */}
      {open && (
        <div
          className="fixed inset-0 z-40 overflow-y-auto"
          style={{ background: 'var(--color-canvas)' }}
        >
          <div
            className="mx-auto max-w-md px-4 pb-16"
            style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1.25rem)' }}
          >
            <SessionDetail
              sessionId={open.id}
              score={open.score}
              onBack={() => setOpen(null)}
            />
          </div>
        </div>
      )}
    </>
  )
}
