import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronDown, LocateFixed, MapPin } from 'lucide-react'
import type { Session } from '../db'
import { recentLocations, updateSessionMeta } from '../db/repo'
import { capturePosition, type GeoState } from './geolocate'

/*
 * In-session location card. Where you trained is captured while you log (it
 * feeds the map). Form / supplements / notes are asked at the END of the
 * workout instead — see SessionFinish. Collapsed to a one-line summary; tap
 * to edit. Every change writes straight to Dexie (and the sync outbox).
 */

export function SessionMeta({ session }: { session: Session }) {
  const [open, setOpen] = useState(false)
  const [location, setLocation] = useState(session.location ?? '')
  const [geo, setGeo] = useState<GeoState>('idle')
  const recent = useLiveQuery(() => recentLocations(), []) ?? []

  // Reset the local field only when we switch to a different session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setLocation(session.location ?? ''), [session.id])
  // Fill the field when geolocation auto-detects a place, without clobbering typing.
  useEffect(() => {
    if (session.location && !location) setLocation(session.location)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.location])

  const commitLocation = (v: string) =>
    updateSessionMeta(session.id, { location: v.trim() || undefined })
  const useMyLocation = async () => {
    setGeo('locating')
    setGeo(await capturePosition(session.id, !location.trim()))
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-hair bg-white/[0.02]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 px-4 py-3.5 text-left"
      >
        <MapPin size={16} className="shrink-0 text-sky-400" />
        <span className="flex-1 truncate text-sm">
          {session.location ? (
            <span className="font-medium text-ink-2">{session.location}</span>
          ) : (
            <span className="text-ink-3">Add location…</span>
          )}
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-ink-3 transition ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="border-t border-hair px-4 pt-4 pb-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="eyebrow">Location</span>
            <button
              onClick={useMyLocation}
              disabled={geo === 'locating'}
              className="flex items-center gap-1 text-xs font-semibold text-sky-400 active:text-sky-300 disabled:opacity-50"
            >
              <LocateFixed
                size={13}
                className={geo === 'locating' ? 'animate-pulse' : ''}
              />
              {geo === 'locating'
                ? 'Locating…'
                : geo === 'denied'
                  ? 'Permission denied'
                  : geo === 'unavailable'
                    ? 'Unavailable'
                    : 'Use my location'}
            </button>
          </div>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            onBlur={(e) => commitLocation(e.target.value)}
            placeholder="City, IATA code, or casa…"
            className="w-full rounded-xl border border-hair bg-black/25 px-3.5 py-3 text-sm outline-none transition focus:border-sky-400/60"
          />
          {recent.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {recent.map((loc) => (
                <button
                  key={loc}
                  onClick={() => {
                    setLocation(loc)
                    commitLocation(loc)
                  }}
                  className={`press rounded-full border px-3 py-1 text-xs font-medium ${
                    location === loc
                      ? 'border-sky-400/50 bg-sky-400/15 text-sky-300'
                      : 'border-hair bg-white/[0.04] text-ink-3'
                  }`}
                >
                  {loc}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
