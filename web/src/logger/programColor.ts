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

/*
 * Aura colour = the hue that RECALLS each program's LOGO (not always its accent):
 * P90X neon green, P90X2 blue, P90X3 orange, Body Beast lime green, Mixer pink.
 * It paints the big bottom glow so each page's background matches its brand.
 */
export const PROGRAM_AURA: Record<Program, string> = {
  P90X: '#3bff9e', // neon green
  P90X2: '#2fb8ff', // blue
  P90X3: '#ff8a1e', // orange
  'Body Beast': '#9be23f', // lime green
  Mixer: '#ff5cc8', // pink
}

/** Home / neutral default — the P90X neon green. */
export const AURA_DEFAULT = PROGRAM_AURA.P90X

export const auraFor = (p?: Program | null): string =>
  (p && PROGRAM_AURA[p]) || AURA_DEFAULT

/** Drive the page-wide aura by writing the CSS variable the body gradient reads. */
export const setAura = (hex: string): void => {
  document.documentElement.style.setProperty('--aura', hex)
}
