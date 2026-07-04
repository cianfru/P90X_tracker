import { lazy, Suspense, useEffect, useState } from 'react'
import {
  Activity,
  CalendarDays,
  Cloud,
  CloudOff,
  Dumbbell,
  LineChart,
  Loader2,
  Map as MapIcon,
  RefreshCw,
  UserRound,
} from 'lucide-react'
import { PullToRefresh } from './lib/gestures'
import { fmtAgo } from './lib/id'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  db,
  ensureSeeded,
  needsHistorySeed,
  seedHistory,
  seedHistoryMeta,
} from './db'
import { useSync } from './sync/useSync'
import { cachedAccount, googleActive } from './sync/googleAuth'
import { migrationDone } from './sync/googleSheets'
import { useGoogleSync } from './sync/useGoogleSync'
import { Home } from './logger/Home'
import { Session } from './logger/Session'
import { Account } from './logger/Account'
import { Mixer } from './logger/Mixer'

// Charts (Recharts) are heavy — load them only when the Monitor is opened so the
// gym-side logger stays lightweight.
const Monitor = lazy(() =>
  import('./monitor/Monitor').then((m) => ({ default: m.Monitor })),
)

/*
 * App shell + navigation. Home and Session (the logger) are wired to Dexie;
 * the analytics Monitor lands in Phase 5. A running session takes over the
 * screen (its own header, no bottom nav) for one-handed logging at the gym.
 */

type View = 'home' | 'overview' | 'month' | 'map' | 'exercise'

