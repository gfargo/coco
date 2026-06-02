/**
 * Pair-alignment helper for the side-by-side diff view (#785).
 *
 * Takes the unified-diff line array that the renderer already paints (one
 * line per element, the leading character drives `+`/`-`/context coloring)
 * and re-shapes it into two-column rows the split renderer can lay out
 * without further parsing. Pure / synchronous so it can be exercised from
 * tests without spinning up Ink.
 *
 * Algorithm:
 *  1. Walk lines in order. `@@` headers seed a new hunk and reset the
 *     `oldLineNo` / `newLineNo` cursors from the header range.
 *  2. Inside a hunk, group the consecutive runs of `-` and `+` lines that
 *     follow each other. Each run of removals + the immediately-following
 *     run of additions forms a "change block" that pairs up element-wise:
 *     row[i] = { left: removals[i], right: additions[i] }. When one side
 *     is shorter, pad with `kind: 'empty'` rows so the columns stay
 *     aligned.
 *  3. Context lines emit as a paired row with the same text on both
 *     sides and the synthesized line numbers from each cursor.
 *  4. Diff metadata (`diff `, `index `, `--- `, `+++ `, etc.) emit as
 *     `kind: 'header'` rows so the split view still has a section break.
 *  5. A context line that interrupts a change block forces the in-flight
 *     block to flush before the context row is emitted — pairs are never
 *     drawn across context boundaries (matches lazygit / fugitive
 *     behavior, and is what the issue specifies).
 *
 * Long lines are not wrapped here — the renderer truncates per column at
 * paint time so this helper stays pure and trivially testable.
 */

export type SplitDiffSideKind = 'context' | 'add' | 'remove' | 'header' | 'empty'

export type SplitDiffSide = {
  text: string
  lineNumber?: number
  kind: SplitDiffSideKind
}

export type SplitDiffRow = {
  left: SplitDiffSide
  right: SplitDiffSide
}

/**
 * Hunk-parse state at a given point in a unified diff: whether we're
 * inside a hunk body and the next old/new line numbers to emit.
 *
 * The split renderer windows the diff by slicing the unified-line
 * array BEFORE parsing (so it only builds rows for the visible rows).
 * That slice can start partway through a hunk — past the `@@` header
 * that seeds `inHunk` and the line-number cursors. Without this seed,
 * `buildSplitDiffRows` starts with `inHunk = false` and classifies
 * every line in the window as a header (#1114) — which paints the
 * whole visible diff in the accent color. Callers compute the context
 * for the slice start with `computeDiffContext` and pass it in.
 */
export type DiffHunkContext = {
  inHunk: boolean
  oldLineNo: number
  newLineNo: number
}

const EMPTY_LEFT: SplitDiffSide = { text: '', kind: 'empty' }
const EMPTY_RIGHT: SplitDiffSide = { text: '', kind: 'empty' }

/**
 * Parse the start line numbers out of an `@@ -A,B +C,D @@` header. Returns
 * `[oldStart, newStart]`; either falls back to 1 when the header is
 * malformed (which only happens with synthetic / hand-crafted patches).
 */
function parseHunkHeader(line: string): [number, number] {
  const match = /@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line)
  if (!match) {
    return [1, 1]
  }
  return [Number(match[1]) || 1, Number(match[2]) || 1]
}

function isDiffHeader(line: string): boolean {
  return (
    line.startsWith('diff ') ||
    line.startsWith('index ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ') ||
    line.startsWith('similarity ') ||
    line.startsWith('rename ') ||
    line.startsWith('copy ') ||
    line.startsWith('new file ') ||
    line.startsWith('deleted file ') ||
    line.startsWith('old mode ') ||
    line.startsWith('new mode ') ||
    line.startsWith('Binary files ')
  )
}

/**
 * Flush a pending change block (removals + additions accumulated from a
 * contiguous `-`/`+` run) into paired rows. Pads the shorter side with
 * empty placeholders so columns stay aligned.
 */
