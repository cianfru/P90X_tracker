import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { googleActive } from './googleAuth'
import { syncGoogle } from './googleSheets'

/*
 * Background Google-Sheets sync — the same shape as useSync, but pushes/pulls
 * against the signed-in user's spreadsheet. Runs on mount, on reconnect, on a
 * heartbeat, and shortly after new rows queue. Never blocks the UI.
 */
export function useGoogleSync(active: boolean): {
  pending: number
  syncing: boolean
} {
  const pending = useLiveQuery(() => db.outbox.count()) ?? 0
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const run = async () => {
      if (cancelled || !navigator.onLine) return
      setSyncing(true)
      try {
        await syncGoogle()
      } finally {
        if (!cancelled) setSyncing(false)
      }
    }
    void run()
    const iv = setInterval(run, 30_000)
    window.addEventListener('online', run)
    return () => {
      cancelled = true
      clearInterval(iv)
      window.removeEventListener('online', run)
    }
  }, [active])

  useEffect(() => {
    if (!active || pending === 0 || !navigator.onLine) return
    const t = setTimeout(() => void syncGoogle(), 1500)
    return () => clearTimeout(t)
  }, [active, pending])

  return { pending, syncing }
}

export { googleActive }
