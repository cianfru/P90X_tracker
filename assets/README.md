# Source assets (design & data references — not production code)

- `P90X.xlsx` — 7 years of source history (imported via /import/import_p90x.py).
- `workout-logger.jsx` — React prototype. UX + data-model reference for the
  logger UI. NOT production code: it persists to a key-value shim and inlines a
  small SEED; production uses Dexie (IndexedDB) and the full /import/seed.json.
