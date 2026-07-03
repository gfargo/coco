/**
 * Pull-request triage surface (#882 phase 3). Read-only list view
 * rendered in the main panel when `state.activeView ===
 * 'pull-request-triage'`. Distinct from the existing single-PR action
 * panel (`'pull-request'`, chord `gp`) — this is the multi-PR list
 * surface (chord `gP`).
 *
 * Pure renderer; data flows in via `context.pullRequestList`. Per-row
 * actions (merge, approve, request-changes, close, comment) and AI
 * summarize land in phase 4-6.
 */

import type * as ReactTypes from 'react'
import type { PullRequestListItem } from '../../../git/pullRequestListData'
import { isLogInkContextKeyLoading } from '../../chrome/context'
import { inlineSpinnerGlyph } from '../../chrome/spinner'
import { clampListWindowStart } from '../../chrome/layout'
import { forgeNouns } from '../../chrome/forgeNouns'
import {
  formatLogInkForgeNoRemote,
  formatLogInkForgeUnauthenticated,
  formatLogInkLoading,
  formatLogInkPullRequestTriageEmpty,
} from '../../chrome/surfaceStates'
import { cellWidth, truncateCells } from '../../chrome/text'
import type { LogInkTheme } from '../../chrome/theme'
import { PULL_REQUEST_FILTER_LABELS } from '../../../git/triageFilterPresets'
import { matchesPromotedFilter } from '../../runtime/promotedFilter'
import { isPendingItemAction } from '../../runtime/inkViewModel'
import type { SurfaceRenderContext } from '../../runtime/types'
import { focusBorderColor, panelTitle } from '../../runtime/utils'

function stateColor(theme: LogInkTheme, state: string, isDraft: boolean): string | undefined {
  if (theme.noColor) return undefined
  if (isDraft) return theme.colors.muted
  switch (state.toUpperCase()) {
    case 'OPEN':
      return theme.colors.success
    case 'CLOSED':
      return theme.colors.danger
    case 'MERGED':
      return theme.colors.accent
    default:
      return theme.colors.muted
  }
}

function reviewGlyph(decision: string | undefined): string {
  switch (decision) {
    case 'APPROVED':
      return '✓'
    case 'CHANGES_REQUESTED':
      return '✗'
    case 'REVIEW_REQUIRED':
      return '?'
    default:
      return ' '
  }
}

function mergeableGlyph(mergeStateStatus: string | undefined, mergeable: string | undefined): string {
  if (mergeStateStatus === 'CLEAN') return '●'
  if (mergeStateStatus === 'BLOCKED') return '●'
  if (mergeStateStatus === 'DIRTY' || mergeable === 'CONFLICTING') return '●'
  if (mergeStateStatus === 'BEHIND') return '●'
  if (mergeStateStatus === 'UNSTABLE') return '●'
  return '·'
}

function mergeableColor(theme: LogInkTheme, mergeStateStatus: string | undefined, mergeable: string | undefined): string | undefined {
  if (theme.noColor) return undefined
  if (mergeStateStatus === 'CLEAN') return theme.colors.success
  if (mergeStateStatus === 'BLOCKED' || mergeStateStatus === 'UNSTABLE') return theme.colors.warning
  if (mergeStateStatus === 'DIRTY' || mergeable === 'CONFLICTING') return theme.colors.danger
  if (mergeStateStatus === 'BEHIND') return theme.colors.accent
  return theme.colors.muted
}

function reviewColor(theme: LogInkTheme, decision: string | undefined): string | undefined {
  if (theme.noColor) return undefined
  switch (decision) {
    case 'APPROVED':
      return theme.colors.success
    case 'CHANGES_REQUESTED':
      return theme.colors.danger
    case 'REVIEW_REQUIRED':
      return theme.colors.warning
    default:
      return theme.colors.muted
  }
}

