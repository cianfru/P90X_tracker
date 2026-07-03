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
        // Cache the app shell so the logger opens instantly and works with no signal.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
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
