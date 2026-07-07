/**
 * Branches surface — promoted view listing local branches with sort,
 * filter, divergence, and last-touched columns. Per-entry actions
 * (checkout, push, fetch, rename, delete, …) are wired in inkInput.ts;
 * this renderer is read-only.
 *
 * Extracted from `src/workstation/runtime/inkRuntime.ts` as part of phase 5a.2
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import { isLogInkContextKeyLoading } from '../../chrome/context'
import { clampListWindowStart } from '../../chrome/layout'
import { getRenderNow } from '../../chrome/snapshotMode'
import {
    branchRowMarker,
    formatBranchDivergence,
    formatBranchLastTouched,
    getBranchRowMarkerColor,
} from '../../chrome/iconography'
import { formatSortIndicator, sortBranches } from '../../chrome/sorting'
import { inlineSpinnerGlyph } from '../../chrome/spinner'
import {
    formatLogInkBranchesEmpty,
    formatLogInkLoading,
} from '../../chrome/surfaceStates'
import { truncateCells } from '../../chrome/text'
import {
    matchesPromotedFilter,
    renderPromotedFilterAffordance,
} from '../../runtime/promotedFilter'
import type { SurfaceRenderContext } from '../../runtime/types'
import { focusBorderColor, panelTitle } from '../../runtime/utils'
import { isPendingItemAction } from '../../../workstation/runtime/inkViewModel'

export function renderBranchesSurface(ctx: SurfaceRenderContext, spinnerFrame: number = 0): ReactTypes.ReactElement {
  const { h, components, state, context, contextStatus, bodyRows, width, theme } = ctx
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const branches = context.branches
  const loading = isLogInkContextKeyLoading(contextStatus, 'branches')
  const sortedAll = sortBranches(branches?.localBranches || [], state.branchSort)
  const localBranches = state.filter
    ? sortedAll.filter((branch) =>
      matchesPromotedFilter([branch.shortName, branch.upstream || ''], state.filter)
    )
    : sortedAll
  const selected = Math.max(0, Math.min(state.selectedBranchIndex, Math.max(0, localBranches.length - 1)))
  // Row budget (#1392): the base reserve (borders + title + one spare)
  // must also count the conditional rows, or the panel grows past its
  // box mid-scroll — the filter affordance while filtering, and BOTH
  // scroll indicators once the list overflows the window (the single
  // spare absorbed only one of them).
  const baseRows = Math.max(4, bodyRows - 4 - (state.filterMode ? 1 : 0))
  const listRows = localBranches.length > baseRows ? Math.max(4, baseRows - 1) : baseRows
  const startIndex = clampListWindowStart(selected, localBranches.length, listRows)
  const visible = localBranches.slice(startIndex, startIndex + listRows)
  const filterLabel = state.filter ? `filter: ${state.filter}` : undefined
  const sortLabel = formatSortIndicator(state.branchSort, { ascii: theme.ascii })
  const headerRight = loading
    ? 'loading branches'
    : [
      `${localBranches.length}/${sortedAll.length} local`,
      filterLabel,
      sortLabel,
    ].filter(Boolean).join(' · ')
  const emptyLabel = formatLogInkBranchesEmpty({ filter: state.filter })
  const loadingLabel = formatLogInkLoading({ resource: 'branches' })
  // Per-column width derived from the visible window (#833) so columns
  // align across rows regardless of name length. Padded to the longest
  // name in view so short rows fill out instead of leaving a gutter;
  // capped at 40 cells so one runaway long branch name doesn't blow
  // out the timestamp column entirely (longer names get truncated and
  // the timestamp stays where the user expects it).
  const nameColWidth = visible.length === 0
    ? 28
    : Math.min(40, Math.max(8, ...visible.map((branch) => branch.shortName.length)))
  const lines: ReactTypes.ReactNode[] = loading
    ? [h(Text, { key: 'branches-loading', dimColor: true }, loadingLabel)]
    : localBranches.length === 0
      ? [h(Text, { key: 'branches-empty', dimColor: true }, emptyLabel)]
      : visible.map((branch, offset) => {
        const index = startIndex + offset
        const isSelected = index === selected
        const cursor = isSelected ? '>' : ' '
        const marker = branchRowMarker(branch, { ascii: theme.ascii })
        // While this branch's delete is in flight, its sync-state marker
        // is replaced by an inline spinner (accent-coloured) so the row
        // reads as "deleting" until it vanishes on refresh.
        const deleting = isPendingItemAction(state.pendingItemAction, 'branch', branch.shortName)
        const glyph = deleting ? inlineSpinnerGlyph(spinnerFrame, theme.ascii) : marker.glyph
        const glyphColor = deleting
          ? (theme.noColor ? undefined : theme.colors.accent)
          : getBranchRowMarkerColor(marker.kind, theme)
        const divergence = formatBranchDivergence(branch, { ascii: theme.ascii })
        const lastTouched = formatBranchLastTouched(branch.date, getRenderNow())
        // Split the row into spans so the timestamp stays dim even on the
        // currently-selected (bold) row, and the sync-state marker keeps
        // its own colour even when the surrounding row text is dimmed.
        const namePadded = truncateCells(branch.shortName, nameColWidth).padEnd(nameColWidth)
        const timestampPadded = lastTouched.padEnd(8)
        const lineDim = !isSelected && !branch.current
        const cursorAndPad = `${cursor} `
        const trailingName = ` ${namePadded} `
        const trailingDivergence = divergence ? ` ${divergence}` : ''
        // Truncate the assembled line to the actual panel width so a
        // narrow inspector / sidebar focus doesn't push branch rows
        // onto a second visual line (#830).
        const fullText = `${cursorAndPad}${glyph}${trailingName}${timestampPadded}${trailingDivergence}`
        const truncated = truncateCells(fullText, Math.max(20, width - 4))
        // If truncation chopped into the timestamp/divergence portion,
        // fall back to a single Text to keep the visible width honest.
        // The checked-out branch is painted green (matching its green
        // HEAD marker) so "where am I?" reads at a glance. NO_COLOR
        // themes fall back to the `*` glyph alone.
        const currentColor = branch.current && !theme.noColor ? theme.colors.success : undefined
        if (truncated !== fullText) {
          return h(Text, {
            key: `branch-${index}`,
            bold: isSelected,
            dimColor: lineDim,
            color: currentColor,
          }, truncated)
        }
        return h(Text, {
          key: `branch-${index}`,
          bold: isSelected,
          dimColor: lineDim,
        },
        cursorAndPad,
        // The marker carries the sync-state colour; an explicit
        // `dimColor: false` on this span keeps the colour bright even
        // when the surrounding row is dim (other branches in the list
        // dim out under the existing `lineDim` rule). The synced /
        // no-upstream kinds return undefined from
        // `getBranchRowMarkerColor`, so those markers inherit the
        // row's dim and read as quiet chrome.
        h(Text, { color: glyphColor, dimColor: glyphColor ? false : undefined },
          glyph),
        // Name span: green for the current branch (dimColor:false keeps
        // it bright), otherwise it inherits the row's normal styling.
        currentColor
          ? h(Text, { color: currentColor, dimColor: false }, trailingName)
          : trailingName,
        h(Text, { dimColor: true }, timestampPadded),
        trailingDivergence
        )
      })

  // Scroll indicators — same "N more above/below" pattern as the
  // sidebar and help overlay so the user knows the list continues.
  const branchesHasMoreAbove = startIndex > 0 && localBranches.length > 0
  const branchesHasMoreBelow = startIndex + listRows < localBranches.length

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexShrink: 0,
    paddingX: 1,
    width,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Branches', focused)),
    h(Text, { dimColor: true }, headerRight)
  ),
  ...renderPromotedFilterAffordance(h, Text, state, theme),
  ...(branchesHasMoreAbove
    ? [h(Text, { key: 'branches-more-above', dimColor: true }, `  ↑ ${startIndex} more above`)]
    : []),
  ...lines,
  ...(branchesHasMoreBelow
    ? [h(Text, { key: 'branches-more-below', dimColor: true }, `  ↓ ${localBranches.length - (startIndex + listRows)} more below`)]
    : []))
}
