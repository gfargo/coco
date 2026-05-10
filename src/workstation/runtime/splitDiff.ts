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
import { SplitDiffRow, buildSplitDiffRows } from '../chrome/splitDiff'
import { truncateCells } from '../chrome/text'
import type { LogInkTheme } from '../chrome/theme'
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
 * Render the split-diff body as a list of two-column rows. The caller
 * is responsible for slicing the unified-line array to the visible
 * window — the helper just transforms that slice into Ink nodes.
 */
export function renderSplitDiffBody(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  unifiedSlice: string[],
  startOffset: number,
  width: number,
  theme: LogInkTheme,
  keyPrefix: string
): ReactTypes.ReactElement[] {
  const { Box, Text } = components
  const rows = buildSplitDiffRows(unifiedSlice)
  // Reserve 3 columns of gutter (1 left padding from the Box + 1 column
  // separator + 1 right padding) so neither side touches the border.
  const usable = Math.max(20, width - 4)
  const gutter = 1
  const half = Math.max(10, Math.floor((usable - gutter) / 2))
  return rows.map((row, index) => {
    const leftProps = splitDiffSideProps(row.left.kind, theme)
    const rightProps = splitDiffSideProps(row.right.kind, theme)
    const leftText = formatSplitDiffCell(row.left, half)
    const rightText = formatSplitDiffCell(row.right, half)
    return h(Box, {
      key: `${keyPrefix}-${startOffset + index}`,
      flexDirection: 'row',
    },
    h(Box, { width: half, flexShrink: 0 },
      h(Text, leftProps, leftText)
    ),
    h(Box, { width: gutter, flexShrink: 0 }, h(Text, { dimColor: true }, ' ')),
    h(Box, { width: half, flexShrink: 0 },
      h(Text, rightProps, rightText)
    )
    )
  })
}
