import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Build stamp — surfaced in the Account screen so you can confirm which
  // version the (offline-cached) app is actually running.
  define: {
    __BUILD_TIME__: JSON.stringify(
      new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    ),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // We register the service worker ourselves (main.tsx) so we can poll for
      // new deploys on every foreground — iOS PWAs won't check on their own.
      injectRegister: false,
      includeAssets: ['apple-touch-icon.png', 'favicon.png'],
      manifest: {
        id: '/',
        name: 'P90X Logger',
        short_name: 'P90X',
        description:
          'Local-first, offline P90X workout logger and progress monitor.',
        theme_color: '#09090b',
        background_color: '#09090b',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Take over immediately on a new deploy. registerType:'autoUpdate' is
        // supposed to imply these, but the generated worker came out with only
        // a SKIP_WAITING message listener and NO clientsClaim — so a new worker
        // activated without ever controlling the already-open page,
        // 'controllerchange' never fired, the reload in main.tsx never ran, and
        // an installed PWA served stale assets forever. Set both explicitly.
        skipWaiting: true,
        clientsClaim: true,
        // Cache the app shell so the logger opens instantly and works with no signal.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // pdf.js (~1.7 MB across chunk + worker) belongs to the once-a-month
        // roster import. Precaching it would tax every install forever for a
        // screen most opens never reach; it's runtime-cached below instead.
        globIgnores: ['**/pdf*.{js,mjs}'],
        navigateFallback: '/index.html',
        // The sync API is served from /api on this same origin. Without this
        // the app-shell fallback answers any /api URL opened directly in the
        // browser (e.g. /api/health) with index.html, so the API looks like it
        // isn't deployed. Never shell-fallback API paths.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // history.json (~2.6 MB) is imported into IndexedDB on first run; keep it
        // out of precache but cache-first at runtime so a re-seed works offline.
        runtimeCaching: [
          {
            urlPattern: /\/history\.json$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'p90x-history',
              expiration: { maxEntries: 1 },
            },
          },
          // Fetched on first roster import and cached from then on, so the
          // second import works with no signal like the rest of the app.
          {
            urlPattern: /\/assets\/pdf[.-][^/]*\.m?js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'p90x-pdfjs',
              expiration: { maxEntries: 4 },
            },
          },
        ],
      },
      devOptions: {
        // Let us verify install + offline behaviour in `npm run dev`.
        enabled: true,
        type: 'module',
      },
    }),
  ],
})
