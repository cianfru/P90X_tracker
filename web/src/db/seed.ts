import { db } from './db'
import type { Exercise, WorkoutTemplate } from './types'
import catalogJson from './catalog.json'

/*
 * Bundled reference data: the exercise catalog (canonical names + aliases +
 * type) and the 9 workout templates (exercises in performed order), generated
 * from the real spreadsheet by /import/import_p90x.py. Ships with the app so
 * the logger works on first run, before any history import (Phase 4) or sync.
 */

interface Catalog {
  exercises: Exercise[]
  templates: WorkoutTemplate[]
}

export const CATALOG = catalogJson as unknown as Catalog

/**
 * Upsert the bundled catalog + templates. These are read-only reference data
 * (not user-logged facts), so we `bulkPut` every boot — cheap, and keeps names
 * / aliases fresh across releases without touching sessions or sets.
 */
export async function ensureSeeded(): Promise<void> {
  await db.transaction('rw', db.exercises, db.templates, async () => {
    await db.exercises.bulkPut(CATALOG.exercises)
    await db.templates.bulkPut(CATALOG.templates)
  })
}
