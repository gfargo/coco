/**
 * Worktrees surface — promoted view listing linked worktrees with
 * filter support, branch column, and dirty-state indicator. Per-entry
 * actions (cd, remove, remove-and-delete-branch) are wired in
 * inkInput.ts; this renderer is read-only.
 *
 * Extracted from `src/commands/log/inkRuntime.ts` as part of phase 5a.1
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import type { LogInkContextStatus } from '../../chrome/context'
import { isLogInkContextKeyLoading } from '../../chrome/context'
import { formatLogInkLoading } from '../../chrome/surfaceStates'
import { truncateCells } from '../../chrome/text'
import type { LogInkTheme } from '../../chrome/theme'
import type { LogInkState } from '../../../commands/log/inkViewModel'
import {
  matchesPromotedFilter,
  renderPromotedFilterAffordance,
} from '../../runtime/promotedFilter'
import type { LogInkComponents, LogInkContext } from '../../runtime/types'
import { focusBorderColor, panelTitle } from '../../runtime/utils'

export function renderWorktreesSurface(
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
  const loading = isLogInkContextKeyLoading(contextStatus, 'worktreeList')
  const allWorktrees = context.worktreeList?.worktrees || []
  const worktrees = state.filter
    ? allWorktrees.filter((entry) =>
      matchesPromotedFilter([entry.path, entry.branch || '', entry.head || ''], state.filter)
    )
    : allWorktrees
  const selected = Math.max(0, Math.min(state.selectedWorktreeListIndex, Math.max(0, worktrees.length - 1)))
  const listRows = Math.max(4, bodyRows - 4)
  const startIndex = Math.max(0, selected - Math.floor(listRows / 2))
  const visible = worktrees.slice(startIndex, startIndex + listRows)
  const filterLabel = state.filter ? ` | filter: ${state.filter}` : ''
  const headerRight = loading
    ? 'loading worktrees'
    : `${worktrees.length}/${allWorktrees.length} worktrees${filterLabel}`
  // Per-window branch column width (#833). Worktrees often track
  // branches with names varying widely in length (`main` vs.
  // `feat/tui-something-long`); fixed-width padding either left a
  // huge gutter on short rows or pushed the path column off-screen on
  // long ones. Cap matches the other promoted surfaces.
  const branchColWidth = visible.length === 0
    ? 28
    : Math.min(40, Math.max(8, ...visible.map((entry) => {
      const label = entry.branch ? entry.branch : entry.head || '<detached>'
      return label.length
    })))
  const lines: ReactTypes.ReactNode[] = loading
    ? [h(Text, { key: 'worktrees-loading', dimColor: true }, formatLogInkLoading({ resource: 'worktrees' }))]
    : worktrees.length === 0
      ? [h(Text, { key: 'worktrees-empty', dimColor: true }, 'No linked worktrees.')]
      : visible.map((entry, offset) => {
        const index = startIndex + offset
        const isSelected = index === selected
        const cursor = isSelected ? (theme.ascii ? '>' : '❯') : ' '
        const marker = entry.current ? '*' : ' '
        const branchLabel = entry.branch ? entry.branch : entry.head || '<detached>'
        const stateLabel = entry.dirty ? 'dirty' : 'clean'
        const branchPadded = truncateCells(branchLabel, branchColWidth).padEnd(branchColWidth)
        return h(Text, {
          key: `worktree-${index}`,
          bold: isSelected,
          dimColor: !isSelected && !entry.current,
        }, truncateCells(
          `${cursor} ${marker} ${branchPadded} ${stateLabel.padEnd(6)} ${entry.path}`,
          width - 4
        ))
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
    h(Text, { bold: true }, panelTitle('Worktrees', focused)),
    h(Text, { dimColor: true }, headerRight)
  ),
  ...renderPromotedFilterAffordance(h, Text, state, theme),
  ...lines)
}
