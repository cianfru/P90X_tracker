/**
 * The sync API lives at /api on the app's OWN origin (it ships as serverless
 * functions in this same deployment), so there is nothing to configure. A
 * custom URL is only honoured for a self-hosted server on another origin.
 */
export const syncUrl = (): string => {
  const custom = (import.meta.env.VITE_SYNC_URL || '').toString().replace(/\/$/, '')
  if (custom) return custom
  return typeof location !== 'undefined' ? `${location.origin}/api` : ''
}
