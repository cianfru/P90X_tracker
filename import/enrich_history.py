#!/usr/bin/env python3
"""
Attach per-session metadata (location / form / notes / supplements) from the
freshly parsed seed.json onto the app's web/public/history.json, matching by
(workout, date) — which is unique across the spreadsheet. UUIDs in history.json
are preserved untouched, so installed devices can backfill their existing
import sessions by id (see web/src/db/history.ts → seedHistoryMeta).

Usage: python import/enrich_history.py
"""
import json, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
seed = json.loads((ROOT / "import/seed.json").read_text())
catalog = json.loads((ROOT / "web/src/db/catalog.json").read_text())
hist_path = ROOT / "web/public/history.json"
history = json.loads(hist_path.read_text())

META_KEYS = ("location", "form", "notes", "supplements")
# (workout name, date) -> metadata dict
meta = {}
for s in seed["sessions"]:
    m = {k: s[k] for k in META_KEYS if k in s}
    if m:
        meta[(s["workout"], s["date"])] = m

id_to_name = {t["id"]: t["name"] for t in catalog["templates"]}

matched = enriched = 0
for sess in history:
    name = id_to_name.get(sess["workoutId"])
    m = meta.get((name, sess["date"]))
    # Drop any stale metadata keys, then apply the fresh parse.
    for k in META_KEYS:
        sess.pop(k, None)
    if m:
        matched += 1
        sess.update(m)
        enriched += 1

hist_path.write_text(json.dumps(history, ensure_ascii=False))
print(f"history sessions: {len(history)}  enriched: {enriched}")
# Coverage sanity: how many seed metadata rows found no history match?
hist_keys = {(id_to_name.get(s['workoutId']), s['date']) for s in history}
missing = [k for k in meta if k not in hist_keys]
print(f"seed metadata rows with no history match: {len(missing)}")
for k in missing[:10]:
    print("   unmatched:", k)
