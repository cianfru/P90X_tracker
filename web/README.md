# web — P90X Logger PWA

Vite + React + TypeScript + Tailwind v4, installable and offline-capable via
`vite-plugin-pwa` (Workbox). This is the app the gym-side logging and the
progress Monitor run in. See [`../CLAUDE.md`](../CLAUDE.md) for the data model,
import rules, and phase plan.

## Scripts

```bash
npm run dev           # Vite dev server (PWA enabled → test install + offline here)
npm run build         # tsc -b && vite build → dist/ + generated service worker
npm run preview       # serve the production build locally
npm run lint          # oxlint
npm run format        # prettier --write .
npm run format:check  # prettier --check .
```

## Structure

```
public/            PWA icons (pwa-192/512, maskable, apple-touch) + icon.svg
src/
  App.tsx          app shell: header, connectivity pill, Train/Monitor nav
  main.tsx         React entry
  index.css        Tailwind v4 (@import) + shared design tokens
  lib/             cross-cutting hooks (e.g. useOnlineStatus)
  db/              Dexie schema + typed models          (Phase 2)
  logger/          Home / Session logging UI            (Phase 3)
  monitor/         client-side analytics + charts       (Phase 5)
  sync/            outbox, cursor, flush/pull service   (Phase 6)
```

## PWA notes

- `vite.config.ts` configures the manifest (name, icons, theme) and Workbox
  precache of the app shell (`globPatterns` + `navigateFallback`) so the app
  opens instantly and works with no signal.
- `devOptions.enabled` keeps the service worker on in `npm run dev` so install +
  offline can be verified without a production build.
- Icons are generated from `public/icon.svg` (rasterized with `sharp` as a
  one-off; not a committed dependency). Regenerate if the mark changes.
