import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Dumbbell, TrendingUp, WifiOff, Wifi } from 'lucide-react'
import { useOnlineStatus } from './lib/useOnlineStatus'
import { db, ensureSeeded } from './db'

/*
 * Phase 2 — data model in place.
 *
 * The Dexie schema, typed models, and bundled exercise catalog + workout
 * templates are seeded on boot. The frame still shows placeholders; the real
 * logger (Phase 3) and analytics Monitor (Phase 5) fill them in. The Home
 * placeholder now reads live counts straight from IndexedDB to prove the wiring.
 */

type View = 'home' | 'monitor'

export default function App() {
  const [view, setView] = useState<View>('home')
  const online = useOnlineStatus()

  // Populate the bundled catalog/templates on first paint (idempotent upsert).
  useEffect(() => {
    void ensureSeeded()
  }, [])

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col">
      <header className="flex items-center justify-between px-4 pt-8 pb-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">P90X Logbook</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Local-first · works fully offline
          </p>
        </div>
        <ConnPill online={online} />
      </header>

      <main className="flex-1 px-4 pb-24">
        {view === 'home' ? <HomePlaceholder /> : <MonitorPlaceholder />}
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

function HomePlaceholder() {
  const exerciseCount = useLiveQuery(() => db.exercises.count())
  const templateCount = useLiveQuery(() => db.templates.count())
  const seeded = exerciseCount !== undefined && exerciseCount > 0

  return (
    <>
      <Placeholder
        icon={<Dumbbell size={26} className="text-emerald-400/70" />}
        title="Train"
        body="Pick a workout and log sets two taps at a time. The logger UI arrives in Phase 3, wired to an on-device database so it never waits on the network."
      />
      <div className="mt-3 rounded-2xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
        <p className="font-mono text-xs tracking-wide text-zinc-500">
          on-device catalog
        </p>
        <p className="mt-1 font-mono text-sm text-emerald-300">
          {seeded
            ? `${exerciseCount} exercises · ${templateCount} workouts`
            : 'seeding…'}
        </p>
      </div>
    </>
  )
}

function MonitorPlaceholder() {
  return (
    <Placeholder
      icon={<TrendingUp size={26} className="text-sky-400/70" />}
      title="Monitor"
      body="Seven years of progression — PRs, tonnage, consistency, the harder-variant story. Analytics arrive in Phase 5, computed on-device so they work offline too."
    />
  )
}

function Placeholder({
  icon,
  title,
  body,
}: {
  icon: ReactNode
  title: string
  body: string
}) {
  return (
    <div className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
      <div className="flex items-center gap-3">
        {icon}
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-zinc-400">{body}</p>
      <p className="mt-4 font-mono text-xs tracking-wide text-zinc-600">
        shell ready · installable · offline-cached
      </p>
    </div>
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
