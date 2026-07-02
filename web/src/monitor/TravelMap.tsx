import { useMemo, useState } from 'react'
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
} from 'react-leaflet'
import { LatLngBounds } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Session, WorkoutTemplate } from '../db'
import { fmtDate } from '../lib/id'
import { resolveLocation } from './geo'
import {
  INTENSITY_LEGEND,
  type Intensity,
  intensityColor,
  intensityLabel,
} from './intensity'

/*
 * The training map — every place a workout was logged, as a dot sized by how
 * many sessions happened there and COLOURED by the average workout intensity
 * there (each routine scored on its own scale). Tap a place to list its
 * sessions with dates and per-workout intensity. CARTO "Dark Matter" basemap;
 * swap TILE_URL for a Mapbox style + token for a richer look. Tiles need
 * network, but the whole Monitor is lazy-loaded so the offline logger never
 * pulls this in; with no signal the markers still render on a blank canvas.
 */

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const TILE_ATTRIB =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'

interface PlaceSession {
  date: string
  workout: string
  score: number
}
interface PlaceAgg {
  key: string
  name: string
  country: string
  lat: number
  lon: number
  sessions: PlaceSession[]
  avgScore: number
}

function aggregate(
  sessions: Session[],
  intensity: Map<string, Intensity>,
  nameFor: (id: string) => string,
): PlaceAgg[] {
  const by = new Map<string, PlaceAgg>()
  for (const s of sessions) {
    if (s.deleted || !s.location) continue
    const r = resolveLocation(s.location)
    if (!r) continue
    let p = by.get(r.key)
    if (!p) {
      p = {
        key: r.key,
        name: r.name,
        country: r.country,
        lat: r.lat,
        lon: r.lon,
        sessions: [],
        avgScore: 0,
      }
      by.set(r.key, p)
    }
    p.sessions.push({
      date: s.date,
      workout: nameFor(s.workoutId),
      score: intensity.get(s.id)?.score ?? 50,
    })
  }
  for (const p of by.values()) {
    p.sessions.sort((a, b) => (a.date < b.date ? 1 : -1))
    p.avgScore = Math.round(
      p.sessions.reduce((a, s) => a + s.score, 0) / p.sessions.length,
    )
  }
  return [...by.values()].sort((a, b) => b.sessions.length - a.sessions.length)
}

function FitToMarkers({ places }: { places: PlaceAgg[] }) {
  const map = useMap()
  useMemo(() => {
    if (!places.length) return
    const b = new LatLngBounds(places.map((p) => [p.lat, p.lon]))
    map.fitBounds(b, { padding: [40, 40], maxZoom: 6 })
  }, [map, places])
  return null
}

export function TravelMap({
  sessions,
  templates,
  intensity,
}: {
  sessions: Session[]
  templates: WorkoutTemplate[]
  intensity: Map<string, Intensity>
}) {
  const nameFor = useMemo(() => {
    const m = new Map(templates.map((t) => [t.id, t.name]))
    return (id: string) => m.get(id) ?? id
  }, [templates])

  const places = useMemo(
    () => aggregate(sessions, intensity, nameFor),
    [sessions, intensity, nameFor],
  )
  const max = Math.max(1, ...places.map((p) => p.sessions.length))
  const [selected, setSelected] = useState<string | null>(null)
  const place = places.find((p) => p.key === selected) ?? null

  if (!places.length) {
    return (
      <div className="py-8 text-center text-sm text-zinc-500">
        No located sessions yet — add a location when you train.
      </div>
    )
  }

  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-zinc-800">
        <MapContainer
          center={[25, 60]}
          zoom={2}
          scrollWheelZoom={false}
          style={{ height: 340, background: '#0b0b0f' }}
          attributionControl={false}
        >
          <TileLayer url={TILE_URL} attribution={TILE_ATTRIB} subdomains="abcd" />
          <FitToMarkers places={places} />
          {places.map((p) => {
            const r = 5 + Math.sqrt(p.sessions.length / max) * 16
            const color = intensityColor(p.avgScore)
            return (
              <CircleMarker
                key={p.key}
                center={[p.lat, p.lon]}
                radius={r}
                eventHandlers={{ click: () => setSelected(p.key) }}
                pathOptions={{
                  color,
                  weight: p.key === selected ? 3 : 1.5,
                  fillColor: color,
                  fillOpacity: 0.4,
                }}
              >
                <Popup>
                  <div className="text-sm font-semibold text-zinc-900">
                    {p.name}
                    <span className="font-normal text-zinc-500">
                      {' '}
                      · {p.country}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-600">
                    {p.sessions.length} session
                    {p.sessions.length > 1 ? 's' : ''} · avg intensity{' '}
                    {intensityLabel(p.avgScore)}
                  </div>
                </Popup>
              </CircleMarker>
            )
          })}
        </MapContainer>
      </div>

      {/* Intensity legend */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-[10px] tracking-wider text-zinc-500 uppercase">
          intensity
        </span>
        {INTENSITY_LEGEND.map((b) => (
          <span key={b.label} className="flex items-center gap-1">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: b.color }}
            />
            <span className="text-xs text-zinc-400">{b.label}</span>
          </span>
        ))}
      </div>

      {/* Per-place session list, coloured by each workout's intensity */}
      <div className="mt-3">
        {!place && (
          <p className="text-center font-mono text-xs text-zinc-500">
            tap a place to see its workouts
          </p>
        )}
        {place && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40">
            <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
              <div className="text-sm font-semibold">
                {place.name}
                <span className="font-normal text-zinc-500">
                  {' '}
                  · {place.sessions.length} session
                  {place.sessions.length > 1 ? 's' : ''}
                </span>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="font-mono text-xs text-zinc-500 active:text-zinc-300"
              >
                clear
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {place.sessions.map((s, i) => {
                const color = intensityColor(s.score)
                return (
                  <div
                    key={i}
                    className="flex items-center gap-2.5 border-b border-zinc-800/50 px-3 py-1.5 text-sm last:border-0"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: color }}
                      title={intensityLabel(s.score)}
                    />
                    <span className="w-20 shrink-0 font-mono text-xs text-zinc-500">
                      {fmtDate(s.date)}
                    </span>
                    <span className="flex-1 truncate capitalize text-zinc-300">
                      {s.workout}
                    </span>
                    <span
                      className="font-mono text-xs font-semibold"
                      style={{ color }}
                    >
                      {s.score}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
