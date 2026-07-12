const COMBINING_MARK_RANGES: Array<[number, number]> = [
  [0x0300, 0x036f],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20ff],
  [0xfe20, 0xfe2f],
]

const WIDE_CHARACTER_RANGES: Array<[number, number]> = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x2600, 0x27bf],
  [0x1f000, 0x1f9ff],
  [0x20000, 0x3fffd],
]

function isInRange(codePoint: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => codePoint >= start && codePoint <= end)
}

function characterWidth(character: string): number {
  const codePoint = character.codePointAt(0) || 0

  if (codePoint === 0 || codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) {
    return 0
  }

  if (
    codePoint === 0x200d ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    isInRange(codePoint, COMBINING_MARK_RANGES)
  ) {
    return 0
  }

  return isInRange(codePoint, WIDE_CHARACTER_RANGES) ? 2 : 1
}

export function cellWidth(value: string): number {
  return Array.from(value).reduce((width, character) => width + characterWidth(character), 0)
}

/**
 * Word-wrap `value` into lines that each fit within `width` cells. Breaks
 * on whitespace where possible; falls back to mid-word splits when a single
 * word is wider than the budget. Preserves blank input as a single empty
 * line so `value.split('\n').flatMap(wrapCells)` round-trips cleanly.
 */
export function wrapCells(value: string, width: number): string[] {
  if (width < 1) {
    return [value]
  }
  if (cellWidth(value) <= width) {
    return [value]
  }

  const lines: string[] = []
  let current = ''
  let currentWidth = 0

  const flush = (): void => {
    if (current.length > 0) {
      lines.push(current)
      current = ''
      currentWidth = 0
    }
  }

  // Tokenize into runs of whitespace + non-whitespace so we can keep word
  // boundaries when possible.
  const tokens = value.match(/\s+|\S+/g) || []

  for (const token of tokens) {
    const tokenWidth = cellWidth(token)

    if (currentWidth + tokenWidth <= width) {
      current += token
      currentWidth += tokenWidth
      continue
    }

    if (/^\s+$/.test(token)) {
      // Drop boundary whitespace at line breaks.
      flush()
      continue
    }

    flush()

    if (tokenWidth <= width) {
      current = token
      currentWidth = tokenWidth
      continue
    }

    // Word longer than budget — hard-split into chunks.
    let remaining = token
    while (cellWidth(remaining) > width) {
      let chunk = ''
      let chunkWidth = 0
      for (const character of Array.from(remaining)) {
        const charW = characterWidth(character)
        if (chunkWidth + charW > width) break
        chunk += character
        chunkWidth += charW
      }
      if (chunk === '') {
        // A single character wider than the whole budget (wide char,
        // width 1). Emit it anyway — an empty chunk never shrinks
        // `remaining`, which used to spin this loop forever and hang
        // the TUI.
        chunk = Array.from(remaining)[0]
      }
      lines.push(chunk)
      remaining = remaining.slice(chunk.length)
    }
    if (remaining.length > 0) {
      current = remaining
      currentWidth = cellWidth(remaining)
    }
  }

  flush()
  return lines.length > 0 ? lines : [value]
}

/**
 * Right-pad `value` to `width` cells with `fillChar` (#1624). `String.padEnd`
 * counts UTF-16 code units, so padding a wide-glyph name (CJK, emoji) to a
 * column width computed via `cellWidth` overshoots by one fill character per
 * wide character — the same misalignment `cellWidth` itself exists to avoid
 * for truncation. Column-padding call sites should use this instead of
 * `.padEnd(width)` whenever `width` came from `cellWidth`.
 */
export function padCells(value: string, width: number, fillChar = ' '): string {
  const deficit = width - cellWidth(value)
  return deficit > 0 ? value + fillChar.repeat(deficit) : value
}

