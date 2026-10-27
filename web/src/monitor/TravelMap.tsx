import { useEffect, useRef, useState } from 'react'
import {
  AttributionControl,
  LngLatBounds,
  Map as MapLibre,
  setWorkerUrl,
  type GeoJSONSource,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { intensityColor } from './intensity'
import type { PlaceAgg } from './places'

/*
 * The training globe. Vector tiles from OpenFreeMap — free, no API key, no
 * account — after CARTO started answering keyless requests with "API KEY
 * REQUIRED" tiles, which is what broke the old map.
 *
 * Each place is a dot sized by how often you trained there and coloured by the
 * average intensity there, with a soft glow underneath and the session count
 * printed on the busy ones. Tapping a dot selects the place; the list below
 * the map selects too, and the globe flies to whatever is selected.
 *
 * Two-finger gestures pan and zoom, so a one-finger swipe still scrolls the
 * page on a phone instead of getting trapped in the map.
 */

setWorkerUrl(workerUrl)

const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark'
// Re-tint the base map to sit in the app: land a touch lighter than the page,
// sea a deep blue-black, so coastlines read without competing with the dots.
const LAND = '#15181f'
const SEA = '#090c13'

function toGeoJSON(places: PlaceAgg[], selected: string | null) {
  const max = Math.max(1, ...places.map((p) => p.sessions.length))
  return {
    type: 'FeatureCollection' as const,
    features: places.map((p) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
      properties: {
        key: p.key,
        n: p.sessions.length,
        r: 5 + Math.sqrt(p.sessions.length / max) * 15,
        color: intensityColor(p.avgScore),
        sel: p.key === selected,
      },
    })),
  }
}

function boundsOf(places: PlaceAgg[]): LngLatBounds | null {
  if (!places.length) return null
  const b = new LngLatBounds()
  for (const p of places) b.extend([p.lon, p.lat])
  return b
}

export function TravelMap({
  places,
  selected,
  onSelect,
}: {
  places: PlaceAgg[]
  selected: string | null
  onSelect: (key: string | null) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibre | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  // Build the map once.
  useEffect(() => {
    if (!box.current) return
    const map = new MapLibre({
      container: box.current,
      style: STYLE_URL,
      center: [51.5, 25.3],
      zoom: 1.3,
      attributionControl: false,
      cooperativeGestures: true,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    })
    mapRef.current = map
    // The style carries its own credits; keep them behind the ⓘ so they
    // don't sit on top of the globe on a phone-sized map.
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right')
    map.once('load', () =>
      box.current
        ?.querySelector('.maplibregl-ctrl-attrib')
        ?.classList.remove('maplibregl-compact-show'),
    )
    map.touchZoomRotate.disableRotation()

    map.on('style.load', () => {
      map.setProjection({ type: 'globe' })
      map.setSky({
        'sky-color': '#0b1220',
        'horizon-color': '#1d3b5c',
        'fog-color': '#0b1220',
        'atmosphere-blend': [
          'interpolate',
          ['linear'],
          ['zoom'],
          0,
          1,
          5,
          0.4,
          7,
          0,
        ],
      })
      if (map.getLayer('background')) {
        map.setPaintProperty('background', 'background-color', LAND)
      }
      if (map.getLayer('water')) map.setPaintProperty('water', 'fill-color', SEA)

      map.addSource('places', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'place-glow',
        type: 'circle',
        source: 'places',
        paint: {
          'circle-radius': ['*', ['get', 'r'], 2.2],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.22,
          'circle-blur': 1,
        },
      })
      map.addLayer({
        id: 'place-dot',
        type: 'circle',
        source: 'places',
        paint: {
          'circle-radius': ['get', 'r'],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.9,
          'circle-stroke-width': ['case', ['get', 'sel'], 2.5, 1],
          'circle-stroke-color': [
            'case',
            ['get', 'sel'],
            '#ffffff',
            'rgba(255,255,255,0.45)',
          ],
        },
      })
      map.addLayer({
        id: 'place-count',
        type: 'symbol',
        source: 'places',
        filter: ['>=', ['get', 'n'], 5],
        layout: {
          'text-field': ['to-string', ['get', 'n']],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          // In a tight cluster the biggest dots keep their number and the
          // rest drop theirs, instead of printing on top of each other.
          'symbol-sort-key': ['-', ['get', 'n']],
        },
        paint: { 'text-color': '#06140d' },
      })
      setReady(true)
    })

    map.on('click', 'place-dot', (e) => {
      const key = e.features?.[0]?.properties?.key as string | undefined
      if (key) onSelectRef.current(key)
    })
    map.on('click', (e) => {
      const hit = map.queryRenderedFeatures(e.point, { layers: ['place-dot'] })
      if (!hit.length) onSelectRef.current(null)
    })
    map.on('error', (e) => {
      // A failed style fetch (offline) leaves a blank canvas — say so instead.
      if (!map.isStyleLoaded() && /style/i.test(String(e.error?.message))) {
        setFailed(true)
      }
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Data: refresh dots whenever the places or the selection change.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    ;(map.getSource('places') as GeoJSONSource | undefined)?.setData(
      toGeoJSON(places, selected),
    )
  }, [places, selected, ready])

  // Camera: frame everything, or fly to the selected place.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const place = places.find((p) => p.key === selected)
    if (place) {
      map.flyTo({
        center: [place.lon, place.lat],
        zoom: Math.max(map.getZoom(), 5),
        duration: 1400,
        essential: true,
      })
      return
    }
    const b = boundsOf(places)
    if (b) map.fitBounds(b, { padding: 48, maxZoom: 5, duration: 900 })
  }, [places, selected, ready])

  return (
    <div className="relative overflow-hidden rounded-xl border border-hair bg-[#05070b]">
      <div ref={box} style={{ height: 360 }} />
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-ink-3">
          The map needs a connection the first time — your places and stats below
          still work offline.
        </div>
      )}
    </div>
  )
}
