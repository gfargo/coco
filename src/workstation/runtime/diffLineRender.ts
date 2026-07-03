/**
 * Render a single unified-diff line, syntax-highlighted when spans are
 * available for it, falling back to the classic single-color line
 * otherwise.
 *
 * Highlighted rows render the diff marker (`+`/`-`/` `) in its add/remove
 * color, then the code as a run of per-token colored `Text` spans —
 * delta-style: the marker carries the "added/removed" signal, the code
 * keeps its syntax colors. Width is budgeted exactly like the plain path
 * (marker cell + truncated code) so columns never drift.
 */
import type * as ReactTypes from 'react'
import { cellWidth, expandTabs, truncateCells } from '../chrome/text'
import { resolveSyntaxColor } from '../chrome/syntaxColors'
import type { LogInkTheme } from '../chrome/theme'
import type { SyntaxSpan } from '../../lib/syntax/highlightEngine'
import type { LogInkComponents } from './types'
import { diffLineProps } from './utils'

/**
 * @param syntaxSpans map of marker-stripped code line → token spans
 *   (from `highlightDiffCode`), or undefined when highlighting is off.
 * @param maxCells total cell budget for the whole line (marker + code).
 */
export function renderDiffLine(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  line: string,
  theme: LogInkTheme,
  syntaxSpans: Map<string, SyntaxSpan[]> | undefined,
  maxCells: number,
  key: string
): ReactTypes.ReactElement {
  const spans = line ? syntaxSpans?.get(line.slice(1)) : undefined
  if (!spans || spans.length === 0) {
    // Tabs expand BEFORE truncation (#1393) — cellWidth counts them as
    // 0 cells while the terminal advances a full stop, so tab-indented
    // rows overran the budget while "measuring" as fitting.
    return h(Text, { key, ...diffLineProps(line, theme) }, truncateCells(expandTabs(line), maxCells))
  }

  const marker = line[0]
  const markerColor =
    marker === '+'
      ? theme.colors.gitAdded
      : marker === '-'
        ? theme.colors.gitDeleted
        : undefined
  const code = line.slice(1)
  const budget = Math.max(0, maxCells - 1) // reserve one cell for the marker

  const children: ReactTypes.ReactElement[] = []
  let used = 0
  for (const span of spans) {
    if (used >= budget) break
    // Expand tabs with the running column (#1393) so indentation-only
    // spans consume their real terminal width before truncation.
    const expanded = expandTabs(code.slice(span.start, span.end), 8, used)
    const segment = truncateCells(expanded, budget - used)
    if (!segment) continue
    used += cellWidth(segment)
    children.push(
      h(Text, { key: `${key}-s${span.start}`, color: resolveSyntaxColor(span.token, theme) }, segment)
    )
  }

  return h(
    Text,
    { key },
    h(Text, { key: `${key}-m`, color: markerColor }, marker),
    ...children
  )
}
