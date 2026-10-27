/*
 * Google sign-in via Google Identity Services (GIS), token model — used ONCE
 * per device.
 *
 * IDENTITY ONLY. Signing in tells the backend which account you are — nothing
 * more. Your data lives in Dexie on the device and in Postgres keyed by your
 * Google user id; the app never reads or writes anything in your Google
 * account.
 *
 * The Google token lives an hour, and getting a new one — even "silently" —
 * opens a Google window, which in an iPhone home-screen app is a blank white
 * page you have to dismiss. Doing that on every app open was the old flow. Now
 * the one sign-in is traded with our backend for a long-lived DEVICE token
 * (see /auth/device), and every sync after that uses it. Google is never
 * contacted again until you sign out.
 */

import { syncUrl } from './apiBase'

// `openid email profile` and nothing else.
//
// This used to also request `drive.file`, from when sync wrote a spreadsheet to
// your Drive. That backend is long gone, but the scope stayed behind — so every
// sign-in still asked permission to touch Drive files, for a capability the app
// no longer has. Asking for access you don't use is how consent screens get
// noisy and how people learn to click through them.
//
// These three are the "non-sensitive" identity scopes: no Google consent screen
// beyond picking an account, no verification needed, and nothing to grant.
const SCOPE = 'openid email profile'

const CLIENT_ID_KEY = 'p90x-google-client-id'
const ACCOUNT_KEY = 'p90x-google-account'
const DEVICE_KEY = 'p90x-device-token'

// One-time migration on load: an account remembered WITHOUT a device token is
// from the hourly-Google-token era. Forget it so the app shows "Local only"
// and offers sign-in — one last Google window, and then never again.
try {
  if (localStorage.getItem(ACCOUNT_KEY) && !localStorage.getItem(DEVICE_KEY)) {
    localStorage.removeItem(ACCOUNT_KEY)
  }
  localStorage.removeItem('p90x-google-granted-scope')
} catch {
  /* storage unavailable — nothing to migrate */
}

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

/** True when someone is signed in on this device (and so syncing). */
export const googleActive = (): boolean =>
  googleConfigured() && cachedAccount() !== null && deviceToken() !== null

/** This device's sync token, issued by the backend at sign-in. */
export function deviceToken(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY)
  } catch {
    return null
  }
}

/** Forget the account on this device without contacting anyone. */
export function forgetDevice(): void {
  localStorage.removeItem(DEVICE_KEY)
  localStorage.removeItem(ACCOUNT_KEY)
}

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

/** Ask Google for an access token — this is the popup, so only on a tap. */
function requestToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    ensureTokenClient()
      .then((client) => {
        client.callback = (resp: TokenResponse) => {
          if (resp.error || !resp.access_token) {
            reject(new Error(resp.error || 'No access token'))
            return
          }
          resolve(resp.access_token)
        }
        // An empty prompt: Google shows its account chooser when it needs to
        // and nothing more — identity scopes have nothing to consent to.
        client.requestAccessToken({ prompt: '' })
      })
      .catch(reject)
  })
}

async function fetchProfile(token: string): Promise<GoogleAccount> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Could not read Google profile')
  const j = (await res.json()) as { email: string; name?: string; picture?: string }
  return { email: j.email, name: j.name ?? j.email, picture: j.picture }
}

/**
 * Interactive sign-in: one Google popup, then link this device. The account
 * is only remembered once the device token is in hand, so a half-finished
 * sign-in never leaves the app thinking it's syncing.
 */
export async function signIn(): Promise<GoogleAccount> {
  const token = await requestToken()
  const account = await fetchProfile(token)
  const res = await fetch(`${syncUrl()}/auth/device`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Could not link this device (${res.status})`)
  const { token: device } = (await res.json()) as { token: string }
  localStorage.setItem(DEVICE_KEY, device)
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account))
  return account
}

/** Sign this device out: forget it locally and revoke its token server-side. */
export async function signOut(): Promise<void> {
  const device = deviceToken()
  forgetDevice()
  if (device) {
    await fetch(`${syncUrl()}/auth/revoke`, {
      method: 'POST',
      headers: { authorization: `Bearer ${device}` },
    }).catch(() => {})
  }
}
