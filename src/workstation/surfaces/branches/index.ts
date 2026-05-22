/**
 * Branches surface — promoted view listing local branches with sort,
 * filter, divergence, and last-touched columns. Per-entry actions
 * (checkout, push, fetch, rename, delete, …) are wired in inkInput.ts;
 * this renderer is read-only.
 *
 * Extracted from `src/commands/log/inkRuntime.ts` as part of phase 5a.2
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import type { LogInkContextStatus } from '../../chrome/context'
import { isLogInkContextKeyLoading } from '../../chrome/context'
import {
  branchRowMarker,
  formatBranchDivergence,
  formatBranchLastTouched,
  getBranchRowMarkerColor,
} from '../../chrome/iconography'
import { formatSortIndicator, sortBranches } from '../../chrome/sorting'
import {
  formatLogInkBranchesEmpty,
  formatLogInkLoading,
} from '../../chrome/surfaceStates'
import { truncateCells } from '../../chrome/text'
import type { LogInkTheme } from '../../chrome/theme'
import type { LogInkState } from '../../../commands/log/inkViewModel'
import {
  matchesPromotedFilter,
  renderPromotedFilterAffordance,
} from '../../runtime/promotedFilter'
import type { LogInkComponents, LogInkContext } from '../../runtime/types'
import { focusBorderColor, panelTitle } from '../../runtime/utils'

export function renderBranchesSurface(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  bodyRows: number,
  width: number,
  theme: LogInkTheme
): ReactTypes.ReactElement {
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
  const listRows = Math.max(4, bodyRows - 4)
  const startIndex = Math.max(0, selected - Math.floor(listRows / 2))
  const visible = localBranches.slice(startIndex, startIndex + listRows)
  const filterLabel = state.filter ? ` | filter: ${state.filter}` : ''
  const sortLabel = ` | ${formatSortIndicator(state.branchSort, { ascii: theme.ascii })}`
  const headerRight = loading
    ? 'loading branches'
    : `${localBranches.length}/${sortedAll.length} local | current: ${branches?.currentBranch || '<detached>'}${filterLabel}${sortLabel}`
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
        const markerColor = getBranchRowMarkerColor(marker.kind, theme)
        const divergence = formatBranchDivergence(branch, { ascii: theme.ascii })
        const lastTouched = formatBranchLastTouched(branch.date, new Date())
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
        const fullText = `${cursorAndPad}${marker.glyph}${trailingName}${timestampPadded}${trailingDivergence}`
        const truncated = truncateCells(fullText, Math.max(20, width - 4))
        // If truncation chopped into the timestamp/divergence portion,
        // fall back to a single Text to keep the visible width honest.
        if (truncated !== fullText) {
          return h(Text, {
            key: `branch-${index}`,
            bold: isSelected,
            dimColor: lineDim,
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
        h(Text, { color: markerColor, dimColor: markerColor ? false : undefined },
          marker.glyph),
        trailingName,
        h(Text, { dimColor: true }, timestampPadded),
        trailingDivergence
        )
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
    h(Text, { bold: true }, panelTitle('Branches', focused)),
    h(Text, { dimColor: true }, headerRight)
  ),
  ...renderPromotedFilterAffordance(h, Text, state, theme),
  ...lines)
}
