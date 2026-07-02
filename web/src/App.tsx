import { lazy, Suspense, useEffect, useState } from 'react'
import {
  Cloud,
  Dumbbell,
  Loader2,
  RefreshCw,
  TrendingUp,
  UserRound,
  WifiOff,
  Wifi,
} from 'lucide-react'
import { useOnlineStatus } from './lib/useOnlineStatus'
import { ensureSeeded, needsHistorySeed, seedHistory, seedHistoryMeta } from './db'
import { useSync } from './sync/useSync'
import { cachedAccount, googleActive } from './sync/googleAuth'
import { migrationDone } from './sync/googleSheets'
import { useGoogleSync } from './sync/useGoogleSync'
import { Home } from './logger/Home'
import { Session } from './logger/Session'
import { Account } from './logger/Account'

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

type View = 'home' | 'monitor'

export default function App() {
  const [view, setView] = useState<View>('home')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [importPct, setImportPct] = useState<number | null>(null)
  const [showAccount, setShowAccount] = useState(false)
  const [, bumpAccount] = useState(0)
  const online = useOnlineStatus()
  const gActive = googleActive()
  const syncState = useSync() // no-ops while Google is the active backend
  // Auto-sync only after the account's first-run migration choice is done.
  const gSync = useGoogleSync(gActive && migrationDone())

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

  if (sessionId) {
    return (
      <div className="mx-auto min-h-full max-w-md">
        <Session sessionId={sessionId} onBack={() => setSessionId(null)} />
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col">
      <header className="frost sticky top-0 z-20 flex items-center justify-between px-5 pt-7 pb-3">
        <div>
          <h1 className="display text-[26px] leading-none">
            P90<span className="text-[#37e29a]">X</span>
            <span className="font-semibold text-ink-2"> Logbook</span>
          </h1>
          <p className="mt-1.5 text-[13px] font-medium text-ink-3">
            Train anywhere · fully offline
          </p>
        </div>
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
            <span
              className="flex items-center gap-1.5 rounded-full border border-[#34f5a0]/30 bg-[#34f5a0]/10 px-3 py-1.5 text-xs font-semibold text-[#34f5a0]"
              title={
                gSync.pending > 0
                  ? `${gSync.pending} change(s) pending backup`
                  : 'Backed up to Google Sheets'
              }
            >
              <Cloud
                size={13}
                className={gSync.syncing ? 'animate-pulse' : ''}
              />
              {gSync.pending > 0 ? gSync.pending : 'Synced'}
            </span>
          ) : (
            <ConnPill online={online} />
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
          <Home onOpen={setSessionId} />
        ) : (
          <Suspense
            fallback={
              <div className="mt-16 text-center text-sm text-ink-3">
                Loading analytics…
              </div>
            }
          >
            <Monitor />
          </Suspense>
        )}
      </main>

      <NavBar view={view} setView={setView} />
    </div>
  )
}

function ConnPill({ online }: { online: boolean }) {
  return (
    <span
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
        online
          ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
          : 'border-amber-400/30 bg-amber-400/10 text-amber-300'
      }`}
      title={online ? 'Online — will sync' : 'Offline — logging locally'}
    >
      {online ? <Wifi size={13} /> : <WifiOff size={13} />}
      {online ? 'Online' : 'Offline'}
    </span>
  )
}

function NavBar({ view, setView }: { view: View; setView: (v: View) => void }) {
  const item = (id: View, Icon: typeof Dumbbell, label: string) => {
    const active = view === id
    return (
      <button
        onClick={() => setView(id)}
        className="press relative flex flex-1 flex-col items-center gap-1 py-2.5"
      >
        <span
          className={`flex h-9 w-16 items-center justify-center rounded-full transition ${
            active ? 'bg-[#37e29a]/15 text-[#37e29a]' : 'text-ink-3'
          }`}
        >
          <Icon size={20} strokeWidth={active ? 2.5 : 2} />
        </span>
        <span
          className={`text-[11px] font-semibold ${active ? 'text-ink' : 'text-ink-3'}`}
        >
          {label}
        </span>
      </button>
    )
  }
  return (
    <nav className="frost fixed inset-x-0 bottom-0 z-20 border-t border-hair pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-md px-6">
        {item('home', Dumbbell, 'Train')}
        {item('monitor', TrendingUp, 'Progress')}
      </div>
    </nav>
  )
}
