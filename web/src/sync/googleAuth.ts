/*
 * Google sign-in via Google Identity Services (GIS), token model — no backend.
 * We request a short-lived access token for the Drive/Sheets scope plus basic
 * profile, so each person's data lives in their own Drive and accounts are
 * naturally separate. Tokens are refreshed silently while the app is open;
 * daily logging never needs any of this (it's local-first) — auth only gates
 * backup/restore. The app works fully without a Client ID configured.
 */

// Drive.file: access only to files this app creates (the logbook sheet) — a
// non-sensitive scope, so the consent screen stays friendly. Plus identity.
const SCOPE =
  'https://www.googleapis.com/auth/drive.file openid email profile'

const CLIENT_ID_KEY = 'p90x-google-client-id'
const ACCOUNT_KEY = 'p90x-google-account'

// The app's public OAuth Client ID (not a secret — it's embedded in any browser
// app). Baked in so sign-in works out of the box on every device; a settings
// field or VITE_GOOGLE_CLIENT_ID env var can still override it.
const DEFAULT_CLIENT_ID =
  '263131716163-qb9qeodvseeff1l776ge27asfbcl6lcl.apps.googleusercontent.com'

export interface GoogleAccount {
  email: string
  name: string
  picture?: string
}

/** The OAuth Client ID (public app identifier) from settings or build env. */
export function googleClientId(): string {
  return (
    localStorage.getItem(CLIENT_ID_KEY) ||
    (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ||
    DEFAULT_CLIENT_ID
  )
}
export function setGoogleClientId(id: string): void {
  const v = id.trim()
  if (v) localStorage.setItem(CLIENT_ID_KEY, v)
  else localStorage.removeItem(CLIENT_ID_KEY)
}
export const googleConfigured = (): boolean => googleClientId().length > 0

/** True when Google is set up AND someone is signed in (Google is the backend). */
export const googleActive = (): boolean =>
  googleConfigured() && cachedAccount() !== null

/** Last signed-in account (cached for the account UI). */
export function cachedAccount(): GoogleAccount | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY)
    return raw ? (JSON.parse(raw) as GoogleAccount) : null
  } catch {
    return null
  }
}

// ---- GIS script + token client (loaded lazily, once) ----

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
}
interface TokenClient {
  requestAccessToken: (opts?: { prompt?: string }) => void
  callback: (r: TokenResponse) => void
}
interface GoogleGIS {
  accounts: {
    oauth2: {
      initTokenClient: (cfg: {
        client_id: string
        scope: string
        callback: (r: TokenResponse) => void
      }) => TokenClient
      revoke: (token: string, done?: () => void) => void
    }
  }
}
declare global {
  interface Window {
    google?: GoogleGIS
  }
}

let gisPromise: Promise<void> | null = null
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (gisPromise) return gisPromise
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Failed to load Google sign-in'))
    document.head.appendChild(s)
  })
  return gisPromise
}

let tokenClient: TokenClient | null = null
let accessToken: string | null = null
let tokenExpiry = 0 // epoch ms

async function ensureTokenClient(): Promise<TokenClient> {
  const clientId = googleClientId()
  if (!clientId) throw new Error('Google Client ID not set')
  await loadGis()
  if (!tokenClient) {
    tokenClient = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: () => {}, // replaced per-request below
    })
  }
  return tokenClient
}

/** Request an access token; `interactive` shows the consent/account popup. */
function requestToken(interactive: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    ensureTokenClient()
      .then((client) => {
        client.callback = (resp: TokenResponse) => {
          if (resp.error || !resp.access_token) {
            reject(new Error(resp.error || 'No access token'))
            return
          }
          accessToken = resp.access_token
          tokenExpiry = Date.now() + (resp.expires_in ?? 3600) * 1000
          resolve(resp.access_token)
        }
        // Empty prompt = silent (reuse existing grant); 'consent'/'' as needed.
        client.requestAccessToken({ prompt: interactive ? '' : 'none' })
      })
      .catch(reject)
  })
}

/** A valid access token, refreshing silently if the cached one is stale. */
export async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiry - 60_000) return accessToken
  return requestToken(false)
}

async function fetchProfile(token: string): Promise<GoogleAccount> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Could not read Google profile')
  const j = (await res.json()) as { email: string; name?: string; picture?: string }
  return { email: j.email, name: j.name ?? j.email, picture: j.picture }
}

/** Interactive sign-in: shows Google's account/consent popup, returns account. */
export async function signIn(): Promise<GoogleAccount> {
  const token = await requestToken(true)
  const account = await fetchProfile(token)
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account))
  return account
}

/** Forget the current account locally and revoke the token. */
export async function signOut(): Promise<void> {
  const tok = accessToken
  accessToken = null
  tokenExpiry = 0
  localStorage.removeItem(ACCOUNT_KEY)
  if (tok && window.google?.accounts?.oauth2) {
    await new Promise<void>((r) =>
      window.google!.accounts.oauth2.revoke(tok, () => r()),
    )
  }
}
