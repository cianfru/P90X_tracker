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
import { LOOK_BACKDROP, LOOK_MAX_ZOOM, loadStyle, type MapLook } from './mapStyles'

/*
 * The training map — it fills whatever box it is given, and the Map tab gives
 * it the whole screen. Satellite imagery by default, or a regular street map
 * (see mapStyles); both are free and need no API key.
 *
 * Each place is a dot sized by how often you trained there and coloured by the
 * average intensity there, with a soft glow underneath and the session count
 * printed on the busy ones. Tapping a dot selects the place, tapping empty map
 * clears it, and the camera flies to whatever is selected.
 *
 * `pad` is the part of the screen covered by overlays (the year chips on top,
 * the pull-up panel below): the camera centres in what's left, so a selected
 * place never lands underneath the panel.
 */

setWorkerUrl(workerUrl)

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

export interface MapPad {
  top: number
  bottom: number
}

export function TravelMap({
  places,
  selected,
  onSelect,
  look,
  pad,
  refit,
}: {
  places: PlaceAgg[]
  selected: string | null
  onSelect: (key: string | null) => void
  /** Which base map to draw. Changing it needs a remount (key on it). */
  look: MapLook
  pad: MapPad
  /** Bump to re-frame every place (the "show all" button). */
  refit: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibre | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const padRef = useRef(pad)
  padRef.current = pad

  // Build the map once.
  useEffect(() => {
    if (!box.current) return
    let dead = false
    let map!: MapLibre
    // The style is fetched first (the satellite one is assembled in code),
    // then the map is built with it.
    const build = (style: Awaited<ReturnType<typeof loadStyle>>) => {
      if (dead) return
      map = new MapLibre({
        container: box.current!,
        style,
        center: [51.5, 25.3],
        zoom: 1.3,
        maxZoom: LOOK_MAX_ZOOM[look],
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      })
      mapRef.current = map
      // The style carries its own credits; keep them behind the ⓘ.
      map.addControl(new AttributionControl({ compact: true }), 'bottom-right')
      map.once('load', () =>
        box.current
          ?.querySelector('.maplibregl-ctrl-attrib')
          ?.classList.remove('maplibregl-compact-show'),
      )
      map.touchZoomRotate.disableRotation()

      map.on('style.load', () => {
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
    }
    loadStyle(look).then(build, () => setFailed(true))
    return () => {
      dead = true
      map?.remove()
      mapRef.current = null
    }
    // `look` is fixed for the life of this component (the parent keys on it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Data: refresh dots whenever the places or the selection change.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    ;(map.getSource('places') as GeoJSONSource | undefined)?.setData(
      toGeoJSON(places, selected),
    )
  }, [places, selected, ready])

  // The panel moved: slide the view so its centre stays in the visible part.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    map.easeTo({ padding: { ...pad, left: 0, right: 0 }, duration: 300 })
  }, [pad.top, pad.bottom, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  // Camera: frame everything, or fly to the selected place. Declared after
  // the padding effect so that when both fire, this one has the last word.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const padding = { ...padRef.current, left: 0, right: 0 }
    const place = places.find((p) => p.key === selected)
    if (place) {
      map.flyTo({
        center: [place.lon, place.lat],
        zoom: Math.max(map.getZoom(), 5),
        padding,
        duration: 1400,
        essential: true,
      })
      return
    }
    const b = boundsOf(places)
    if (!b) return
    map.setPadding(padding)
    map.fitBounds(b, { padding: 56, maxZoom: 5, duration: 900 })
  }, [places, selected, ready, refit])

  return (
    <div className="absolute inset-0" style={{ background: LOOK_BACKDROP[look] }}>
      {/* Sized with h-full, not inset-0: MapLibre's stylesheet makes its
          container position:relative, which would collapse an inset box. */}
      <div ref={box} className="h-full w-full" />
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-xs text-ink-3">
          The map needs a connection the first time — your places and stats still
          work offline, in the panel below.
        </div>
      )}
    </div>
  )
}
