/**
 * Issues triage surface (#882 phase 3). Read-only list view rendered
 * in the main panel when `state.activeView === 'issues'`. Mirrors the
 * branches / tags surface pattern: pure renderer, no hooks, no async.
 * Data flows in via `context.issueList`; the cursor position lives at
 * `state.selectedIssueIndex`.
 *
 * Per-row actions (assign, label, comment, close) and AI summarize
 * land in phase 4-6. This phase ships navigation only.
 */

import type * as ReactTypes from 'react'
import type { IssueListItem } from '../../../git/issuesListData'
import { isLogInkContextKeyLoading } from '../../chrome/context'
import { clampListWindowStart } from '../../chrome/layout'
import { forgeNouns } from '../../chrome/forgeNouns'
import {
  formatLogInkForgeNoRemote,
  formatLogInkForgeUnauthenticated,
  formatLogInkIssuesEmpty,
  formatLogInkLoading,
} from '../../chrome/surfaceStates'
import { cellWidth, truncateCells } from '../../chrome/text'
import type { LogInkTheme } from '../../chrome/theme'
import { ISSUE_FILTER_LABELS } from '../../../git/triageFilterPresets'
import { matchesPromotedFilter } from '../../runtime/promotedFilter'
import type { SurfaceRenderContext } from '../../runtime/types'
import { focusBorderColor, panelTitle } from '../../runtime/utils'

function stateColor(theme: LogInkTheme, state: string): string | undefined {
  if (theme.noColor) return undefined
  switch (state.toUpperCase()) {
    case 'OPEN':
      return theme.colors.success
    case 'CLOSED':
      return theme.colors.danger
    default:
      return theme.colors.muted
  }
}

function matchesIssueFilter(issue: IssueListItem, filter: string): boolean {
  if (!filter) return true
  return matchesPromotedFilter(
    [
      `#${issue.number}`,
      issue.title,
      issue.author || '',
      ...(issue.labels || []),
      ...(issue.assignees || []),
    ],
    filter
  )
}

