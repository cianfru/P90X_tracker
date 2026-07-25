import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, Plane, Trash2, Upload } from 'lucide-react'
import { db } from '../db'
import { clearRosterDays, saveRosterDays } from '../db/repo'
import { useSwipeBack } from '../lib/gestures'
import { analyseRoster, readinessColor, readinessLabel } from './aerowake'

/*
 * Roster import — upload the month's roster PDF, get a training-aware calendar.
 *
 * The PDF goes to Aerowake, which parses it and runs the fatigue model; we keep
 * only the per-day capacity it implies. This is the one screen in the app that
 * needs a connection, and it's a once-a-month action — nothing about logging or
 * viewing the schedule ever touches the network.
 */

const ACCENT = '#33cbff'

/** Default home base. Overridable because bases change and crew swap fleets. */
const BASE_KEY = 'p90x.roster.base'
const TZ_KEY = 'p90x.roster.tz'
const DEFAULT_BASE = 'DOH'
const DEFAULT_TZ = 'Asia/Qatar'

const thisMonth = () => new Date().toISOString().slice(0, 7)

export function RosterImport({ onBack }: { onBack: () => void }) {
  const days = useLiveQuery(() => db.rosterDays.toArray()) ?? []
  const fileRef = useRef<HTMLInputElement>(null)

  const [month, setMonth] = useState(thisMonth)
  const [base, setBase] = useState(
    () => localStorage.getItem(BASE_KEY) ?? DEFAULT_BASE,
  )
  const [tz, setTz] = useState(() => localStorage.getItem(TZ_KEY) ?? DEFAULT_TZ)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  useSwipeBack(onBack)

  async function upload(file: File) {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      localStorage.setItem(BASE_KEY, base)
      localStorage.setItem(TZ_KEY, tz)
      const r = await analyseRoster(file, {
        month,
        homeBase: base.trim().toUpperCase(),
        homeTimezone: tz.trim(),
      })
      await saveRosterDays(r.days)
      setResult(
        `${r.month}: ${r.dutyDays} duty day${r.dutyDays === 1 ? '' : 's'}, ${r.restDays} off`,
      )
    } catch (e) {
      // Offline is the likeliest failure and deserves a plain explanation
      // rather than a stack-flavoured one.
      const msg = e instanceof Error ? e.message : String(e)
      setError(
        /fetch|network|failed to fetch/i.test(msg)
          ? "Couldn't reach Aerowake — check your connection and try again."
          : msg,
      )
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const upcoming = days
    .filter((d) => d.date >= new Date().toISOString().slice(0, 10))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(0, 10)

  return (
    <div className="mx-auto max-w-md px-4 pb-24">
      <button
        onClick={onBack}
        className="press -ml-2 mt-4 flex items-center gap-1 text-sm font-semibold text-ink-2"
      >
        <ChevronLeft size={18} /> Back
      </button>

      <div className="mt-4 flex items-center gap-3">
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: `${ACCENT}1f`, color: ACCENT }}
        >
          <Plane size={22} />
        </span>
        <div>
          <h1 className="display text-2xl">Roster</h1>
          <p className="text-[13px] text-ink-3">
            Upload the month's PDF — the plan works around your flying.
          </p>
        </div>
      </div>

      <div className="card mt-5 space-y-3 p-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="eyebrow mb-1 block">Month</span>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="nums w-full rounded-xl border border-hair bg-white/[0.04] px-3 py-2 text-sm"
            />
          </label>
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
        </div>
        <label className="block">
          <span className="eyebrow mb-1 block">Base timezone</span>
          <input
            value={tz}
            onChange={(e) => setTz(e.target.value)}
            placeholder="Asia/Qatar"
            className="w-full rounded-xl border border-hair bg-white/[0.04] px-3 py-2 text-sm"
          />
        </label>

        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.csv,application/pdf,text/csv"
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
          style={{ background: ACCENT, color: '#04121a' }}
        >
          <Upload size={16} />
          {busy ? 'Analysing…' : 'Upload roster PDF'}
        </button>

        {busy && (
          <p className="text-center text-[12px] text-ink-3">
            Parsing and running the fatigue model — a few seconds.
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
      </div>

      {days.length > 0 && (
        <>
          <div className="mt-6 mb-2 flex items-center justify-between">
            <span className="eyebrow">Next days</span>
            <button
              onClick={() => void clearRosterDays()}
              className="press flex items-center gap-1 text-[12px] font-semibold text-ink-3"
            >
              <Trash2 size={13} /> Clear
            </button>
          </div>
          <div className="space-y-1.5">
            {upcoming.map((d) => (
              <div
                key={d.date}
                className="flex items-center gap-3 rounded-xl border border-hair bg-white/[0.02] px-3.5 py-2.5"
              >
                <span className="nums w-11 shrink-0 text-[12px] text-ink-3">
                  {new Date(d.date + 'T00:00')
                    .toLocaleDateString('en-GB', {
                      weekday: 'short',
                      day: 'numeric',
                    })
                    .toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
                  {d.note}
                </span>
                <span
                  className="nums shrink-0 text-[12px] font-bold"
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
            leave you sharp but with no evening. The rotation still decides what's
            next; this only flags where it'll hurt.
          </p>
        </>
      )}
    </div>
  )
}
