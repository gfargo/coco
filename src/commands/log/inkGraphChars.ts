/**
 * The chars `git log --graph` emits for branch topology — `*`, `|`, `\`,
 * `/`, `_`, ` `. ASCII-only output is bulletproof for legacy terminals
 * but the angles read poorly when many branches overlap.
 *
 * `substituteGraphChars` walks the row left-to-right with one-char
 * lookahead so it can recognize git's two-char junction patterns and
 * emit proper box-drawing junctions (├╮ / ├╯) instead of overlapping
 * pipes (│╲ / │╱). Anything that isn't part of a recognized pattern
 * falls back to the legacy 1-to-1 substitution.
 *
 * `theme.ascii` (TERM=dumb / vt100) bypasses substitution entirely so
 * legacy terminals get the raw `git log --graph` output. `theme.noColor`
 * is orthogonal — Unicode chars still render, just without color.
 *
 * Kept ASCII-only intentionally:
 *   - alphanumerics       (commit refs / annotations git sometimes injects)
 *   - parens / brackets   (HEAD decoration markers, not part of the graph)
 *   - hyphens / colons    (likewise)
 */
export const ASCII_TO_UNICODE_MAP: Readonly<Record<string, string>> = {
  '*': '●',
  '|': '│',
  '/': '╱',
  '\\': '╲',
  '_': '─',
}

export const DEFAULT_COMMIT_GLYPH = '●'
/**
 * #791 stage 3 — distinct glyphs for merges and HEAD so they stand
 * out from the run of regular commits. `◆` (filled diamond) flags a
 * merge commit (`parents.length > 1`); `◉` (fisheye) flags HEAD
 * regardless of parent count. Both render at the same column width as
 * `●` so graph alignment stays intact across mixed commit types.
 */
export const MERGE_COMMIT_GLYPH = '◆'
export const HEAD_COMMIT_GLYPH = '◉'

export type SubstituteGraphCharsOptions = {
  ascii: boolean
  /**
   * Override the glyph emitted for `*` (the commit lane). Stage 3 of
   * #791 swaps this to `◆` for merges and `◉` for HEAD; stage 1 keeps
   * the legacy `●`.
   */
  commitGlyph?: string
}

/**
 * Recognized 2-char junction patterns. The key is the bigram git emits
 * (lane char + spacer char); the value is the box-drawing pair we render.
 *
 * - `|\` (fork): trunk lane gains a right-T (├) and the spacer becomes
 *   the upper-right corner (╮) starting the new lane below.
 * - `|/` (converge): trunk lane gains a right-T (├) and the spacer
 *   becomes the upper-left corner (╯) absorbing the side lane from
 *   above.
 *
 * `*\` and `* /` (commit-row variants) are handled the same way, but
 * the commit glyph itself stays configurable via `commitGlyph` so
 * stage 3 can swap in `◆` / `◉` for merges and HEAD.
 */
const PIPE_FORK = '├╮'
const PIPE_CONVERGE = '├╯'
const FORK_SPACER = '╮'
const CONVERGE_SPACER = '╯'

export function substituteGraphChars(
  graph: string,
  options: SubstituteGraphCharsOptions
): string {
  if (options.ascii) {
    return graph
  }

  const commitGlyph = options.commitGlyph ?? DEFAULT_COMMIT_GLYPH
  let output = ''
  let i = 0

  while (i < graph.length) {
    const a = graph[i]
    const b = i + 1 < graph.length ? graph[i + 1] : ''

    if (a === '|' && b === '\\') {
      output += PIPE_FORK
      i += 2
      continue
    }
    if (a === '|' && b === '/') {
      output += PIPE_CONVERGE
      i += 2
      continue
    }
    if (a === '*' && b === '\\') {
      output += commitGlyph + FORK_SPACER
      i += 2
      continue
    }
    if (a === '*' && b === '/') {
      output += commitGlyph + CONVERGE_SPACER
      i += 2
      continue
    }

    if (a === '*') {
      output += commitGlyph
    } else {
      output += ASCII_TO_UNICODE_MAP[a] ?? a
    }
    i += 1
  }

  return output
}

/**
 * True when a graph string contains nothing but topology characters and
 * whitespace — used to decide whether a row is decoration (a continuation
 * of branch lines, no commit on this line) or actual commit content.
 *
 * Only the ASCII inputs need to match here; Unicode substitution happens
 * at render time after this check.
 */
export function isPureGraphRow(graph: string): boolean {
  for (const character of graph) {
    if (character !== '*' && character !== '|' && character !== '\\' &&
        character !== '/' && character !== '_' && character !== ' ') {
      return false
    }
  }
  return graph.trim().length > 0
}