export function renderIssuesTriageSurface(ctx: SurfaceRenderContext): ReactTypes.ReactElement {
  const { h, components, state, context, contextStatus, bodyRows, width, theme } = ctx
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const overview = context.issueList
  const loading = isLogInkContextKeyLoading(contextStatus, 'issueList')
  const forge = forgeNouns(context.provider?.repository.provider)

  // Resolve the "what should the panel say" headline first, then fan
  // out to the row body. The chrome (border + title + headerRight) is
  // identical across loading / unavailable / unauthenticated / empty
  // / populated states; only the body changes.
  let headerRight = ''
  let bodyLines: ReactTypes.ReactNode[] = []

  if (loading || !overview) {
    headerRight = 'Loading issues…'
    bodyLines = [
      h(Text, { key: 'issues-loading', dimColor: true }, formatLogInkLoading({ resource: 'issues' })),
    ]
  } else if (!overview.available) {
    headerRight = 'unavailable'
    bodyLines = [
      h(Text, { key: 'issues-no-remote', dimColor: true },
        formatLogInkForgeNoRemote({ resource: 'Issues', forge: forge.name })),
    ]
  } else if (!overview.authenticated) {
    headerRight = `${forge.cli} not authenticated`
    bodyLines = [
      h(Text, { key: 'issues-unauth', dimColor: true },
        formatLogInkForgeUnauthenticated({ resource: 'Issues', cli: forge.cli, forge: forge.name, authHint: forge.authHint })),
    ]
  } else if (overview.message && !overview.issues) {
    headerRight = 'error'
    bodyLines = [
      h(Text, { key: 'issues-error', dimColor: true, color: theme.noColor ? undefined : theme.colors.danger },
        overview.message),
    ]
  } else {
    const all = overview.issues || []
    const visible = state.filter
      ? all.filter((issue) => matchesIssueFilter(issue, state.filter))
      : all
    const selected = Math.max(0, Math.min(state.selectedIssueIndex, Math.max(0, visible.length - 1)))
    const listRows = Math.max(4, bodyRows - 4)
    const startIndex = clampListWindowStart(selected, visible.length, listRows)
    const windowed = visible.slice(startIndex, startIndex + listRows)
    const filterLabel = state.filter ? ` | filter: ${state.filter}` : ''
    const presetLabel = `▼ ${ISSUE_FILTER_LABELS[state.selectedIssueFilter]}`
    const repoLabel = overview.repository
      ? `${overview.repository.owner}/${overview.repository.name}`
      : ''
    headerRight = `${repoLabel ? `${repoLabel} · ` : ''}${visible.length}/${all.length} | ${presetLabel}${filterLabel}`

    if (visible.length === 0) {
      bodyLines = [
        h(Text, { key: 'issues-empty', dimColor: true }, formatLogInkIssuesEmpty({ filter: state.filter })),
      ]
    } else {
      // Column widths derived from the visible window so columns stay
      // aligned without one outlier title pushing the rest sideways.
      // Capped to keep the title column from being squeezed out on
      // narrow terminals.
      const numberColWidth = Math.min(
        6,
        Math.max(...windowed.map((i) => `#${i.number}`.length), 3)
      )
      const authorColWidth = Math.min(
        16,
        Math.max(...windowed.map((i) => (i.author || '').length), 4)
      )

      bodyLines = windowed.map((issue, offset) => {
        const index = startIndex + offset
        const isSelected = index === selected
        const cursor = isSelected ? '>' : ' '
        const numStr = `#${issue.number}`.padEnd(numberColWidth)
        const stateStr = issue.state.toLowerCase().padEnd(6)
        // Truncate before padding: padEnd never shortens, so an author
        // longer than the capped column would silently widen the row.
        const authorStr = truncateCells(issue.author || '', authorColWidth).padEnd(authorColWidth)
        const commentsStr =
          typeof issue.comments === 'number' && issue.comments > 0
            ? ` ${issue.comments}c`
            : ''
        // The title and labels share whatever is left after the prefix
        // columns. Labels are budgeted too (they can be arbitrarily
        // long) but never squeeze the title below a readable minimum —
        // past that point the labels truncate instead. Cell math, not
        // .length: labels and titles can contain emoji/wide glyphs.
        const head = `${cursor} `
        const prefix = `${numStr}  ${stateStr}  ${authorStr}  `
        const available = Math.max(
          8,
          width - 4 - cellWidth(head) - cellWidth(prefix) - cellWidth(commentsStr)
        )
        const rawLabelStr = (issue.labels || []).length
          ? ` [${(issue.labels || []).join(' ')}]`
          : ''
        // Labels reserve at most a third of the shared space; the title
        // takes the rest, then labels fill whatever the title actually
        // left (a short title hands its slack back to the labels).
        const labelReserve = Math.min(cellWidth(rawLabelStr), Math.floor(available / 3))
        const titleBudget = Math.max(8, available - labelReserve)
        const titleStr = truncateCells(issue.title, titleBudget)
        const labelStr = truncateCells(rawLabelStr, Math.max(0, available - cellWidth(titleStr)))

        return h(Text, {
          key: `issue-${index}`,
          bold: isSelected,
          dimColor: !isSelected,
        },
        head,
        h(Text, { dimColor: true }, numStr + '  '),
        h(Text, { color: stateColor(theme, issue.state), dimColor: !isSelected }, stateStr + '  '),
        h(Text, { color: theme.noColor ? undefined : theme.colors.accent, dimColor: !isSelected }, authorStr + '  '),
        titleStr,
        h(Text, { dimColor: true }, labelStr),
        h(Text, { dimColor: true }, commentsStr),
        )
      })
    }
  }

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexShrink: 0,
    paddingX: 1,
    width,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Issues', focused)),
    h(Text, { dimColor: true }, headerRight)
  ),
  ...bodyLines)
}
