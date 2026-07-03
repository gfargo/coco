/**
 * Reflog surface (#781). Renders `git reflog` chronologically — every
 * HEAD movement (commit, checkout, merge, reset, …) with relative time,
 * action, hash, and message. Press Enter on any row to drill into the
 * diff for that entry's hash.
 *
 * Extracted from `src/workstation/runtime/inkRuntime.ts` as part of phase 5a.1
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import { isLogInkContextKeyLoading } from '../../chrome/context'
import { clampListWindowStart } from '../../chrome/layout'
import { formatLogInkLoading, formatLogInkReflogEmpty } from '../../chrome/surfaceStates'
import { truncateCells } from '../../chrome/text'
import { splitReflogSubject } from '../../../git/reflogData'
import {
  matchesPromotedFilter,
  renderPromotedFilterAffordance,
} from '../../runtime/promotedFilter'
import type { SurfaceRenderContext } from '../../runtime/types'
import { focusBorderColor, panelTitle } from '../../runtime/utils'

export function renderReflogSurface(ctx: SurfaceRenderContext): ReactTypes.ReactElement {
  const { h, components, state, context, contextStatus, bodyRows, width, theme } = ctx
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const loading = isLogInkContextKeyLoading(contextStatus, 'reflog')
  const allEntries = context.reflog?.entries || []
  const entries = state.filter
    ? allEntries.filter((entry) => matchesPromotedFilter(
      [entry.selector, entry.hash, entry.relativeDate, entry.subject],
      state.filter
    ))
    : allEntries
  const selected = Math.max(0, Math.min(state.selectedReflogIndex, Math.max(0, entries.length - 1)))
  const listRows = Math.max(4, bodyRows - 4)
  const startIndex = clampListWindowStart(selected, entries.length, listRows)
  const visible = entries.slice(startIndex, startIndex + listRows)
  const filterLabel = state.filter ? ` | filter: ${state.filter}` : ''
  const headerRight = loading
    ? 'loading reflog'
    : `${entries.length}/${allEntries.length} entries${filterLabel}`
  const emptyLabel = formatLogInkReflogEmpty({ filter: state.filter })
  const loadingLabel = formatLogInkLoading({ resource: 'reflog' })

  // Column widths derived from the visible window. The hash column is
  // fixed (short SHA is always 7 chars) and the date column caps so
  // "X minutes ago" / "Y hours ago" stays readable without dominating
  // the row. Action column scales to the longest visible action so
  // commit / checkout / merge align cleanly.
  const splitVisible = visible.map((entry) => ({
    entry,
    parts: splitReflogSubject(entry.subject),
  }))
  const dateColWidth = splitVisible.length === 0
    ? 16
    : Math.min(20, Math.max(6, ...splitVisible.map(({ entry }) => entry.relativeDate.length)))
  const actionColWidth = splitVisible.length === 0
    ? 12
    : Math.min(24, Math.max(6, ...splitVisible.map(({ parts }) => parts.action.length)))
  const hashColWidth = 8

  const lines: ReactTypes.ReactNode[] = loading
    ? [h(Text, { key: 'reflog-loading', dimColor: true }, loadingLabel)]
    : entries.length === 0
      ? [h(Text, { key: 'reflog-empty', dimColor: true }, emptyLabel)]
      : splitVisible.map(({ entry, parts }, offset) => {
        const index = startIndex + offset
        const isSelected = index === selected
        const cursor = isSelected ? '>' : ' '
        const datePadded = truncateCells(entry.relativeDate, dateColWidth).padEnd(dateColWidth)
        const actionPadded = truncateCells(parts.action, actionColWidth).padEnd(actionColWidth)
        const hashPadded = truncateCells(entry.hash, hashColWidth).padEnd(hashColWidth)
        const message = parts.message || entry.subject
        const lineText = truncateCells(
          `${cursor} ${datePadded} ${actionPadded} ${hashPadded} ${message}`,
          Math.max(20, width - 4)
        )
        return h(Text, {
          key: `reflog-${index}`,
          bold: isSelected,
          dimColor: !isSelected,
        }, lineText)
      })

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexShrink: 0,
    paddingX: 1,
    width,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Reflog', focused)),
    h(Text, { dimColor: true }, headerRight)
  ),
  ...renderPromotedFilterAffordance(h, Text, state, theme),
  ...lines)
}