function flushChangeBlock(
  removals: SplitDiffSide[],
  additions: SplitDiffSide[],
  rows: SplitDiffRow[]
): void {
  const max = Math.max(removals.length, additions.length)
  for (let i = 0; i < max; i++) {
    const left = removals[i] || EMPTY_LEFT
    const right = additions[i] || EMPTY_RIGHT
    rows.push({ left, right })
  }
  removals.length = 0
  additions.length = 0
}

/**
 * Replay the hunk parser over `unifiedLines[0..upTo)` (exclusive) and
 * return the parse state at that boundary. Used by the split renderer
 * to seed `buildSplitDiffRows` with the correct in-hunk flag and
 * line-number cursors when it windows the diff to a scroll offset that
 * starts partway through a hunk. Counting mirrors `buildSplitDiffRows`
 * exactly so the seeded line numbers stay continuous across the cut.
 */
export function computeDiffContext(unifiedLines: string[], upTo: number): DiffHunkContext {
  let oldLineNo = 0
  let newLineNo = 0
  let inHunk = false
  const bound = Math.max(0, Math.min(upTo, unifiedLines.length))
  for (let i = 0; i < bound; i++) {
    const raw = unifiedLines[i]
    if (raw.startsWith('@@')) {
      const [oldStart, newStart] = parseHunkHeader(raw)
      oldLineNo = oldStart
      newLineNo = newStart
      inHunk = true
      continue
    }
    if (!inHunk || isDiffHeader(raw)) {
      continue
    }
    if (raw.startsWith('-')) {
      oldLineNo += 1
      continue
    }
    if (raw.startsWith('+')) {
      newLineNo += 1
      continue
    }
    // Context line (or `\ No newline` marker) advances both cursors.
    oldLineNo += 1
    newLineNo += 1
  }
  return { inHunk, oldLineNo, newLineNo }
}

export function buildSplitDiffRows(
  unifiedLines: string[],
  seed?: DiffHunkContext
): SplitDiffRow[] {
  const rows: SplitDiffRow[] = []
  let oldLineNo = seed?.oldLineNo ?? 0
  let newLineNo = seed?.newLineNo ?? 0
  let inHunk = seed?.inHunk ?? false
  const removals: SplitDiffSide[] = []
  const additions: SplitDiffSide[] = []

  const flushHeader = (text: string) => {
    flushChangeBlock(removals, additions, rows)
    rows.push({
      left: { text, kind: 'header' },
      right: { text, kind: 'header' },
    })
  }

  for (const raw of unifiedLines) {
    if (raw.startsWith('@@')) {
      flushChangeBlock(removals, additions, rows)
      const [oldStart, newStart] = parseHunkHeader(raw)
      oldLineNo = oldStart
      newLineNo = newStart
      inHunk = true
      rows.push({
        left: { text: raw, kind: 'header' },
        right: { text: raw, kind: 'header' },
      })
      continue
    }

    if (!inHunk || isDiffHeader(raw)) {
      flushHeader(raw)
      continue
    }

    if (raw.startsWith('-')) {
      removals.push({
        text: raw.slice(1),
        lineNumber: oldLineNo,
        kind: 'remove',
      })
      oldLineNo += 1
      continue
    }

    if (raw.startsWith('+')) {
      additions.push({
        text: raw.slice(1),
        lineNumber: newLineNo,
        kind: 'add',
      })
      newLineNo += 1
      continue
    }

    // Context line (or `\ No newline at end of file` marker, which we
    // treat like a context row so it lands on both sides — readers
    // expect to see it in either column).
    flushChangeBlock(removals, additions, rows)
    const text = raw.startsWith(' ') ? raw.slice(1) : raw
    rows.push({
      left: { text, lineNumber: oldLineNo, kind: 'context' },
      right: { text, lineNumber: newLineNo, kind: 'context' },
    })
    oldLineNo += 1
    newLineNo += 1
  }

  flushChangeBlock(removals, additions, rows)
  return rows
}
