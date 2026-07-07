import { useEffect, useState } from 'react'
import {
  ChevronLeft,
  Cloud,
  CloudOff,
  Download,
  LogOut,
  Minus,
  Plus,
  Plug,
  RefreshCw,
  Server,
  ShieldCheck,
} from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { getBodyweight, setBodyweight } from './effort'
import { AURA_DEFAULT, setAura } from './programColor'
import { useSwipeBack } from '../lib/gestures'
import { fmtAgo } from '../lib/id'
import { exportCsv } from '../lib/csv'
import {
  clearSyncConfig,
  fullPushServer,
  normalizeConfig,
  setSyncConfig,
  sync as runServerSync,
  syncEnabled,
  syncServerHost,
} from '../sync/syncClient'
import {
  cachedAccount,
  googleClientId,
  googleConfigured,
  setGoogleClientId,
  signIn,
  signOut,
  type GoogleAccount,
} from '../sync/googleAuth'
import {
  ensureSpreadsheet,
  markMigrationDone,
  pushAll,
  syncGoogle,
} from '../sync/googleSheets'
import { Label } from './ui'

/*
 * Account screen — Google sign-in + Sheets backup. Daily use never needs this;
 * it only sets up who you are and where your data is backed up. Each Google
 * account keeps its own spreadsheet in its own Drive, so accounts stay separate.
 */

