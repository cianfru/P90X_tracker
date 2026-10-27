import type { Session } from '../db'
import { haversineKm, placeForSession } from './geo'
import type { Intensity } from './intensity'

/*
 * Sessions → places, and the travel numbers the Map tab shows beside the map.
 * Pure and map-library-free, so the stats render instantly while the (heavy)
 * map itself is still loading.
 */

export interface PlaceSession {
  id: string
  date: string
  workout: string
  score: number
}

export interface PlaceAgg {
  key: string
  name: string
  country: string
  lat: number
  lon: number
  /** Newest first. */
  sessions: PlaceSession[]
  avgScore: number
}

export function aggregatePlaces(
  sessions: Session[],
  intensity: Map<string, Intensity>,
  nameFor: (workoutId: string) => string,
  year?: string,
): PlaceAgg[] {
  const by = new Map<string, PlaceAgg>()
  for (const s of sessions) {
    if (s.deleted) continue
    if (year && !s.date.startsWith(year)) continue
    const r = placeForSession(s)
    if (!r) continue
    let p = by.get(r.key)
    if (!p) {
      p = { ...r, sessions: [], avgScore: 0 }
      by.set(r.key, p)
    }
    p.sessions.push({
      id: s.id,
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

export interface TravelStats {
  sessions: number
  places: number
  countries: number
  /** Where most sessions happened — what "away" is measured from. */
  home?: PlaceAgg
  /** Share of sessions logged anywhere but home, 0–100. */
  awayPct: number
  furthest?: { place: PlaceAgg; km: number }
}

export function travelStats(places: PlaceAgg[]): TravelStats {
  const sessions = places.reduce((a, p) => a + p.sessions.length, 0)
  const home = places[0]
  const countries = new Set(places.map((p) => p.country).filter(Boolean)).size
  let furthest: TravelStats['furthest']
  if (home) {
    for (const p of places) {
      const km = haversineKm(home.lat, home.lon, p.lat, p.lon)
      if (!furthest || km > furthest.km) furthest = { place: p, km }
    }
  }
  return {
    sessions,
    places: places.length,
    countries,
    home,
    awayPct:
      sessions && home
        ? Math.round(100 * (1 - home.sessions.length / sessions))
        : 0,
    furthest: furthest && furthest.km > 0 ? furthest : undefined,
  }
}
