import { lazy, Suspense, useEffect, useState } from 'react'
import {
  Dumbbell,
  Loader2,
  RefreshCw,
  TrendingUp,
  WifiOff,
  Wifi,
} from 'lucide-react'
import { useOnlineStatus } from './lib/useOnlineStatus'
import { ensureSeeded, needsHistorySeed, seedHistory } from './db'
import { useSync } from './sync/useSync'
import { Home } from './logger/Home'
import { Session } from './logger/Session'

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
  const online = useOnlineStatus()
  const syncState = useSync()

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
      }
    })()
  }, [])

  if (sessionId) {
    return (
      <div className="mx-auto min-h-full max-w-md">
        <Session sessionId={sessionId} onBack={() => setSessionId(null)} />
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col">
      <header className="flex items-center justify-between px-4 pt-8 pb-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">P90X Logbook</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Local-first · works fully offline
          </p>
        </div>
        <div className="flex items-center gap-2">
          {syncState.enabled &&
            importPct === null &&
            (syncState.syncing || syncState.pending > 0) && (
              <span
                className="flex items-center gap-1 font-mono text-xs text-zinc-500"
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
            <span className="flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 font-mono text-xs text-sky-300">
              <Loader2 size={13} className="animate-spin" />
              importing {importPct}%
            </span>
          ) : (
            <ConnPill online={online} />
          )}
        </div>
      </header>

      <main className="flex-1 px-4 pb-24">
        {view === 'home' ? (
          <Home onOpen={setSessionId} />
        ) : (
          <Suspense
            fallback={
              <div className="mt-16 text-center font-mono text-sm text-zinc-500">
                loading analytics…
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
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs ${
        online
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
      }`}
      title={online ? 'Online — will sync' : 'Offline — logging locally'}
    >
      {online ? <Wifi size={13} /> : <WifiOff size={13} />}
      {online ? 'online' : 'offline'}
    </span>
  )
}

function NavBar({ view, setView }: { view: View; setView: (v: View) => void }) {
  const item = (id: View, Icon: typeof Dumbbell, label: string) => (
    <button
      onClick={() => setView(id)}
      className={`flex flex-1 flex-col items-center gap-1 py-3 transition ${
        view === id ? 'text-emerald-400' : 'text-zinc-500'
      }`}
    >
      <Icon size={20} />
      <span className="text-xs font-medium tracking-wide">{label}</span>
    </button>
  )
  return (
    <nav className="fixed inset-x-0 bottom-0 border-t border-zinc-800 bg-zinc-900/95 backdrop-blur">
      <div className="mx-auto flex max-w-md">
        {item('home', Dumbbell, 'Train')}
        {item('monitor', TrendingUp, 'Monitor')}
      </div>
    </nav>
  )
}
