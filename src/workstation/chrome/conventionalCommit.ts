import type { LogInkTheme } from './theme'

/**
 * Parse the leading conventional-commit prefix out of a subject line
 * so the history renderer can paint it in a type-specific color.
 *
 * Recognized shape:
 *   <type>[(<scope>)][!]: <description>
 *
 * Examples that parse:
 *   `feat: add login`              → type=feat, scope=undefined, breaking=false
 *   `feat(cli): wire flag`         → type=feat, scope=cli, breaking=false
 *   `fix!: drop legacy field`      → type=fix, scope=undefined, breaking=true
 *   `chore(deps)!: bump react`     → type=chore, scope=deps, breaking=true
 *
 * Returns `undefined` for anything that doesn't look conventional —
 * the renderer then falls through to plain text and the row reads
 * unchanged. Type must be all-lowercase ASCII so a sentence that
 * happens to start with `Subject:` doesn't get matched as the
 * `subject` type.
 *
 * `prefix` is the matched text including the trailing `: ` so the
 * caller can render it as one colored span and the unmatched
 * remainder as another, without re-measuring widths.
 */
export type ConventionalCommitPrefix = {
  /** Full matched prefix including trailing `: `, ready to render. */
  prefix: string
  /** Subject text after the prefix; possibly empty. */
  rest: string
  /** The type token (`feat`, `fix`, …). Lowercase by construction. */
  type: string
  /** Optional scope captured between parens, or `undefined`. */
  scope?: string
  /** True when the prefix contained the breaking-change `!` marker. */
  breaking: boolean
}

const PREFIX_PATTERN = /^([a-z]+)(\(([^)]+)\))?(!)?:\s+/

export function parseConventionalCommitPrefix(
  message: string
): ConventionalCommitPrefix | undefined {
  const match = PREFIX_PATTERN.exec(message)
  if (!match) return undefined

  const [whole, type, , scope, breakingMarker] = match
  return {
    prefix: whole,
    rest: message.slice(whole.length),
    type,
    scope: scope || undefined,
    breaking: Boolean(breakingMarker),
  }
}

/**
 * Pick the theme color used to paint a conventional-commit prefix.
 *
 * Rough mapping intent:
 *   - feat                       → success  (new capability, growth)
 *   - fix                        → warning  (was a problem; eye-catch)
 *   - docs / refactor / perf     → info / accent (intent-bearing change)
 *   - test / style / build / ci  → muted    (mechanical / housekeeping)
 *   - chore                      → muted
 *   - revert                     → danger   (signals "this undid something")
 *
 * Unknown types fall through to `accent` so a project-specific
 * convention (`wip:`, `release:`, etc.) still reads as the typed
 * prefix rather than blending into the subject. Returns `undefined`
 * under `theme.noColor` so the prefix stays plain — the textual
 * `feat:` carries the meaning by itself.
 *
 * Breaking changes (`!:`) override the type color with `danger` so
 * the row reads as "stop and look at this" regardless of which type
 * it is.
 */
export function getConventionalCommitColor(
  parsed: ConventionalCommitPrefix,
  theme: LogInkTheme
): string | undefined {
  if (theme.noColor) return undefined
  if (parsed.breaking) return theme.colors.danger

  switch (parsed.type) {
    case 'feat':
      return theme.colors.success
    case 'fix':
      return theme.colors.warning
    case 'docs':
    case 'refactor':
    case 'perf':
      return theme.colors.info
    case 'test':
    case 'style':
    case 'build':
    case 'ci':
    case 'chore':
      return theme.colors.muted
    case 'revert':
      return theme.colors.danger
    default:
      return theme.colors.accent
  }
}
