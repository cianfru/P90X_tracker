import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronDown, LocateFixed, MapPin } from 'lucide-react'
import type { Session, Supplement } from '../db'
import { SUPPLEMENTS } from '../db'
import { recentLocations, updateSessionMeta } from '../db/repo'
import { capturePosition, type GeoState } from './geolocate'
import { Chip } from './ui'

/*
 * Per-day session metadata, mirroring the old spreadsheet's Location / Form /
 * notes / supplement columns. Collapsed to a one-line summary; tap to edit.
 * Every change writes straight to Dexie (and the sync outbox) — local-first.
 */

const SUPP_LABEL: Record<Supplement, string> = {
  creatine: 'Creatine',
  protein: 'Protein',
  maca: 'Maca',
  aminos: 'Aminos',
}
const SUPP_SHORT: Record<Supplement, string> = {
  creatine: 'C',
  protein: 'P',
  maca: 'M',
  aminos: 'A',
}

function summary(s: Session): string {
  const bits: string[] = []
  if (s.location) bits.push(s.location)
  if (s.form != null) bits.push(`form ${s.form}`)
  if (s.supplements?.length)
    bits.push(s.supplements.map((x) => SUPP_SHORT[x]).join(''))
  return bits.join(' · ')
}

export function SessionMeta({ session }: { session: Session }) {
  const [open, setOpen] = useState(false)
  const [location, setLocation] = useState(session.location ?? '')
  const [notes, setNotes] = useState(session.notes ?? '')
  const [geo, setGeo] = useState<GeoState>('idle')
  const recent = useLiveQuery(() => recentLocations(), []) ?? []

  // Reset the local text fields only when we switch to a different session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setLocation(session.location ?? ''), [session.id])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setNotes(session.notes ?? ''), [session.id])
  // Fill the field when geolocation auto-detects a place, without clobbering typing.
  useEffect(() => {
    if (session.location && !location) setLocation(session.location)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.location])

  const form = session.form ?? null
  const supplements = session.supplements ?? []

  const commitLocation = (v: string) =>
    updateSessionMeta(session.id, { location: v.trim() || undefined })
  const useMyLocation = async () => {
    setGeo('locating')
    setGeo(await capturePosition(session.id, !location.trim()))
  }
  const commitNotes = (v: string) =>
    updateSessionMeta(session.id, { notes: v.trim() || undefined })
  const setForm = (v: number | null) =>
    updateSessionMeta(session.id, { form: v ?? undefined })
  const toggleSupp = (s: Supplement) => {
    const next = supplements.includes(s)
      ? supplements.filter((x) => x !== s)
      : [...supplements, s]
    updateSessionMeta(session.id, {
      supplements: next.length ? next : undefined,
    })
  }

  const hasSummary = summary(session).length > 0

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
      >
        <MapPin size={16} className="shrink-0 text-sky-400" />
        <span className="flex-1 truncate text-sm">
          {hasSummary ? (
            <span className="text-zinc-300">{summary(session)}</span>
          ) : (
            <span className="text-zinc-500">Add location, form, notes…</span>
          )}
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-zinc-500 transition ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="space-y-4 border-t border-zinc-800/70 px-4 pt-3 pb-4">
          {/* Location */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-mono text-xs tracking-wide text-zinc-500 uppercase">
                location
              </span>
              <button
                onClick={useMyLocation}
                disabled={geo === 'locating'}
                className="flex items-center gap-1 font-mono text-xs text-sky-400 active:text-sky-300 disabled:opacity-50"
              >
                <LocateFixed
                  size={12}
                  className={geo === 'locating' ? 'animate-pulse' : ''}
                />
                {geo === 'locating'
                  ? 'locating…'
                  : geo === 'denied'
                    ? 'permission denied'
                    : geo === 'unavailable'
                      ? 'unavailable'
                      : 'use my location'}
              </button>
            </div>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              onBlur={(e) => commitLocation(e.target.value)}
              placeholder="City, IATA code, or casa…"
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950/60 px-3 py-2.5 text-sm outline-none focus:border-sky-500/60"
            />
            {recent.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {recent.map((loc) => (
                  <button
                    key={loc}
                    onClick={() => {
                      setLocation(loc)
                      commitLocation(loc)
                    }}
                    className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                      location === loc
                        ? 'border-sky-500/50 bg-sky-500/20 text-sky-300'
                        : 'border-zinc-700 bg-zinc-800/60 text-zinc-400'
                    }`}
                  >
                    {loc}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Form 1-10 */}
          <div>
            <div className="mb-1.5 font-mono text-xs tracking-wide text-zinc-500 uppercase">
              form (1–10)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  onClick={() => setForm(form === n ? null : n)}
                  className={`h-9 w-9 rounded-lg border text-sm font-semibold transition ${
                    form === n
                      ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-300'
                      : 'border-zinc-700 bg-zinc-800/60 text-zinc-400'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Supplements */}
          <div>
            <div className="mb-1.5 font-mono text-xs tracking-wide text-zinc-500 uppercase">
              supplements
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SUPPLEMENTS.map((s) => (
                <Chip
                  key={s}
                  active={supplements.includes(s)}
                  tone="sky"
                  onClick={() => toggleSupp(s)}
                >
                  {SUPP_LABEL[s]}
                </Chip>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <div className="mb-1.5 font-mono text-xs tracking-wide text-zinc-500 uppercase">
              notes
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={(e) => commitNotes(e.target.value)}
              rows={2}
              placeholder="Caldo, stanco, dolore schiena…"
              className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-950/60 px-3 py-2.5 text-sm outline-none focus:border-sky-500/60"
            />
          </div>
        </div>
      )}
    </div>
  )
}
