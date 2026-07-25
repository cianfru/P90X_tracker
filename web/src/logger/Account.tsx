import { useEffect, useState } from 'react'
import {
  ChevronLeft,
  Cloud,
  CloudOff,
  Download,
  LogOut,
  Minus,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { getBodyweight, setBodyweight } from './effort'
import { AURA_DEFAULT, setAura } from './programColor'
import { useSwipeBack } from '../lib/gestures'
import { fmtAgo } from '../lib/id'
import { exportCsv } from '../lib/csv'
import { fullPushServer, sync as runSync } from '../sync/syncClient'
import {
  cachedAccount,
  googleClientId,
  googleConfigured,
  setGoogleClientId,
  signIn,
  signOut,
  type GoogleAccount,
} from '../sync/googleAuth'
import { Label } from './ui'

/*
 * Account screen. The app is fully usable without ever coming here — everything
 * is logged locally first. This is only about MEMORY: sign in with Google and
 * your workouts persist to your own account, reachable from any device you sign
 * in on. Your Google identity IS the account; there is nothing to configure,
 * paste or remember. Sign out and the app keeps working, just locally.
 */

type Busy = null | 'signin' | 'backup' | 'sync'

export function Account({
  onBack,
  onChange,
}: {
  onBack: () => void
  onChange: () => void
}) {
  const [account, setAccount] = useState<GoogleAccount | null>(cachedAccount())
  const [clientId, setClientId] = useState(googleClientId())
  const [busy, setBusy] = useState<Busy>(null)
  const [pct, setPct] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [csvMsg, setCsvMsg] = useState<string | null>(null)
  const [bw, setBw] = useState(getBodyweight())
  const lastSyncAt = useLiveQuery(
    async () => (await db.meta.get('lastSyncAt'))?.value as number | undefined,
  )
  useEffect(() => setAura(AURA_DEFAULT), [])
  useSwipeBack(onBack)

  const configured = googleConfigured()

  const changeBw = (delta: number) => {
    const v = Math.max(40, Math.min(200, bw + delta))
    setBw(v)
    setBodyweight(v)
  }

  /* Signing in is the whole setup: authenticate, upload whatever this device
     already has (idempotent — the server upserts by uuid), then pull anything
     logged elsewhere. From then on syncing happens in the background. */
  async function handleSignIn() {
    setError(null)
    setBusy('signin')
    try {
      const acct = await signIn()
      setAccount(acct)
      onChange()
      setBusy('backup')
      await fullPushServer((done, total) =>
        setPct(total ? Math.round((done / total) * 100) : 100),
      )
      setPct(null)
      setBusy('sync')
      await runSync()
      onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
      setPct(null)
    }
  }

  async function handleSignOut() {
    await signOut()
    setAccount(null)
    onChange()
  }

  async function handleSyncNow() {
    setBusy('sync')
    setError(null)
    const r = await runSync()
    if (!r.ok && r.reason) setError(r.reason)
    setBusy(null)
  }

  async function handleForceBackup() {
    setBusy('backup')
    setError(null)
    try {
      await fullPushServer((done, total) =>
        setPct(total ? Math.round((done / total) * 100) : 100),
      )
      onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
      setPct(null)
    }
  }

  async function handleExportCsv() {
    setCsvMsg(null)
    setError(null)
    try {
      const n = await exportCsv()
      setCsvMsg(`Exported ${n.toLocaleString()} sets`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="mx-auto min-h-full max-w-md px-4 pt-5 pb-28">
      <button
        onClick={onBack}
        className="press mb-6 flex items-center gap-1 text-sm font-semibold text-ink-2"
      >
        <ChevronLeft size={18} /> Back
      </button>

      <h2 className="display mb-1 text-2xl">Account</h2>
      <p className="mb-6 text-[13px] text-ink-3">
        The app works fully without signing in — everything is saved on this
        device. Sign in with Google to keep your history in your own account and
        pick it up on any device.
      </p>

      {/* Profile — bodyweight feeds the effort colour coding (vest math). */}
      <div className="card mb-4 flex items-center justify-between p-4">
        <div>
          <div className="text-sm font-semibold">Bodyweight</div>
          <p className="mt-0.5 text-[12px] text-ink-3">
            Used to scale effort on bodyweight moves.
          </p>
        </div>
        <span className="flex items-center gap-2.5">
          <button
            onClick={() => changeBw(-1)}
            aria-label="decrease bodyweight"
            className="press flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-ink-2"
          >
            <Minus size={15} strokeWidth={2.5} />
          </button>
          <span className="nums w-16 text-center text-sm font-bold text-ink">
            {bw} kg
          </span>
          <button
            onClick={() => changeBw(1)}
            aria-label="increase bodyweight"
            className="press flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-ink-2"
          >
            <Plus size={15} strokeWidth={2.5} />
          </button>
        </span>
      </div>

      {/* One-time app setup: the public OAuth Client ID. Baked in by default, so
          this only appears if it was cleared or needs overriding. */}
      {!configured && (
        <div className="card mb-4 p-4">
          <Label>One-time setup</Label>
          <p className="mt-2 text-[13px] text-ink-2">
            Paste the Google OAuth <b>Client ID</b>. It's a public app
            identifier, not a secret.
          </p>
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="xxxxxxxx.apps.googleusercontent.com"
            className="mt-3 w-full rounded-xl border border-hair bg-black/25 px-3.5 py-3 text-sm outline-none focus:border-[#34f5a0]/60"
          />
          <button
            onClick={() => {
              setGoogleClientId(clientId)
              onChange()
            }}
            disabled={!clientId.trim()}
            className="press mt-3 w-full rounded-xl bg-[#34f5a0] py-3 text-sm font-bold text-[#06140d] disabled:opacity-40"
          >
            Save Client ID
          </button>
        </div>
      )}

      {configured && !account && (
        <>
          <button
            onClick={handleSignIn}
            disabled={busy !== null}
            className="press flex w-full items-center justify-center gap-2.5 rounded-2xl bg-white py-3.5 text-[15px] font-bold text-zinc-900 disabled:opacity-60"
          >
            {busy ? (
              <RefreshCw size={18} className="animate-spin" />
            ) : (
              <GoogleGlyph />
            )}
            {busy === 'backup'
              ? `Saving your history… ${pct ?? 0}%`
              : busy
                ? 'Signing in…'
                : 'Sign in with Google'}
          </button>
          <p className="mt-2 text-center text-[12px] text-ink-3">
            Your workouts stay on this device until you do.
          </p>
        </>
      )}

      {account && (
        <div className="card p-4">
          <div className="flex items-center gap-3">
            {account.picture ? (
              <img
                src={account.picture}
                alt=""
                className="h-11 w-11 rounded-full"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#34f5a0]/15 text-[#34f5a0]">
                <ShieldCheck size={20} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold">{account.name}</div>
              <div className="truncate text-[13px] text-ink-3">
                {account.email}
              </div>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={handleSyncNow}
              disabled={busy !== null}
              className="press flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/[0.06] py-2.5 text-sm font-semibold text-ink disabled:opacity-50"
            >
              <RefreshCw
                size={16}
                className={busy === 'sync' ? 'animate-spin' : ''}
              />
              Sync now
            </button>
            <button
              onClick={handleSignOut}
              disabled={busy !== null}
              className="press flex items-center justify-center gap-2 rounded-xl border border-hair bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-ink-2 disabled:opacity-50"
            >
              <LogOut size={16} /> Sign out
            </button>
          </div>
          <button
            onClick={handleForceBackup}
            disabled={busy !== null}
            className="press mt-2 w-full rounded-xl bg-[#34f5a0]/15 py-2.5 text-sm font-semibold text-[#34f5a0] disabled:opacity-50"
          >
            {busy === 'backup'
              ? `Saving… ${pct ?? 0}%`
              : 'Save everything on this device'}
          </button>
          <p className="mt-1.5 flex items-center justify-between text-[12px] text-ink-3">
            <span>Re-uploads this device's full history.</span>
            {lastSyncAt && (
              <span className="shrink-0 font-semibold text-[#34f5a0]">
                Synced {fmtAgo(lastSyncAt)}
              </span>
            )}
          </p>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-400/10 px-3.5 py-3 text-[13px] text-rose-300">
          <CloudOff size={16} className="mt-0.5 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {/* Export — works signed in or out (reads local data). */}
      <button
        onClick={handleExportCsv}
        className="press card mt-4 flex w-full items-center gap-3 p-4 text-left"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5 text-ink-2">
          <Download size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Export CSV</span>
          <span className="block text-[12px] text-ink-3">
            {csvMsg ?? 'Download all your workouts as a spreadsheet file.'}
          </span>
        </span>
      </button>

      <div className="mt-6 flex items-start gap-2 text-[12px] text-ink-3">
        <Cloud size={14} className="mt-0.5 shrink-0" />
        <span>
          Signing out only forgets the account on this device — your saved
          history stays in your account and comes back when you sign in again.
        </span>
      </div>

      <p className="nums mt-6 text-center text-[11px] text-ink-3/70">
        Build {__BUILD_TIME__}
      </p>
    </div>
  )
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}
