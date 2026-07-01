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
  })
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
