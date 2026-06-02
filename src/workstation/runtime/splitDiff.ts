/**
 * Split-diff rendering helpers (#785) — shared between the diff
 * surface and any future surface that wants side-by-side diff layout.
 *
 * The actual hunk parsing lives in `chrome/splitDiff.ts`
 * (`buildSplitDiffRows`); this module wraps that data into Ink nodes
 * with the right column widths, gutter, and per-row styling.
 *
 * Extracted from `src/commands/log/inkRuntime.ts` as part of phase 5a.4
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import { SplitDiffRow, buildSplitDiffRows, computeDiffContext } from '../chrome/splitDiff'
import { cellWidth, truncateCells } from '../chrome/text'
import { resolveSyntaxColor } from '../chrome/syntaxColors'
import type { LogInkTheme } from '../chrome/theme'
import type { SyntaxSpan } from '../../lib/syntax/highlightEngine'
import type { LogInkState } from '../../commands/log/inkViewModel'
import type { LogInkComponents } from './types'

/**
 * Minimum terminal width below which the split diff falls back to
 * unified rendering (#785). Each column needs ~50 columns for code to
 * read comfortably plus border + padding overhead, so anything narrower
 * than ~120 columns gets the unified view regardless of the user's
 * preference. The preference is preserved — switching back to a wide
 * terminal restores split mode automatically.
 */
export const MIN_SPLIT_DIFF_WIDTH = 120

export function isSplitDiffViable(state: LogInkState, width: number): boolean {
  return state.diffViewMode === 'split' && width >= MIN_SPLIT_DIFF_WIDTH
}

/**
 * Style props for one side of a split-diff row, derived from the row's
 * `kind` rather than the leading character (because the helper has
 * already stripped the leading +/-/space). Keeps the colors aligned with
 * `diffLineProps`.
 */
export function splitDiffSideProps(
  kind: SplitDiffRow['left']['kind'] | SplitDiffRow['right']['kind'],
  theme: LogInkTheme
): { color?: string; dimColor?: boolean } {
  if (kind === 'header') {
    if (theme.noColor) return { dimColor: true }
    return { color: theme.colors.accent }
  }
  if (kind === 'empty') {
    return { dimColor: true }
  }
  if (theme.noColor) {
    return { dimColor: kind === 'context' }
  }
  if (kind === 'add') return { color: theme.colors.gitAdded }
  if (kind === 'remove') return { color: theme.colors.gitDeleted }
  return {}
}

/**
 * Format one column of a split-diff row: an optional 4-digit line
 * number prefix + the line text, padded/truncated to the column width.
 * Empty rows render a faint `·` placeholder so the alignment gap is
 * visible at a glance.
 */
export function formatSplitDiffCell(
  side: SplitDiffRow['left'] | SplitDiffRow['right'],
  columnWidth: number
): string {
  if (side.kind === 'empty') {
    const placeholder = ' · '
    return placeholder.padEnd(columnWidth)
  }
  if (side.kind === 'header') {
    return truncateCells(side.text, columnWidth).padEnd(columnWidth)
  }
  const lineNo = side.lineNumber !== undefined ? String(side.lineNumber).padStart(4) : '    '
  // Strip the trailing newline that some diffs include. Keeps column
  // widths predictable.
  const text = side.text.replace(/\n$/, '')
  // 4 digits + 1 space gutter = 5 chars; reserve that off the column
  // before truncating the text.
  const textRoom = Math.max(1, columnWidth - 5)
  return `${lineNo} ${truncateCells(text, textRoom)}`.padEnd(columnWidth)
}

/**
 * Render one split-diff column as an Ink node — syntax-highlighted when
 * spans are available for the line, plain otherwise.
 *
 * Highlighted cells keep the 4-digit line-number gutter but color IT
 * with the add/remove cue (green/red, dim for context) so the code body
 * is free to carry its syntax colors — the split layout's position
 * (old | new) plus the colored gutter still tells you what changed.
 * Width is budgeted exactly like `formatSplitDiffCell` (gutter + 1 space
 * + truncated code) so columns never drift.
 */
function renderSplitDiffCell(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  side: SplitDiffRow['left'] | SplitDiffRow['right'],
  columnWidth: number,
  theme: LogInkTheme,
  syntaxSpans: Map<string, SyntaxSpan[]> | undefined,
  key: string
): ReactTypes.ReactElement {
  const text = side.text.replace(/\n$/, '')
  const spans =
    side.kind === 'add' || side.kind === 'remove' || side.kind === 'context'
      ? syntaxSpans?.get(text)
      : undefined
  if (!spans || spans.length === 0) {
    return h(Text, { key, ...splitDiffSideProps(side.kind, theme) }, formatSplitDiffCell(side, columnWidth))
  }

  const lineNo = side.lineNumber !== undefined ? String(side.lineNumber).padStart(4) : '    '
  const textRoom = Math.max(1, columnWidth - 5)
  const gutterColor =
    side.kind === 'add'
      ? theme.colors.gitAdded
      : side.kind === 'remove'
        ? theme.colors.gitDeleted
        : undefined

  const children: ReactTypes.ReactElement[] = []
  let used = 0
  for (const span of spans) {
    if (used >= textRoom) break
    const segment = truncateCells(text.slice(span.start, span.end), textRoom - used)
    if (!segment) continue
    used += cellWidth(segment)
    children.push(
      h(Text, { key: `${key}-s${span.start}`, color: resolveSyntaxColor(span.token, theme) }, segment)
    )
  }
  return h(
    Text,
    { key },
    h(Text, { key: `${key}-g`, color: gutterColor, dimColor: !gutterColor }, `${lineNo} `),
    ...children
  )
}

/**
 * Render the split-diff body as a list of two-column rows.
 *
 * Takes the FULL unified-line array plus the scroll offset + visible
 * row budget, and windows it internally. The windowing has to live
 * here (not the caller) because the parser is stateful: a window that
 * starts partway through a hunk needs the hunk context (in-hunk flag +
 * line-number cursors) that precedes it, or every visible line gets
 * misclassified as a header and painted in the accent color (#1114).
 * We compute that context from the lines before the window and seed
 * the parser with it.
 */
export function renderSplitDiffBody(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  unifiedLines: string[],
  startOffset: number,
  visibleRows: number,
  width: number,
  theme: LogInkTheme,
  keyPrefix: string,
  syntaxSpans?: Map<string, SyntaxSpan[]>
): ReactTypes.ReactElement[] {
  const { Box, Text } = components
  const seed = computeDiffContext(unifiedLines, startOffset)
  const unifiedSlice = unifiedLines.slice(startOffset, startOffset + visibleRows)
  const rows = buildSplitDiffRows(unifiedSlice, seed)
  // Reserve 3 columns of gutter (1 left padding from the Box + 1 column
  // separator + 1 right padding) so neither side touches the border.
  const usable = Math.max(20, width - 4)
  const gutter = 1
  const half = Math.max(10, Math.floor((usable - gutter) / 2))
  return rows.map((row, index) => {
    const rowKey = `${keyPrefix}-${startOffset + index}`
    return h(Box, {
      key: rowKey,
      flexDirection: 'row',
    },
    h(Box, { width: half, flexShrink: 0 },
      renderSplitDiffCell(h, Text, row.left, half, theme, syntaxSpans, `${rowKey}-l`)
    ),
    h(Box, { width: gutter, flexShrink: 0 }, h(Text, { dimColor: true }, ' ')),
    h(Box, { width: half, flexShrink: 0 },
      renderSplitDiffCell(h, Text, row.right, half, theme, syntaxSpans, `${rowKey}-r`)
    )
    )
  })
}
