/**
 * Workstation-only glyph vocabulary, layered on top of the shared
 * `src/lib/ui/glyphs.ts` pass/fail/warn/info/bullet/arrow table.
 *
 * The library table covers diagnostic-style glyphs shared across the CLI;
 * this one covers the chrome glyphs specific to the workstation TUI (rules,
 * cursors, tab markers, remote-op direction arrows, …) that previously
 * ignored `theme.ascii` entirely. Every pair keeps the same cell width so
 * swapping to ASCII never shifts a column (`ellipsis` is the one
 * deliberate exception — `truncateCells` already accounts for it).
 */

export { pickGlyph, type GlyphKey } from '../../lib/ui/glyphs'

export const WORKSTATION_GLYPHS = {
  rule: '─',
  vrule: '│',
  sep: '·',
  dash: '—',
  endash: '–',
  ellipsis: '…',
  enter: '↵',
  chevron: '›',
  pointer: '❯',
  left: '←',
  up: '↑',
  down: '↓',
  updown: '↕',
  filled: '●',
  hollow: '○',
  empty: '∅',
  half: '◐',
  /** ⊙ — PR count / "target" indicator in the workspace sidebar tab. */
  target: '⊙',
  /** ▎ — left quarter-block used as a gutter/selection indicator. */
  gutter: '▎',
  /** ▌ — left half-block used as a selected-line indicator. */
  halfleft: '▌',
  /** ▼ — downward-pointing triangle, used for filter/mode drop-downs. */
  downtri: '▼',
  cross: '✗',
  check: '✓',
} as const

export const WORKSTATION_ASCII_GLYPHS: Record<keyof typeof WORKSTATION_GLYPHS, string> = {
  rule: '-',
  vrule: '|',
  sep: '.',
  dash: '-',
  endash: '-',
  ellipsis: '...',
  enter: '<',
  chevron: '>',
  pointer: '>',
  left: '<',
  up: '^',
  down: 'v',
  updown: '~',
  filled: '*',
  hollow: 'o',
  empty: '-',
  half: '*',
  // `#` distinguishes the PR-count tab from the `hollow` (`o`) "all-repos"
  // tab so the two sidebar tabs don't collapse to the same character.
  target: '#',
  gutter: '|',
  halfleft: '|',
  downtri: 'v',
  cross: 'x',
  check: '+',
}

export type WorkstationGlyphKey = keyof typeof WORKSTATION_GLYPHS

/**
 * Pick the right workstation glyph for `key`, honoring `theme.ascii`.
 * Mirrors `pickGlyph` from the shared library table for the workstation's
 * own glyph vocabulary.
 */
export function pickWorkstationGlyph(key: WorkstationGlyphKey, ascii = false): string {
  return ascii ? WORKSTATION_ASCII_GLYPHS[key] : WORKSTATION_GLYPHS[key]
}
