#!/usr/bin/env python3
"""
P90X.xlsx -> normalized JSON for the offline logger.

Emits: { "exercises": [...], "templates": [...], "sessions": [...] }
matching the app's data model. Encapsulates the spreadsheet quirks documented
in the build brief (swapped dates, reps x kg, a+b, typed modifiers, rounds).

Usage: python import_p90x.py P90X.xlsx > seed.json
"""
import sys, re, json, datetime, uuid
import openpyxl

# Exercises that are pulls (modifier semantics: L/X = harder, band = lighter travel).
PULL = {"Chin ups", "Wide pull", "Pull ups", "Pullups", "Closed grip", "Close grip",
        "Close grip pull", "Switch grip", "Swith grip", "Zip kip pull",
        "Zip kip chin", "Admins chin ups"}

# Canonicalize obvious aliases / typos so data never fragments.
ALIASES = {
    "Closed grip": "Close grip", "Close grip pull": "Close grip",
    "Pullups": "Pull ups", "Swith grip": "Switch grip",
    "Heavy p": "Heavy P.", "Heavy P": "Heavy P.",
}
def canon(name): return ALIASES.get(name, name)

def parse_date(v):
    """Row-1 dates: dd/mm/yy strings, OR Excel datetimes with day/month SWAPPED."""
    if isinstance(v, datetime.datetime):
        try:
            return datetime.date(v.year, v.day, v.month)   # swap back
        except ValueError:
            return v.date()
    if isinstance(v, str):
        m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{2,4})", v.strip())
        if m:
            d, mo, y = int(m[1]), int(m[2]), int(m[3])
            y = y + 2000 if y < 100 else y
            try:
                return datetime.date(y, mo, d)
            except ValueError:
                return None
    return None

def rxw(s): return re.search(r"(\d+)\s*x\s*(\d+)", s.lower())

def parse_value(v, exercise):
    """Return dict(reps, weightKg, modifiers, struggle) or None."""
    if v is None: return None
    s = str(v).strip()
    if not s: return None
    mods, struggle = [], False
    if any(e in s for e in ["\U0001F613", "\U0001F975", "\U0001F624"]): struggle = True
    low = s.lower()
    if "band" in low: mods.append("band_travel")
    if re.search(r"nk", s, re.I): mods.append("no_kip")
    if "trx" in low: mods.append("trx")
    if "full" in low: mods.append("full_rom")
    if exercise in PULL and re.search(r"\bl\b|\(l\)|\d+\s*l\b", s, re.I): mods.append("L_sit")
    if exercise in PULL and "trx" not in low and not rxw(s) and re.search(r"\d\s*[xX]", s):
        mods.append("wide_X")
    m = rxw(s)
    reps = weight = None
    if m:
        reps, weight = int(m[1]), int(m[2])          # reps x kg
    else:
        ap = re.match(r"\s*(\d+)\s*\+\s*(\d+)", s)
        if ap:
            reps = int(ap[1]) + int(ap[2])           # a+b = total reps
        else:
            d = re.search(r"(\d+)", s)
            if d: reps = int(d[1])
    if reps is None: return None
    return {"reps": reps, "weightKg": weight, "modifiers": mods, "struggle": struggle}

def main(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    today = datetime.date.today()
    sessions, templates = [], []
    ex_types = {}          # canonical name -> list of has_weight bools
    ex_seen_order = {}     # sheet -> ordered unique exercises

    for ws in wb.worksheets:
        if ws.max_row < 2:  # empty sheet
            continue
        workout = ws.title
        datecols = {c: parse_date(ws.cell(1, c).value)
                    for c in range(2, ws.max_column + 1)
                    if parse_date(ws.cell(1, c).value)}
        # session per date column
        col_sets = {c: [] for c in datecols}
        order = []
        round_counter = {}   # (col, exercise) -> round
        for r in range(2, ws.max_row + 1):
            raw = ws.cell(r, 1).value
            if not raw or not str(raw).strip(): continue
            name = str(raw).strip()
            if name in ("\U0001F4A6", "\U0001F525", "\U0001F4AA"): continue
            ex = canon(name)
            if ex not in order: order.append(ex)
            for c, d in datecols.items():
                if d > today: continue          # clip stray future dates
                pv = parse_value(ws.cell(r, c).value, name)
                if not pv: continue
                key = (c, ex)
                round_counter[key] = round_counter.get(key, 0) + 1
                ex_types.setdefault(ex, []).append(pv["weightKg"] is not None)
                col_sets[c].append({
                    "id": str(uuid.uuid4()), "exercise": ex,
                    "reps": pv["reps"], "weightKg": pv["weightKg"],
                    "round": round_counter[key], "modifiers": pv["modifiers"],
                    "struggle": pv["struggle"],
                })
        ex_seen_order[workout] = order
        for c, d in datecols.items():
            if d > today or not col_sets[c]: continue
            sessions.append({"id": str(uuid.uuid4()), "date": d.isoformat(),
                             "workout": workout, "sets": col_sets[c]})

    exercises = [{"name": e, "canonicalName": e,
                  "type": "weighted" if sum(v) > len(v) / 2 else "bodyweight"}
                 for e, v in sorted(ex_types.items())]
    templates = [{"name": wk, "exercises": [canon(x) for x in order]}
                 for wk, order in ex_seen_order.items()]

    out = {"exercises": exercises, "templates": templates, "sessions": sessions}
    json.dump(out, sys.stdout, ensure_ascii=False)
    print(f"\n# {len(sessions)} sessions, "
          f"{sum(len(s['sets']) for s in sessions)} sets, "
          f"{len(exercises)} exercises", file=sys.stderr)

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "P90X.xlsx")
