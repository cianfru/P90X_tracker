import type { StyleSpecification } from 'maplibre-gl'

/*
 * The two looks of the training map — both keyless and free.
 *
 *   satellite  Sentinel-2 cloudless imagery (EOX) with borders and place
 *              names drawn on top. The default: real terrain and sea rather
 *              than a flat dark canvas.
 *   map        OpenFreeMap "Liberty" — a regular colourful street map.
 */

export type MapLook = 'satellite' | 'map'

const OFM = 'https://tiles.openfreemap.org/styles'

// Shown wherever no tile is drawn (past the poles, and while
// tiles load), so it should read as open sea for that look.
export const LOOK_BACKDROP: Record<MapLook, string> = {
  satellite: '#0a1a38',
  map: '#a0c0f8',
}

// Imagery is sharp to about street-block level; past that it only blurs.
export const LOOK_MAX_ZOOM: Record<MapLook, number> = { satellite: 14, map: 18 }

/**
 * The satellite style is assembled here: OpenFreeMap's dark style supplies
 * the vector source, fonts and the border / place-name layers (already drawn
 * for a dark background), re-inked white so they stay legible over imagery.
 */
async function satelliteStyle(): Promise<StyleSpecification> {
  const res = await fetch(`${OFM}/dark`)
  if (!res.ok) throw new Error(`map style failed to load (${res.status})`)
  const base = (await res.json()) as StyleSpecification
  const overlay = base.layers
    .filter((l) => l.id.startsWith('place_') || l.id.startsWith('boundary_'))
    .map((l) => {
      if (l.type === 'symbol') {
        return {
          ...l,
          paint: {
            ...l.paint,
            'text-color': '#ffffff',
            'text-halo-color': 'rgba(0, 0, 0, 0.75)',
            'text-halo-width': 1.4,
            'text-halo-blur': 0.5,
          },
        }
      }
      if (l.type === 'line') {
        return {
          ...l,
          paint: { ...l.paint, 'line-color': '#ffffff', 'line-opacity': 0.35 },
        }
      }
      return l
    })
  return {
    ...base,
    sources: {
      openmaptiles: base.sources.openmaptiles,
      imagery: {
        type: 'raster',
        tiles: [
          'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg',
        ],
        tileSize: 256,
        maxzoom: 14,
        attribution:
          '<a href="https://s2maps.eu" target="_blank">Sentinel-2 cloudless</a> by EOX (contains modified Copernicus Sentinel data 2020)',
      },
    },
    layers: [{ id: 'imagery', type: 'raster', source: 'imagery' }, ...overlay],
  }
}

export function loadStyle(look: MapLook): Promise<StyleSpecification | string> {
  return look === 'satellite' ? satelliteStyle() : Promise.resolve(`${OFM}/liberty`)
}
