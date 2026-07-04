import { useEffect, useRef, useState, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'

/*
 * Touch gestures for the installed PWA, which loses the browser's native
 * back-swipe and pull-to-refresh:
 *  - useSwipeBack: drag in from the LEFT EDGE to go back.
 *  - PullToRefresh: pull down at the top of the page to reload.
 */

/** Fire `onBack` when the user drags in from the left screen edge. */
export function useSwipeBack(onBack: () => void, enabled = true): void {
  const cb = useRef(onBack)
  cb.current = onBack
  useEffect(() => {
    if (!enabled) return
    let startX = 0
    let startY = 0
    let tracking = false
    let fired = false
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      startX = t.clientX
      startY = t.clientY
      tracking = startX <= 28 // only from the very left edge
      fired = false
    }
    const onMove = (e: TouchEvent) => {
      if (!tracking || fired || e.touches.length !== 1) return
      const t = e.touches[0]
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      if (dx > 72 && Math.abs(dy) < 45) {
        fired = true
        tracking = false
        cb.current()
      }
    }
    const stop = () => {
      tracking = false
    }
    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('touchend', stop, { passive: true })
    document.addEventListener('touchcancel', stop, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', stop)
      document.removeEventListener('touchcancel', stop)
    }
  }, [enabled])
}

const THRESHOLD = 72

/** Wrap scrollable content: pulling down past the top triggers `onRefresh`. */
export function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => void | Promise<void>
  children: ReactNode
}) {
  const [pull, setPull] = useState(0)
  const [busy, setBusy] = useState(false)
  const startY = useRef<number | null>(null)
  const pullRef = useRef(0)
  const busyRef = useRef(false)
  const el = useRef<HTMLDivElement>(null)

  const set = (v: number) => {
    pullRef.current = v
    setPull(v)
  }

  useEffect(() => {
    const node = el.current
    if (!node) return
    const onStart = (e: TouchEvent) => {
      startY.current =
        window.scrollY <= 0 && !busyRef.current && e.touches.length === 1
          ? e.touches[0].clientY
          : null
    }
    const onMove = (e: TouchEvent) => {
      if (startY.current == null) return
      const dy = e.touches[0].clientY - startY.current
      if (dy > 0 && window.scrollY <= 0) {
        e.preventDefault() // suppress rubber-band; show our indicator instead
        set(Math.min(dy * 0.5, 96))
      } else if (dy < 0) {
        startY.current = null
        set(0)
      }
    }
    const onEnd = async () => {
      if (startY.current == null) return
      startY.current = null
      if (pullRef.current >= THRESHOLD) {
        busyRef.current = true
        setBusy(true)
        set(52)
        await Promise.resolve(onRefresh())
        busyRef.current = false
        setBusy(false)
        set(0)
      } else {
        set(0)
      }
    }
    node.addEventListener('touchstart', onStart, { passive: true })
    node.addEventListener('touchmove', onMove, { passive: false })
    node.addEventListener('touchend', onEnd, { passive: true })
    node.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      node.removeEventListener('touchstart', onStart)
      node.removeEventListener('touchmove', onMove)
      node.removeEventListener('touchend', onEnd)
      node.removeEventListener('touchcancel', onEnd)
    }
  }, [onRefresh])

  return (
    <div ref={el}>
      <div
        className="flex items-center justify-center overflow-hidden"
        style={{ height: pull }}
      >
        <RefreshCw
          size={20}
          className={`text-ink-3 ${busy ? 'animate-spin' : ''}`}
          style={{
            transform: `rotate(${pull * 3}deg)`,
            opacity: Math.min(1, pull / 55),
          }}
        />
      </div>
      {children}
    </div>
  )
}