type Busy = null | 'signin' | 'migrate' | 'sync'

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
  const [choose, setChoose] = useState<{ id: string; count: number } | null>(null)
  const [bw, setBw] = useState(getBodyweight())
  const lastSyncAt = useLiveQuery(
    async () => (await db.meta.get('lastSyncAt'))?.value as number | undefined,
  )
  // Custom sync server (Postgres) — the alternative to Google Sheets.
  const [srvUrl, setSrvUrl] = useState('')
  const [srvToken, setSrvToken] = useState('')
  const [srvBusy, setSrvBusy] = useState<null | 'connect' | 'sync'>(null)
  const [srvPct, setSrvPct] = useState<number | null>(null)
  const [csvMsg, setCsvMsg] = useState<string | null>(null)
  const serverHost = syncServerHost()
  const serverOn = syncEnabled()
  useEffect(() => setAura(AURA_DEFAULT), [])
  useSwipeBack(onBack)

  const configured = googleConfigured()

  const changeBw = (delta: number) => {
    const v = Math.max(40, Math.min(200, bw + delta))
    setBw(v)
    setBodyweight(v)
  }

  async function handleSignIn() {
    setError(null)
    setBusy('signin')
    try {
      const acct = await signIn()
      setAccount(acct)
      onChange()
      const { id, empty } = await ensureSpreadsheet()
      if (empty) {
        // Sheet has no data yet (new, or an interrupted first sync): let the
        // user upload existing data or start clean (a second person shouldn't
        // inherit the seeded history).
        const count = await db.sessions.count()
        setChoose({ id, count })
      } else {
        // Existing sheet: full reconcile (restore everything by UUID), then
        // enable auto-sync.
        setBusy('sync')
        await syncGoogle({ full: true })
        markMigrationDone()
        onChange()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function uploadExisting() {
    if (!choose) return
    setBusy('migrate')
    setError(null)
    try {
      await pushAll(choose.id, (done, total) =>
        setPct(Math.round((done / total) * 100)),
      )
      setChoose(null)
      onChange() // migration done → auto-sync can start
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
      setPct(null)
    }
  }

  async function startClean() {
    setBusy('migrate')
    setError(null)
    try {
      await db.transaction('rw', db.sessions, db.sets, db.outbox, db.meta, async () => {
        await db.sessions.clear()
        await db.sets.clear()
        await db.outbox.clear()
        await db.meta.put({ key: 'gsheet-rows-sessions', value: 1 })
        await db.meta.put({ key: 'gsheet-rows-sets', value: 1 })
      })
      // Don't re-seed the bundled (owner's) history onto this account.
      localStorage.setItem('p90x-history-seeded', '1')
      localStorage.setItem('p90x-history-meta-seeded-v2', '1')
      markMigrationDone()
      setChoose(null)
      onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
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
    // Full reconcile so a manual "Sync now" always pulls the whole sheet
    // (e.g. after another device did a full backup).
    const r = await syncGoogle({ full: true })
    if (!r.ok && r.reason) setError(r.reason)
    setBusy(null)
  }

  async function handleForceBackup() {
    setBusy('migrate')
    setError(null)
    try {
      const { id } = await ensureSpreadsheet()
      await pushAll(id, (done, total) => setPct(Math.round((done / total) * 100)))
      onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
      setPct(null)
    }
  }

  async function connectServer() {
    if (!srvUrl.trim() || !srvToken.trim()) return
    setSrvBusy('connect')
    setError(null)
    const cfg = normalizeConfig(srvUrl, srvToken)
    try {
      // Push everything on this device up FIRST (idempotent by uuid), using an
      // explicit config. We only persist the connection — which flips the app's
      // active backend to this server — AFTER the initial backup succeeds, so a
      // failed/interrupted connect never leaves the backend half-enabled.
      await fullPushServer(cfg, (done, total) =>
        setSrvPct(total ? Math.round((done / total) * 100) : 100),
      )
      setSyncConfig(cfg.url, cfg.token)
      // Then pull once to catch anything another device already sent.
      await runServerSync()
      setSrvUrl('')
      setSrvToken('')
      onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSrvBusy(null)
      setSrvPct(null)
    }
  }

  async function serverSyncNow() {
    setSrvBusy('sync')
    setError(null)
    const r = await runServerSync()
    if (!r.ok && r.reason) setError(r.reason)
    setSrvBusy(null)
  }

  function disconnectServer() {
    clearSyncConfig()
    // Keep local data; just stop syncing to the server.
    onChange()
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

      <h2 className="display mb-1 text-2xl">Account &amp; backup</h2>
      <p className="mb-6 text-[13px] text-ink-3">
        Sign in with Google to back up to your own private spreadsheet — and
        restore it on any device. Everything keeps working offline.
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

      {/* Step 1 — Client ID (one-time app setup) */}
      {!configured && (
        <div className="card mb-4 p-4">
          <Label>One-time setup</Label>
          <p className="mt-2 text-[13px] text-ink-2">
            Paste the Google OAuth <b>Client ID</b> you created (see the setup
            steps). It's a public app identifier, not a secret.
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

      {/* Step 2 — sign in / account */}
      {configured && !account && (
        <button
          onClick={handleSignIn}
          disabled={busy === 'signin'}
          className="press flex w-full items-center justify-center gap-2.5 rounded-2xl bg-white py-3.5 text-[15px] font-bold text-zinc-900 disabled:opacity-60"
        >
          {busy === 'signin' ? (
            <RefreshCw size={18} className="animate-spin" />
          ) : (
            <GoogleGlyph />
          )}
          Sign in with Google
        </button>
      )}

      {/* First-run choice: upload existing data or start clean */}
      {choose && (
        <div className="card mt-4 p-4">
          <p className="text-sm font-semibold">Set up this account</p>
          <p className="mt-1 text-[13px] text-ink-3">
            This account's spreadsheet is empty. Upload the data on this device
            ({choose.count.toLocaleString()} sessions) to it, or start clean?
          </p>
          {pct !== null && (
            <p className="mt-2 text-[13px] font-semibold text-[#34f5a0]">
              Uploading… {pct}%
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button
              onClick={uploadExisting}
              disabled={busy === 'migrate'}
              className="press flex-1 rounded-xl bg-[#34f5a0] py-2.5 text-sm font-bold text-[#06140d] disabled:opacity-40"
            >
              Upload my data
            </button>
            <button
              onClick={startClean}
              disabled={busy === 'migrate'}
              className="press flex-1 rounded-xl border border-hair bg-white/[0.04] py-2.5 text-sm font-semibold text-ink-2 disabled:opacity-40"
            >
              Start clean
            </button>
          </div>
        </div>
      )}

      {account && !choose && (
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
              disabled={busy === 'sync'}
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
              className="press flex items-center justify-center gap-2 rounded-xl border border-hair bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-ink-2"
            >
              <LogOut size={16} /> Sign out
            </button>
          </div>
          <button
            onClick={handleForceBackup}
            disabled={busy === 'migrate'}
            className="press mt-2 w-full rounded-xl bg-[#34f5a0]/15 py-2.5 text-sm font-semibold text-[#34f5a0] disabled:opacity-50"
          >
            {busy === 'migrate'
              ? `Backing up… ${pct ?? 0}%`
              : 'Back up all my data now'}
          </button>
          <p className="mt-1.5 flex items-center justify-between text-[12px] text-ink-3">
            <span>Uploads everything on this device to your Sheet.</span>
            {lastSyncAt && (
              <span className="shrink-0 font-semibold text-[#34f5a0]">
                Last backed up {fmtAgo(lastSyncAt)}
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

      {/* Sync server (Postgres) — the alternative to Google Sheets. When
          connected it takes over as the active backend. */}
      <div className="card mt-4 p-4">
        <div className="flex items-center gap-2">
          <Server size={16} className="text-ink-2" />
          <Label>Sync server</Label>
        </div>
        {serverOn ? (
          <>
            <p className="mt-2 flex items-center gap-1.5 text-[13px] text-ink-2">
              <span className="h-2 w-2 rounded-full bg-[#34f5a0]" />
              Connected to <b className="text-ink">{serverHost}</b>
            </p>
            <p className="mt-1 text-[12px] text-ink-3">
              This is your active backup. Google Sheets is paused while a server
              is connected.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={serverSyncNow}
                disabled={srvBusy !== null}
                className="press flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/[0.06] py-2.5 text-sm font-semibold text-ink disabled:opacity-50"
              >
                <RefreshCw
                  size={16}
                  className={srvBusy === 'sync' ? 'animate-spin' : ''}
                />
                Sync now
              </button>
              <button
                onClick={disconnectServer}
                disabled={srvBusy !== null}
                className="press flex items-center justify-center gap-2 rounded-xl border border-hair bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-ink-2 disabled:opacity-50"
              >
                <LogOut size={16} /> Disconnect
              </button>
            </div>
            {lastSyncAt && (
              <p className="mt-2 text-right text-[12px] font-semibold text-[#34f5a0]">
                Last synced {fmtAgo(lastSyncAt)}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="mt-2 text-[13px] text-ink-2">
              Back up to your own Postgres server instead of Google. Paste the
              server URL and your member token.
            </p>
            <input
              value={srvUrl}
              onChange={(e) => setSrvUrl(e.target.value)}
              placeholder="https://p90x-api.vercel.app"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="mt-3 w-full rounded-xl border border-hair bg-black/25 px-3.5 py-3 text-sm outline-none focus:border-[#34f5a0]/60"
            />
            <input
              value={srvToken}
              onChange={(e) => setSrvToken(e.target.value)}
              placeholder="member token"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="mt-2 w-full rounded-xl border border-hair bg-black/25 px-3.5 py-3 text-sm outline-none focus:border-[#34f5a0]/60"
            />
            <button
              onClick={connectServer}
              disabled={srvBusy !== null || !srvUrl.trim() || !srvToken.trim()}
              className="press mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#34f5a0] py-3 text-sm font-bold text-[#06140d] disabled:opacity-40"
            >
              {srvBusy === 'connect' ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  {srvPct !== null ? `Uploading ${srvPct}%` : 'Connecting…'}
                </>
              ) : (
                <>
                  <Plug size={16} /> Connect &amp; back up
                </>
              )}
            </button>
          </>
        )}
      </div>

      {/* Export — works with any backend (reads local data). */}
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
          Your data lives in a spreadsheet in <b>your</b> Google Drive. Signing
          out just forgets it on this device — your Sheet stays safe.
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
