import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, Plane, Trash2, Upload } from 'lucide-react'
import { db } from '../db'
import { clearRosterDays, saveRosterDays } from '../db/repo'
import { useSwipeBack } from '../lib/gestures'
import { auraFor, ON_ACCENT, PROGRAM_ACCENT, setAura } from '../logger/programColor'
import { importRosterPdf, readinessColor, readinessLabel } from './roster'

/*
 * Roster import — upload the month's roster PDF, get a training-aware calendar.
 *
 * Parsed entirely on-device: the file is read in the browser, never uploaded
 * anywhere. Works in the crew bus with no signal, and the roster (which is
 * personal, rostered work data) never leaves the phone.
 */

const ACCENT = PROGRAM_ACCENT.P90X2

/** Default home base. Overridable because bases change and crew swap fleets. */
const BASE_KEY = 'p90x.roster.base'
const TZ_KEY = 'p90x.roster.tz'
const DEFAULT_BASE = 'DOH'
const DEFAULT_TZ = 'Asia/Qatar'

export function RosterImport({ onBack }: { onBack: () => void }) {
  const days = useLiveQuery(() => db.rosterDays.toArray()) ?? []
  const fileRef = useRef<HTMLInputElement>(null)

  const [base, setBase] = useState(
    () => localStorage.getItem(BASE_KEY) ?? DEFAULT_BASE,
  )
  const [tz, setTz] = useState(() => localStorage.getItem(TZ_KEY) ?? DEFAULT_TZ)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])

  useSwipeBack(onBack)
  // Every screen owns its aura; this one borrows the P90X2 blue it's accented
  // with, so the page glow matches like the rest of the app.
  useEffect(() => setAura(auraFor('P90X2')), [])

  async function upload(file: File) {
    setBusy(true)
    setError(null)
    setResult(null)
    setNotes([])
    try {
      localStorage.setItem(BASE_KEY, base)
      localStorage.setItem(TZ_KEY, tz)
      const r = await importRosterPdf(file, {
        homeBase: base.trim().toUpperCase(),
        homeTz: tz.trim(),
      })
      await saveRosterDays(r.days)
      setResult(
        `${r.dutyDays} duty day${r.dutyDays === 1 ? '' : 's'}, ${r.offDays} off · times read as ${r.basis}`,
      )
      // Surface what the parser wasn't sure about rather than hiding it — a
      // silently-wrong roster is worse than a flagged one.
      setNotes([
        ...r.warnings,
        ...(r.unknownAirports.length
          ? [
              `Unknown airport code${r.unknownAirports.length > 1 ? 's' : ''}: ${r.unknownAirports.join(', ')} — treated as UTC.`,
            ]
          : []),
      ])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // Days from today onward. A roster that's entirely in the past (an old month
  // re-imported) would otherwise leave an empty list under a heading, so fall
  // back to showing what was imported and say which it is.
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : 1))
  const today = new Date().toISOString().slice(0, 10)
  const ahead = sorted.filter((d) => d.date >= today)
  const shown = (ahead.length ? ahead : sorted).slice(0, 12)
  const listLabel = ahead.length ? 'Next days' : 'Imported days'

  return (
    <div className="mx-auto min-h-full max-w-md px-4 pt-3 pb-28">
      <button
        onClick={onBack}
        className="press mb-5 flex items-center gap-1 text-sm font-semibold text-ink-2"
      >
        <ChevronLeft size={18} /> Back
      </button>

      <div className="mb-5 flex items-center gap-2.5">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: `${ACCENT}22`, color: ACCENT }}
        >
          <Plane size={22} />
        </span>
        <div>
          <h2 className="display text-2xl">Roster</h2>
          <p className="text-[13px] text-ink-3">
            Upload the month's PDF — the plan works around your flying.
          </p>
        </div>
      </div>

      <div className="card space-y-3 p-4">
        {/* Base + timezone only. The month and the time basis come out of the
            PDF header — asking for what the file already says is just another
            thing to get wrong. */}
        <div className="grid grid-cols-[7rem_1fr] gap-3">
          <label className="block">
            <span className="eyebrow mb-1 block">Home base</span>
            <input
              value={base}
              onChange={(e) => setBase(e.target.value)}
              placeholder="DOH"
              maxLength={4}
              className="nums w-full rounded-xl border border-hair bg-white/[0.04] px-3 py-2 text-sm uppercase"
            />
          </label>
          <label className="block">
            <span className="eyebrow mb-1 block">Base timezone</span>
            <input
              value={tz}
              onChange={(e) => setTz(e.target.value)}
              placeholder="Asia/Qatar"
              className="w-full rounded-xl border border-hair bg-white/[0.04] px-3 py-2 text-sm"
            />
          </label>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void upload(f)
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="press flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-60"
          style={{ background: ACCENT, color: ON_ACCENT }}
        >
          <Upload size={16} />
          {busy ? 'Reading…' : 'Upload roster PDF'}
        </button>

        {busy && (
          <p className="text-center text-[12px] text-ink-3">
            Reading the grid on this device — the file is never uploaded.
          </p>
        )}
        {error && (
          <p className="rounded-xl border border-rose-400/30 bg-rose-400/[0.08] px-3 py-2 text-[12.5px] text-rose-300">
            {error}
          </p>
        )}
        {result && (
          <p className="rounded-xl border border-[#34f5a0]/30 bg-[#34f5a0]/[0.08] px-3 py-2 text-[12.5px] text-[#34f5a0]">
            Imported {result}
          </p>
        )}
        {notes.map((n) => (
          <p
            key={n}
            className="rounded-xl border border-amber-400/30 bg-amber-400/[0.08] px-3 py-2 text-[12.5px] text-amber-300"
          >
            {n}
          </p>
        ))}
      </div>

      {days.length > 0 && (
        <>
          <div className="mt-6 mb-2 flex items-center justify-between">
            <span className="eyebrow">{listLabel}</span>
            <button
              onClick={() => void clearRosterDays()}
              className="press flex items-center gap-1 text-[12px] font-semibold text-ink-3"
            >
              <Trash2 size={13} /> Clear
            </button>
          </div>
          <div className="space-y-2">
            {shown.map((d) => (
              <div key={d.date} className="card flex items-center gap-3 px-4 py-3">
                <span
                  className={`nums flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-xl text-[10px] leading-none font-bold ${
                    d.duty
                      ? 'bg-white/[0.06] text-ink-2'
                      : 'bg-white/[0.03] text-ink-3'
                  }`}
                >
                  <span className="text-[13px]">{d.date.slice(8)}</span>
                  <span className="opacity-70">
                    {new Date(d.date + 'T00:00')
                      .toLocaleDateString('en-GB', { weekday: 'short' })
                      .toUpperCase()}
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {d.note}
                  </span>
                  <span className="block text-[12px] text-ink-3">
                    {d.window === 'full'
                      ? 'Full session fits'
                      : 'Short session fits'}
                  </span>
                </span>
                <span
                  className="shrink-0 text-[12px] font-bold"
                  style={{ color: readinessColor(d.readiness) }}
                  title={`readiness ${d.readiness}`}
                >
                  {readinessLabel(d.readiness)}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[12px] leading-snug text-ink-3">
            Readiness is training capacity, not cockpit alertness — a long duty can
            leave you sharp but with little evening. The rotation still decides
            what's next; this only flags where it'll hurt.
          </p>
        </>
      )}
    </div>
  )
}
