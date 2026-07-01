import Dexie, { type Table } from 'dexie'
import type { Exercise, Session, WorkoutSet, WorkoutTemplate } from './types'

/** A row pending push to the backend (deduped by `key` = "table:rowId"). */
export interface OutboxEntry {
  key: string
  table: 'sessions' | 'sets'
  rowId: string
}
/** Small key/value store for sync state (cursor, timestamps). */
export interface MetaEntry {
  key: string
  value: unknown
}

/*
 * On-device database (IndexedDB via Dexie). All reads/writes hit this first;
 * the UI never blocks on the network. See /CLAUDE.md → Golden rules.
 *
 * Index notes:
 * - `*aliases` is a multi-entry index so we can resolve any spelling → exercise.
 * - `[sessionId+exerciseId]` powers the logger's per-exercise set list.
 * - `sets.loggedAt` orders the append-only log (basis for the sync cursor).
 * - `deleted` is intentionally NOT indexed: IndexedDB keys can't be booleans.
 *   Soft-deleted rows are filtered in queries.
 */
export class P90XDatabase extends Dexie {
  exercises!: Table<Exercise, string>
  templates!: Table<WorkoutTemplate, string>
  sessions!: Table<Session, string>
  sets!: Table<WorkoutSet, string>
  outbox!: Table<OutboxEntry, string>
  meta!: Table<MetaEntry, string>

  constructor() {
    super('p90x')
    this.version(1).stores({
      exercises: 'id, canonicalName, type, *aliases',
      templates: 'id, name',
      sessions: 'id, date, workoutId, [workoutId+date], createdAt',
      sets: 'id, sessionId, exerciseId, [sessionId+exerciseId], loggedAt',
    })
    // v2 adds the sync outbox (rows pending push) + a meta key/value store.
    this.version(2).stores({
      outbox: 'key, table',
      meta: 'key',
    })
  }
}

export const db = new P90XDatabase()
