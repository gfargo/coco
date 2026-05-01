/**
 * The chars `git log --graph` emits for branch topology — `*`, `|`, `\`,
 * `/`, `_`, ` `. ASCII-only output is bulletproof for legacy terminals
 * but the angles read poorly when many branches overlap.
 *
 * `substituteGraphChars` swaps them for box-drawing / geometric Unicode
 * equivalents when the terminal can render them; falls back to ASCII
 * under `theme.ascii` (TERM=dumb / vt100) and `theme.noColor` is
 * orthogonal — the Unicode chars are still rendered, just without color.
 *
 * Kept ASCII-only intentionally:
 *   - alphanumerics       (commit refs / annotations git sometimes injects)
 *   - parens / brackets   (HEAD decoration markers, not part of the graph)
 *   - hyphens / colons    (likewise)
 */
const ASCII_TO_UNICODE: Record<string, string> = {
  '*': '●',
  '|': '│',
  '/': '╱',
  '\\': '╲',
  '_': '─',
}

export function substituteGraphChars(
  graph: string,
  options: { ascii: boolean }
): string {
  if (options.ascii) {
    return graph
  }
  let output = ''
  for (const character of graph) {
    output += ASCII_TO_UNICODE[character] ?? character
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