export function truncateCells(
  value: string,
  width: number,
  options: { ascii?: boolean } = {}
): string {
  if (width < 1) {
    return ''
  }

  if (cellWidth(value) <= width) {
    return value
  }

  // Unicode `…` is 1 cell vs. ASCII `...` at 3 — matches `truncatePathCells`'s
  // dialect so a path elision and a plain truncation never mix markers
  // (#1366). `theme.ascii` opts back into the 3-cell ASCII form.
  const ellipsis = options.ascii ? '...' : '…'
  const suffix = width > cellWidth(ellipsis) ? ellipsis : ''
  const available = width - cellWidth(suffix)
  let used = 0
  let output = ''

  for (const character of Array.from(value)) {
    const nextWidth = characterWidth(character)

    if (used + nextWidth > available) {
      break
    }

    output += character
    used += nextWidth
  }

  return `${output}${suffix}`
}

/**
 * Truncate a file path so the filename (last segment) is preserved,
 * eliding middle directory segments with `…/` instead of dropping
 * end-of-string characters.
 *
 * `truncateCells` is the wrong tool for paths because it preserves the
 * START of the string and drops the END — losing the filename, which
 * is the most useful part. Example with `truncateCells`:
 *
 *   "src/commands/log/data.ts" (24) at width 18 → "src/commands/lo..."
 *
 * `truncatePathCells` preserves the filename and elides middle:
 *
 *   "src/commands/log/data.ts" (24) at width 18 → "src/…/log/data.ts"
 *
 * The algorithm tries successively-smaller prefixes (keeping the start
 * of the path, the filename, and replacing the dropped middle segments
 * with `…`) and returns the largest variant that fits. When even
 * `…/<filename>` doesn't fit, falls back to plain `truncateCells` on
 * the abbreviated form — better to show end-of-name than start-of-path.
 *
 * For inputs without `/` separators, behaves identically to
 * `truncateCells`. Empty / width-0 cases match `truncateCells` too.
 *
 * @example
 *   truncatePathCells('src/commands/log/data.ts', 18) // 'src/…/log/data.ts'
 *   truncatePathCells('src/commands/log/data.ts', 12) // '…/data.ts'
 *   truncatePathCells('a/b/c.ts', 100)                // 'a/b/c.ts'  (fits)
 *   truncatePathCells('plainname.ts', 8)              // 'plain...'
 */
export function truncatePathCells(value: string, width: number): string {
  if (width < 1) return ''
  if (cellWidth(value) <= width) return value

  // No path structure to exploit — fall through to plain truncation.
  if (!value.includes('/')) return truncateCells(value, width)

  const segments = value.split('/')
  const filename = segments[segments.length - 1] ?? ''
  const prefix = segments.slice(0, -1)

  // Path is just '/filename' or has only the filename — no middle to
  // elide. Defer to plain truncation.
  if (prefix.length === 0) return truncateCells(value, width)

  // Walk from "keep all prefix segments except the deepest" down to
  // "keep no prefix segments." First variant that fits wins.
  for (let keep = prefix.length - 1; keep >= 0; keep--) {
    const candidate = keep === 0
      ? `…/${filename}`
      : `${prefix.slice(0, keep).join('/')}/…/${filename}`
    if (cellWidth(candidate) <= width) return candidate
  }

  // Even `…/<filename>` doesn't fit. Use plain truncation on that
  // form — preserves the leading `…/` so the user knows a path was
  // elided, then ellipsis-truncates the filename.
  return truncateCells(`…/${filename}`, width)
}

/**
 * Expand tab characters to spaces using fixed column stops (#1393).
 *
 * `cellWidth` counts control characters as 0 cells, but a terminal
 * advances to the next tab stop per `\t` — so tab-indented content
 * (Go, Makefiles) rendered rows that visually overran every truncation
 * budget while "measuring" as fitting. Expanding at fixed stops from
 * the string's own start is deliberately simpler than real terminal
 * tab stops (which are column-relative to whatever gutters render
 * before the content): the output is consistent and measurable, which
 * is what the width math needs. `startColumn` lets segment-wise
 * callers (syntax-highlighted diff spans) keep the column running
 * across segments.
 */
export function expandTabs(value: string, tabWidth = 8, startColumn = 0): string {
  if (!value.includes('\t')) return value
  let out = ''
  let column = startColumn
  for (const character of value) {
    if (character === '\t') {
      const pad = tabWidth - (column % tabWidth)
      out += ' '.repeat(pad)
      column += pad
      continue
    }
    out += character
    column += characterWidth(character)
  }
  return out
}
