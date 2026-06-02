/**
 * Map a normalized syntax token type to a terminal color for the diff
 * view. Prefers a per-theme override slot when defined, else falls back
 * to a sensible ANSI default — so every theme gets highlighting without
 * having to define eight new colors, and `noColor` themes opt out
 * entirely. `plain` (and anything unmapped) returns undefined → rendered
 * in the terminal's default foreground.
 */
import type { SyntaxTokenType } from '../../lib/syntax/tokenTypes'
import type { LogInkTheme } from './theme'

export function resolveSyntaxColor(
  token: SyntaxTokenType,
  theme: LogInkTheme
): string | undefined {
  if (theme.noColor) return undefined
  const c = theme.colors
  switch (token) {
    case 'keyword':
      return c.syntaxKeyword ?? 'magenta'
    case 'string':
      return c.syntaxString ?? 'green'
    case 'comment':
      return c.syntaxComment ?? 'gray'
    case 'number':
      return c.syntaxNumber ?? 'yellow'
    case 'type':
      return c.syntaxType ?? 'cyan'
    case 'function':
      return c.syntaxFunction ?? 'blue'
    case 'constant':
      return c.syntaxConstant ?? 'yellow'
    case 'property':
      return c.syntaxProperty ?? undefined
    default:
      return undefined
  }
}
