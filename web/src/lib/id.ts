/** UUID for append-only facts. */
export const uid = (): string => crypto.randomUUID()

/** Today's LOCAL calendar day as YYYY-MM-DD (sessions are dated by local day). */
export function todayISO(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Short human date from a YYYY-MM-DD string, parsed as a local day. */
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  })
}

/** Local start time (HH:MM) from a ms timestamp — when a workout began. */
export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Compact "time ago" from a ms timestamp, e.g. "just now", "5m", "2h", "3d". */
export function fmtAgo(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

/** Stable per-device id (used to tag sessions; survives reloads). */
export function getDeviceId(): string {
  const KEY = 'p90x-device-id'
  let id = localStorage.getItem(KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(KEY, id)
  }
  return id
}
