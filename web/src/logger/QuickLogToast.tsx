import { useEffect, useRef } from 'react'
import { Check, Undo2 } from 'lucide-react'
import { deleteSession, type QuickLogResult } from '../db/repo'
import { fmtDate } from '../lib/id'

/*
 * Confirmation for a quick log, with Undo. A quick log is one tap and copies a
 * whole workout, so a mis-tap has to be just as cheap to take back. Undo only
 * appears when the tap actually created something.
 */

export interface QuickLogToastState {
  name: string
  result: QuickLogResult
}

function quickLogMessage({ name: raw, result }: QuickLogToastState): string {
  const name = raw.charAt(0).toUpperCase() + raw.slice(1)
  if (result.existed) return `${name} is already logged that day`
  if (!result.copied) return `${name} logged`
  return `${name} logged · ${result.copied} sets from ${fmtDate(result.from!)}`
}

export function QuickLogToast({
  toast,
  onClose,
}: {
  toast: QuickLogToastState
  onClose: () => void
}) {
  const close = useRef(onClose)
  close.current = onClose
  // Restart the timer for each new toast, not on every parent render.
  useEffect(() => {
    const t = setTimeout(() => close.current(), 6000)
    return () => clearTimeout(t)
  }, [toast])

  const undoable = !toast.result.existed
  return (
    <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-40 mx-auto max-w-md px-4">
      <div className="frost flex items-center gap-3 rounded-2xl border border-[#34f5a0]/30 px-4 py-3 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.8)]">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#34f5a0] text-[#06140d]">
          <Check size={15} strokeWidth={3} />
        </span>
        <span className="nums min-w-0 flex-1 text-[13px] font-semibold text-ink">
          {quickLogMessage(toast)}
        </span>
        {undoable && (
          <button
            onClick={async () => {
              await deleteSession(toast.result.sessionId)
              onClose()
            }}
            className="press flex shrink-0 items-center gap-1 rounded-full bg-white/[0.08] px-3 py-1.5 text-xs font-bold text-ink-2"
          >
            <Undo2 size={13} strokeWidth={2.6} /> Undo
          </button>
        )}
      </div>
    </div>
  )
}
