import { useMemo } from 'react'
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
import { resolveLocation } from './geo'

/*
 * The training map — every place a workout was logged, as a glowing dot sized
 * by how many sessions happened there. CARTO "Dark Matter" basemap to match the
 * app; swap TILE_URL for a Mapbox style + token if you ever want a richer look.
 * Tiles need network, but the whole Monitor is lazy-loaded so the offline
 * logger never pulls this in; with no signal the markers still render on a
 * blank canvas.
 */

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const TILE_ATTRIB =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'

interface PlaceAgg {
  key: string
  name: string
  country: string
  lat: number
  lon: number
  sessions: number
  firstYear: string
  lastYear: string
  workouts: Record<string, number>
}

function aggregate(
  sessions: Session[],
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
        sessions: 0,
        firstYear: s.date.slice(0, 4),
        lastYear: s.date.slice(0, 4),
        workouts: {},
      }
      by.set(r.key, p)
    }
    p.sessions++
    const y = s.date.slice(0, 4)
    if (y < p.firstYear) p.firstYear = y
    if (y > p.lastYear) p.lastYear = y
    const w = nameFor(s.workoutId)
    p.workouts[w] = (p.workouts[w] ?? 0) + 1
  }
  return [...by.values()].sort((a, b) => b.sessions - a.sessions)
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
}: {
  sessions: Session[]
  templates: WorkoutTemplate[]
}) {
  const nameFor = useMemo(() => {
    const m = new Map(templates.map((t) => [t.id, t.name]))
    return (id: string) => m.get(id) ?? id
  }, [templates])

  const places = useMemo(
    () => aggregate(sessions, nameFor),
    [sessions, nameFor],
  )
  const max = Math.max(1, ...places.map((p) => p.sessions))

  if (!places.length) {
    return (
      <div className="py-8 text-center text-sm text-zinc-500">
        No located sessions yet — add a location when you train.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800">
      <MapContainer
        center={[25, 60]}
        zoom={2}
        scrollWheelZoom={false}
        style={{ height: 360, background: '#0b0b0f' }}
        attributionControl={false}
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIB} subdomains="abcd" />
        <FitToMarkers places={places} />
        {places.map((p) => {
          const r = 5 + Math.sqrt(p.sessions / max) * 16
          const top = Object.entries(p.workouts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
          return (
            <CircleMarker
              key={p.key}
              center={[p.lat, p.lon]}
              radius={r}
              pathOptions={{
                color: '#34d399',
                weight: 1.5,
                fillColor: '#34d399',
                fillOpacity: 0.35,
              }}
            >
              <Popup>
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-zinc-900">
                    {p.name}
                    <span className="font-normal text-zinc-500">
                      {' '}
                      · {p.country}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-600">
                    <b>{p.sessions}</b> session{p.sessions > 1 ? 's' : ''} ·{' '}
                    {p.firstYear === p.lastYear
                      ? p.firstYear
                      : `${p.firstYear}–${p.lastYear}`}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {top.map(([w, n]) => `${w} (${n})`).join(', ')}
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          )
        })}
      </MapContainer>
    </div>
  )
}
