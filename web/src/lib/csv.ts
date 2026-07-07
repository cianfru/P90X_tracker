import { db } from '../db'
import { todayISO } from './id'

/*
 * Client-side CSV export. Reads straight from Dexie, so it works offline and
 * regardless of which sync backend (Google / Postgres / none) is in use. The
 * output is denormalized — one row per (non-deleted) set with its session's
 * context inlined — which is the friendliest shape for Excel / pandas analysis.
 */

const esc = (v: unknown): string => {
  if (v == null) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Build the CSV and trigger a download. Returns the number of set rows written. */
export async function exportCsv(): Promise<number> {
  const [sessions, sets] = await Promise.all([
    db.sessions.toArray(),
    db.sets.toArray(),
  ])
  const byId = new Map(sessions.map((s) => [s.id, s]))
  const rows = sets
    .filter((st) => !st.deleted)
    .sort((a, b) => a.loggedAt - b.loggedAt)

  const header = [
    'date',
    'workout_id',
    'session_id',
    'location',
    'form',
    'notes',
    'exercise_id',
    'reps',
    'weight_kg',
    'round',
    'modifiers',
    'struggle',
    'logged_at',
  ]
  const lines = [header.join(',')]
  for (const st of rows) {
    const s = byId.get(st.sessionId)
    if (!s || s.deleted) continue
    lines.push(
      [
        s.date,
        s.workoutId,
        st.sessionId,
        s.location ?? '',
        s.form ?? '',
        s.notes ?? '',
        st.exerciseId,
        st.reps,
        st.weightKg ?? '',
        st.round,
        (st.modifiers ?? []).join('|'),
        st.struggle ? 1 : 0,
        st.loggedAt,
      ]
        .map(esc)
        .join(','),
    )
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `p90x-export-${todayISO()}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return rows.length
}
