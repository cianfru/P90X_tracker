import type { Exercise, WorkoutTemplate } from './types'

/*
 * Performed order.
 *
 * A template carries TWO lists and they are not the same thing:
 *
 *   `exerciseIds`  the catalog's set of moves — what the workout contains
 *   `sequence`     the order they're actually done in, repeats included
 *
 * Nothing ever guaranteed the first matched the second, and in legs & back it
 * didn't: the two moves never logged in seven years of spreadsheet (single-leg
 * wall squat, three-way lunge) were appended to the end of `exerciseIds` by the
 * importer, so every screen that trusted that list showed the back half of the
 * workout a position out and those two orphaned at the bottom.
 *
 * So the walk is the single source of truth for order, and it lives here rather
 * than being re-derived by each screen — the logger, the recap and the session
 * detail all have to agree, and previously three copies meant three chances to
 * drift.
 */

/** Every performed slot, in order — repeats included. */
export function walkOf(
  template: Pick<WorkoutTemplate, 'sequence' | 'rounds'>,
  exercises: Exercise[],
): string[] {
  if (template.sequence?.length) return template.sequence
  const rounds = template.rounds ?? 1
  return Array.from({ length: rounds }).flatMap(() => exercises.map((e) => e.id))
}

/** The exercises, ordered by when each is FIRST performed. */
export function inPerformedOrder(
  template: Pick<WorkoutTemplate, 'sequence' | 'rounds'>,
  exercises: Exercise[],
): Exercise[] {
  const walk = walkOf(template, exercises)
  const firstAt = new Map<string, number>()
  walk.forEach((id, i) => {
    if (!firstAt.has(id)) firstAt.set(id, i)
  })
  // Anything absent from the walk sorts last rather than vanishing — a
  // template can legitimately list a move its sequence doesn't reach.
  return [...exercises].sort(
    (a, b) =>
      (firstAt.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (firstAt.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  )
}
