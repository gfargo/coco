/**
 * Centralised glyph + label vocabulary for diagnostic / status copy.
 *
 * Before this module each surface (commandExecutor, doctor, footer,
 * cache, issues, prs, commit-hook flow) picked its own marks for
 * pass / warn / fail / info — `✓` here, `✔` there, `✖` vs `✗`. Users
 * couldn't lean on a consistent visual signal to scan output, and the
 * audit flagged it as one of the bigger inconsistencies in the
 * codebase.
 *
 * The vocabulary mirrors what Linux package managers + git-aware
 * tools converge on (`pacman`, `apt`, `nala`, `npm doctor`, etc.) —
 * green check / red fail / yellow warn / blue info. ASCII fallbacks
 * are first-class so dumb terminals (TERM=dumb / vt100) still render
 * a meaningful prefix.
 *
 * Conventions:
 *   - Status glyphs (PASS / FAIL / WARN / INFO) — for diagnostic
 *     output, command exit, doctor severity, footer message kinds.
 *     Colour-coded variants live alongside as `*_COLORED` helpers
 *     so callers can use either depending on context.
 *   - Action glyphs (BULLET, ARROW) — for indented hint lines and
 *     "next step" callouts.
 *   - Domain glyphs (CHECK_RUN_*, DECISION_*) — keep their own
 *     vocabularies (PR reviews, status checks) because their
 *     semantic shape doesn't map cleanly onto pass/fail/warn/info.
 *
 * Use `pickGlyph(unicode, ascii, isAscii)` when you need to honor
 * `theme.ascii` mode in a single call site.
 */

import chalk from 'chalk'

/**
 * Status-severity glyph set. Same vocabulary as the workstation
 * footer's `kind` field (info / warning / error / success / loading)
 * plus `pass` for the doctor / "no problem" case.
 */
export const GLYPHS = {
  pass: '✓',
  fail: '✖',
  warn: '⚠',
  info: 'ℹ',
  // Distinct from `fail` so cross-out-style output (review changes
  // requested, check failures) doesn't get confused with command
  // failure output.
  cross: '✗',
  pending: '◌',
  // Spinner glyph is animated separately by `pickSpinnerFrame`; this
  // is the static fallback for non-animated render paths.
  spinner: '⠋',
  bullet: '•',
  arrow: '→',
} as const

/**
 * ASCII-only fallbacks for terminals that can't render unicode (dumb /
 * vt100 / NO_COLOR + ASCII strict). Map 1:1 to `GLYPHS`.
 */
export const ASCII_GLYPHS = {
  pass: '+',
  fail: '!',
  warn: '!',
  info: 'i',
  cross: 'x',
  pending: '.',
  spinner: '*',
  bullet: '-',
  arrow: '->',
} as const

export type GlyphKey = keyof typeof GLYPHS

/**
 * Pick the right glyph for a given key, honoring an `ascii` flag.
 * Lets callers stay declarative — `pickGlyph('pass', theme.ascii)` —
 * instead of branching on `theme.ascii` at every render site.
 */
export function pickGlyph(key: GlyphKey, ascii: boolean = false): string {
  return ascii ? ASCII_GLYPHS[key] : GLYPHS[key]
}

/**
 * Theme-tinted helpers for terminal output. These return chalk-wrapped
 * strings so callers don't repeat the `chalk.<color>(GLYPHS.<key>)`
 * pattern. Each maps to the canonical colour the codebase uses for
 * that severity:
 *
 *   - PASS  → green
 *   - FAIL  → red
 *   - WARN  → yellow
 *   - INFO  → blue
 *
 * Doctor's `SEVERITY_ICON` lookup is the canonical example — it now
 * delegates here so the colours stay in sync if the theme palette
 * shifts in the future.
 */
export const PASS = (): string => chalk.green(GLYPHS.pass)
export const FAIL = (): string => chalk.red(GLYPHS.fail)
export const WARN = (): string => chalk.yellow(GLYPHS.warn)
export const INFO = (): string => chalk.blue(GLYPHS.info)
