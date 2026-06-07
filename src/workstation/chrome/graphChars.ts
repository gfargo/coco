/**
 * The chars `git log --graph` emits for branch topology — `*`, `|`, `\`,
 * `/`, `_`, ` ` — mapped 1-to-1 to box-drawing glyphs.
 *
 * `substituteGraphChars` walks the row and substitutes each char via
 * `ASCII_TO_UNICODE_MAP` (with `*` overridable to a commit glyph). The
 * fork/converge diagonals (`\` → `╲`, `/` → `╱`) are kept as diagonals
 * rather than rewritten to corner glyphs (├╮ / ├╯): git lays its lanes
 * out on a 2-column pitch (lane N at column 2N), and a single diagonal
 * spans exactly that 2-column step, so it visually connects the lane
 * above to the lane below. A corner glyph assumes a 1-column step and
 * therefore lands one column shy of the commit it should meet, leaving
 * a detached "hook" and a floating commit (#791 revisited — the corners
 * read cleaner in isolation but break the line continuity).
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

export function substituteGraphChars(
  graph: string,
  options: SubstituteGraphCharsOptions
): string {
  if (options.ascii) {
    return graph
  }

  const commitGlyph = options.commitGlyph ?? DEFAULT_COMMIT_GLYPH
  let output = ''
  for (const character of graph) {
    if (character === '*') {
      output += commitGlyph
    } else {
      output += ASCII_TO_UNICODE_MAP[character] ?? character
    }
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