function matchesPullRequestFilter(pr: PullRequestListItem, filter: string): boolean {
  if (!filter) return true
  return matchesPromotedFilter(
    [
      `#${pr.number}`,
      pr.title,
      pr.author || '',
      pr.headRefName,
      pr.baseRefName,
      ...(pr.labels || []),
      ...(pr.assignees || []),
    ],
    filter
  )
}

export function renderPullRequestTriageSurface(
  ctx: SurfaceRenderContext,
  spinnerFrame: number = 0
): ReactTypes.ReactElement {
  const { h, components, state, context, contextStatus, bodyRows, width, theme } = ctx
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const overview = context.pullRequestList
  const loading = isLogInkContextKeyLoading(contextStatus, 'pullRequestList')
  const nouns = forgeNouns(context.provider?.repository.provider)

  let headerRight = ''
  let bodyLines: ReactTypes.ReactNode[] = []

  if (loading || !overview) {
    headerRight = `loading ${nouns.pluralLower}`
    bodyLines = [
      h(Text, { key: 'pr-triage-loading', dimColor: true }, formatLogInkLoading({ resource: nouns.pluralLower })),
    ]
  } else if (!overview.available) {
    headerRight = 'unavailable'
    bodyLines = [
      h(Text, { key: 'pr-triage-no-remote', dimColor: true },
        formatLogInkForgeNoRemote({ resource: nouns.plural, forge: nouns.name })),
    ]
  } else if (!overview.authenticated) {
    headerRight = `${nouns.cli} not authenticated`
    bodyLines = [
      h(Text, { key: 'pr-triage-unauth', dimColor: true },
        formatLogInkForgeUnauthenticated({ resource: nouns.plural, cli: nouns.cli, forge: nouns.name })),
    ]
  } else if (overview.message && !overview.pullRequests) {
    headerRight = 'error'
    bodyLines = [
      h(Text, {
        key: 'pr-triage-error',
        dimColor: true,
        color: theme.noColor ? undefined : theme.colors.danger,
      }, overview.message),
    ]
  } else {
    const all = overview.pullRequests || []
    const visible = state.filter
      ? all.filter((pr) => matchesPullRequestFilter(pr, state.filter))
      : all
    const selected = Math.max(
      0,
      Math.min(state.selectedPullRequestTriageIndex, Math.max(0, visible.length - 1))
    )
    const listRows = Math.max(4, bodyRows - 4)
    const startIndex = clampListWindowStart(selected, visible.length, listRows)
    const windowed = visible.slice(startIndex, startIndex + listRows)
    const filterLabel = state.filter ? ` | filter: ${state.filter}` : ''
    const presetLabel = `▼ ${PULL_REQUEST_FILTER_LABELS[state.selectedPullRequestFilter]}`
    const repoLabel = overview.repository
      ? `${overview.repository.owner}/${overview.repository.name}`
      : ''
    headerRight = `${repoLabel ? `${repoLabel} · ` : ''}${visible.length}/${all.length} | ${presetLabel}${filterLabel}`

    if (visible.length === 0) {
      bodyLines = [
        h(Text, { key: 'pr-triage-empty', dimColor: true },
          formatLogInkPullRequestTriageEmpty({ filter: state.filter, noun: nouns.pluralLower })),
      ]
    } else {
      const numberColWidth = Math.min(
        6,
        Math.max(...windowed.map((p) => `#${p.number}`.length), 3)
      )
      // Width-responsive column caps (#1391). The fixed caps (16
      // author + 24 branch) plus the other columns totalled ~68 cells
      // while the main panel interior is ~50-64 at common terminal
      // widths — every row with a long author/branch wrapped, double-
      // lining the whole list. Author and branch now shrink first:
      // the interior minus the immovable columns (cursor, number,
      // state, merge/review glyphs, inter-column gaps) splits between
      // a title reserve and the author/branch pair.
      const interior = Math.max(20, width - 4)
      const immovable = 22 + numberColWidth
      const remaining = Math.max(0, interior - immovable)
      const titleReserve = Math.max(12, Math.floor(remaining * 0.45))
      const authorBranchBudget = Math.max(10, remaining - titleReserve)
      const authorCap = Math.max(4, Math.min(16, Math.floor(authorBranchBudget * 0.4)))
      const branchCap = Math.max(6, Math.min(24, authorBranchBudget - authorCap))
      const authorColWidth = Math.min(
        authorCap,
        Math.max(...windowed.map((p) => (p.author || '').length), 4)
      )
      const branchColWidth = Math.min(
        branchCap,
        Math.max(...windowed.map((p) => p.headRefName.length), 6)
      )

      bodyLines = windowed.map((pr, offset) => {
        const index = startIndex + offset
        const isSelected = index === selected
        // #1363 — while `gh pr checkout <n>` runs against this row, the
        // cursor glyph swaps for the shared inline spinner (same idiom
        // as the branches surface's delete/checkout rows).
        const busy = isPendingItemAction(state.pendingItemAction, 'pull-request', String(pr.number))
        const cursor = busy ? inlineSpinnerGlyph(spinnerFrame, theme.ascii) : isSelected ? '>' : ' '
        const numStr = `#${pr.number}`.padEnd(numberColWidth)
        const stateLabel = pr.isDraft ? 'draft' : pr.state.toLowerCase()
        const stateStr = stateLabel.padEnd(6)
        const mergeStr = mergeableGlyph(pr.mergeStateStatus, pr.mergeable)
        const reviewStr = reviewGlyph(pr.reviewDecision)
        // Truncate before padding: padEnd never shortens, so an author
        // longer than the capped column would silently widen the row.
        const authorStr = truncateCells(pr.author || '', authorColWidth).padEnd(authorColWidth)
        const branchStr = truncateCells(pr.headRefName, branchColWidth).padEnd(branchColWidth)
        // Title and labels share the remaining row width. Labels are
        // budgeted (they can be arbitrarily long) but never squeeze the
        // title below a readable minimum — past that the labels
        // truncate instead. Cell math, not .length: labels/titles can
        // contain emoji/wide glyphs, and the merge/review glyphs are
        // non-ASCII.
        const head = `${cursor} `
        const prefix = `${numStr}  ${stateStr}  ${mergeStr}  ${reviewStr}  ${authorStr}  ${branchStr}  `
        const available = Math.max(8, width - 4 - cellWidth(head) - cellWidth(prefix))
        const rawLabelStr = (pr.labels || []).length
          ? ` [${(pr.labels || []).join(' ')}]`
          : ''
        // Labels reserve at most a third of the shared space; the title
        // takes the rest, then labels fill whatever the title actually
        // left (a short title hands its slack back to the labels).
        const labelReserve = Math.min(cellWidth(rawLabelStr), Math.floor(available / 3))
        const titleBudget = Math.max(8, available - labelReserve)
        const titleStr = truncateCells(pr.title, titleBudget)
        const labelStr = truncateCells(rawLabelStr, Math.max(0, available - cellWidth(titleStr)))

        return h(Text, {
          key: `pr-triage-${index}`,
          bold: isSelected,
          dimColor: !isSelected,
        },
        head,
        h(Text, { dimColor: true }, numStr + '  '),
        h(Text, {
          color: stateColor(theme, pr.state, pr.isDraft),
          dimColor: !isSelected,
        }, stateStr + '  '),
        h(Text, {
          color: mergeableColor(theme, pr.mergeStateStatus, pr.mergeable),
          dimColor: !isSelected,
        }, mergeStr + '  '),
        h(Text, {
          color: reviewColor(theme, pr.reviewDecision),
          dimColor: !isSelected,
        }, reviewStr + '  '),
        h(Text, {
          color: theme.noColor ? undefined : theme.colors.accent,
          dimColor: !isSelected,
        }, authorStr + '  '),
        h(Text, { dimColor: true }, branchStr + '  '),
        titleStr,
        h(Text, { dimColor: true }, labelStr),
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
    h(Text, { bold: true }, panelTitle(nouns.plural, focused)),
    h(Text, { dimColor: true }, headerRight)
  ),
  ...bodyLines)
}