export default function App() {
  const [view, setView] = useState<View>('home')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [importPct, setImportPct] = useState<number | null>(null)
  const [showAccount, setShowAccount] = useState(false)
  const [showMixer, setShowMixer] = useState(false)
  const [, bumpAccount] = useState(0)
  // Brief branded launch splash — fade it out shortly after mount.
  const [splash, setSplash] = useState<'show' | 'fade' | 'gone'>('show')
  useEffect(() => {
    const t1 = setTimeout(() => setSplash('fade'), 1300)
    const t2 = setTimeout(() => setSplash('gone'), 1800)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [])
  const gActive = googleActive()
  const syncState = useSync() // no-ops while Google is the active backend
  // Auto-sync only after the account's first-run migration choice is done.
  const gSync = useGoogleSync(gActive && migrationDone())
  const lastSyncAt = useLiveQuery(
    async () => (await db.meta.get('lastSyncAt'))?.value as number | undefined,
  )

  useEffect(() => {
    void (async () => {
      await ensureSeeded()
      if (await needsHistorySeed()) {
        setImportPct(0)
        try {
          await seedHistory((done, total) =>
            setImportPct(Math.round((done / total) * 100)),
          )
        } finally {
          setImportPct(null)
        }
      } else {
        // Backfill location/form/notes/supplements onto a pre-existing import.
        await seedHistoryMeta()
      }
    })()
  }, [])

  if (showAccount) {
    return (
      <Account
        onBack={() => setShowAccount(false)}
        onChange={() => bumpAccount((n) => n + 1)}
      />
    )
  }

  if (showMixer) {
    return (
      <Mixer
        onBack={() => setShowMixer(false)}
        onStart={(id) => {
          setShowMixer(false)
          setSessionId(id)
        }}
      />
    )
  }

  if (sessionId) {
    return (
      <div className="mx-auto min-h-full max-w-md">
        <Session sessionId={sessionId} onBack={() => setSessionId(null)} />
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col">
      {splash !== 'gone' && <Splash fading={splash === 'fade'} />}
      <header className="frost sticky top-0 z-20 flex items-center justify-between gap-3 px-4 pt-5 pb-3">
        <img
          src="/header-banner.png"
          alt="P90X Workout Logger"
          className="h-16 w-auto shrink-0 select-none"
        />
        <div className="flex items-center gap-2">
          {!gActive &&
            syncState.enabled &&
            importPct === null &&
            (syncState.syncing || syncState.pending > 0) && (
              <span
                className="nums flex items-center gap-1 text-xs text-ink-3"
                title={
                  syncState.pending > 0
                    ? `${syncState.pending} change(s) pending sync`
                    : 'syncing'
                }
              >
                <RefreshCw
                  size={12}
                  className={syncState.syncing ? 'animate-spin' : ''}
                />
                {syncState.pending > 0 ? syncState.pending : ''}
              </span>
            )}
          {importPct !== null ? (
            <span className="nums flex items-center gap-1.5 rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1.5 text-xs font-semibold text-sky-300">
              <Loader2 size={13} className="animate-spin" />
              {importPct}%
            </span>
          ) : gActive ? (
            <button
              onClick={() => setShowAccount(true)}
              title="Backup status — tap to manage"
              className={`nums press flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${
                gSync.pending > 0
                  ? 'border-amber-400/30 bg-amber-400/10 text-amber-300'
                  : 'border-[#34f5a0]/30 bg-[#34f5a0]/10 text-[#34f5a0]'
              }`}
            >
              <Cloud
                size={13}
                className={gSync.syncing ? 'animate-pulse' : ''}
              />
              {gSync.pending > 0
                ? `Backing up ${gSync.pending}`
                : lastSyncAt
                  ? fmtAgo(lastSyncAt)
                  : 'Backed up'}
            </button>
          ) : (
            <button
              onClick={() => setShowAccount(true)}
              title="Not backing up — tap to connect Google and protect your data"
              className="press flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-amber-300"
            >
              <CloudOff size={13} /> Not backed up
            </button>
          )}
          <button
            onClick={() => setShowAccount(true)}
            aria-label="account"
            className="press flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-hair bg-white/[0.04] text-ink-2"
          >
            {cachedAccount()?.picture ? (
              <img
                src={cachedAccount()!.picture}
                alt=""
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <UserRound size={17} />
            )}
          </button>
        </div>
      </header>

      <main className="flex-1 px-4 pb-32">
        {view === 'home' ? (
          <PullToRefresh onRefresh={() => window.location.reload()}>
            <Home onOpen={setSessionId} onMix={() => setShowMixer(true)} />
          </PullToRefresh>
        ) : (
          <Suspense
            fallback={
              <div className="mt-16 text-center text-sm text-ink-3">
                Loading analytics…
              </div>
            }
          >
            <Monitor tab={view} />
          </Suspense>
        )}
      </main>

      <NavBar view={view} setView={setView} />
    </div>
  )
}

function Splash({ fading }: { fading: boolean }) {
  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center px-8 transition-opacity duration-500 ${
        fading ? 'opacity-0' : 'opacity-100'
      }`}
      style={{
        background:
          'radial-gradient(120% 70% at 50% 55%, rgba(59,255,158,0.16), transparent 62%), var(--color-canvas)',
      }}
    >
      <img
        src="/header-banner.png"
        alt="P90X Workout Logger"
        className="w-full max-w-sm animate-[splashIn_0.6s_ease-out] select-none"
      />
    </div>
  )
}

const NAV: { id: View; Icon: typeof Dumbbell; label: string }[] = [
  { id: 'home', Icon: Dumbbell, label: 'Train' },
  { id: 'overview', Icon: Activity, label: 'Overview' },
  { id: 'month', Icon: CalendarDays, label: 'Month' },
  { id: 'map', Icon: MapIcon, label: 'Map' },
  { id: 'exercise', Icon: LineChart, label: 'Exercise' },
]

function NavBar({ view, setView }: { view: View; setView: (v: View) => void }) {
  return (
    <nav className="frost fixed inset-x-0 bottom-0 z-20 border-t border-hair pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-md px-1.5">
        {NAV.map(({ id, Icon, label }) => {
          const active = view === id
          return (
            <button
              key={id}
              onClick={() => setView(id)}
              aria-label={label}
              className="press relative flex flex-1 flex-col items-center gap-1 py-2.5"
            >
              <span
                className={`flex h-8 w-14 items-center justify-center rounded-full transition ${
                  active ? 'bg-[#37e29a]/15 text-[#37e29a]' : 'text-ink-3'
                }`}
              >
                <Icon size={19} strokeWidth={active ? 2.5 : 2} />
              </span>
              <span
                className={`text-[10px] font-semibold ${active ? 'text-ink' : 'text-ink-3'}`}
              >
                {label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
