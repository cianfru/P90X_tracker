import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { sync, syncEnabled } from './syncClient'
import { googleActive } from './googleAuth'

/*
 * Drives background sync without ever blocking the UI: runs on mount, when the
 * device comes online, on a 30s heartbeat, and shortly after new rows land in
 * the outbox. Overlapping runs are guarded inside sync(). Exposes the pending
 * count + a syncing flag for a lightweight header indicator. Disabled while
 * Google Sheets is the active backend (that path drains the same outbox).
 */
export function useSync(): { enabled: boolean; pending: number; syncing: boolean } {
  const enabled = syncEnabled() && !googleActive()
  const pending = useLiveQuery(() => db.outbox.count()) ?? 0
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const run = async () => {
      if (cancelled || !navigator.onLine) return
      setSyncing(true)
      try {
        await sync()
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
  }, [enabled])

  // Nudge a sync soon after new work is queued (debounced).
  useEffect(() => {
    if (!enabled || pending === 0 || !navigator.onLine) return
    const t = setTimeout(() => void sync(), 1500)
    return () => clearTimeout(t)
  }, [enabled, pending])

  return { enabled, pending, syncing }
}
