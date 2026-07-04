import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

// Keep the installed PWA current. The SW skips-waiting + claims clients
// (registerType: 'autoUpdate'), so the tricky part on iOS is DETECTING a new
// deploy — Safari almost never checks a home-screen app's service worker on its
// own. So we poll: on first load, every few minutes, and — most importantly —
// every time the app returns to the foreground. When a new worker takes over,
// reload once so the fresh assets show immediately.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    void updateSW(true)
  },
  onRegisteredSW(_swUrl, r) {
    if (!r) return
    const check = () => {
      void r.update().catch(() => {})
    }
    check()
    setInterval(check, 5 * 60 * 1000)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check()
    })
  },
})

// Belt-and-suspenders: when the controlling worker changes, reload once.
if ('serviceWorker' in navigator) {
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return
    reloaded = true
    window.location.reload()
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
