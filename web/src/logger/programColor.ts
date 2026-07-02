import type { Program } from '../db'

/*
 * Each program owns an energetic, fluo accent. The colour picked on the landing
 * page carries through that program's whole section — its workout list, session
 * screen, buttons and highlights — so you always know which block you're in.
 */
export const PROGRAM_ACCENT: Record<Program, string> = {
  P90X: '#34f5a0', // fluo green
  P90X2: '#33cbff', // fluo blue
  P90X3: '#b26bff', // fluo violet
  'Body Beast': '#ff9636', // fluo orange
  Mixer: '#ff5cc8', // fluo pink
}

/** Accent for a program (defaults to the P90X green when unknown). */
export const programAccent = (p?: Program): string =>
  (p && PROGRAM_ACCENT[p]) || PROGRAM_ACCENT.P90X

/** Near-black ink that reads well on any of the bright fluo accents. */
export const ON_ACCENT = '#06140d'
