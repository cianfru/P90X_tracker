import { db } from './db'
import type { Exercise, WorkoutTemplate } from './types'
import catalogJson from './catalog.json'

/*
 * Bundled reference data: the exercise catalog (canonical names + aliases +
 * type) and the workout templates (exercises in performed order) across the
 * P90X, P90X2 and P90X3 programs. P90X/P90X2 come from the real spreadsheet
 * via /import/import_p90x.py; P90X3 is seeded from the official worksheets
 * (no history). Ships with the app so the logger works on first run.
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
