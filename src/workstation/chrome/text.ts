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

export function truncateCells(value: string, width: number): string {
  if (width < 1) {
    return ''
  }

  if (cellWidth(value) <= width) {
    return value
  }

  const suffix = width > 3 ? '...' : ''
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
