import { updateSessionMeta } from '../db/repo'
import { nearestPlace } from '../monitor/geo'

/*
 * Capture the device's position when a workout starts and stamp it on the
 * session. We store the raw coordinates and, if a known training place is
 * within range, pre-fill the location label with it (unless one is already set)
 * so the map/list keep aggregating by familiar places. Pure best-effort: any
 * permission denial or timeout is swallowed — logging never depends on GPS.
 */

export type GeoState = 'idle' | 'locating' | 'done' | 'denied' | 'unavailable'

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('unavailable'))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000,
    })
  })
}

/**
 * Fetch the current position and store it on the session. When `fillLabel` is
 * true and the fix is near a known place, set the location label too. Returns
 * the resulting state for UI feedback.
 */
export async function capturePosition(
  sessionId: string,
  fillLabel: boolean,
): Promise<GeoState> {
  try {
    const pos = await getPosition()
    const { latitude: lat, longitude: lon } = pos.coords
    const patch: {
      lat: number
      lon: number
      location?: string
    } = { lat, lon }
    if (fillLabel) {
      const place = nearestPlace(lat, lon)
      if (place) patch.location = place.name
    }
    await updateSessionMeta(sessionId, patch)
    return 'done'
  } catch (e) {
    const code = (e as GeolocationPositionError)?.code
    if (code === 1) return 'denied'
    return 'unavailable'
  }
}
