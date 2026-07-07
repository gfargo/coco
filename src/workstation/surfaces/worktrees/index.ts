/**
 * Worktrees surface — promoted view listing linked worktrees with
 * filter support, branch column, and dirty-state indicator. Per-entry
 * actions (cd, remove, remove-and-delete-branch) are wired in
 * inkInput.ts; this renderer is read-only.
 *
 * Extracted from `src/workstation/runtime/inkRuntime.ts` as part of phase 5a.1
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import { isLogInkContextKeyLoading } from '../../chrome/context'
import { clampListWindowStart } from '../../chrome/layout'
import { inlineSpinnerGlyph } from '../../chrome/spinner'
import { formatLogInkLoading } from '../../chrome/surfaceStates'
import { truncateCells } from '../../chrome/text'
import {
  matchesPromotedFilter,
  renderPromotedFilterAffordance,
} from '../../runtime/promotedFilter'
import type { SurfaceRenderContext } from '../../runtime/types'
import { focusBorderColor, panelTitle } from '../../runtime/utils'
import { isPendingItemAction } from '../../../workstation/runtime/inkViewModel'

export function renderWorktreesSurface(ctx: SurfaceRenderContext, spinnerFrame: number = 0): ReactTypes.ReactElement {
  const { h, components, state, context, contextStatus, bodyRows, width, theme } = ctx
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
  const startIndex = clampListWindowStart(selected, worktrees.length, listRows)
  const visible = worktrees.slice(startIndex, startIndex + listRows)
  const filterLabel = state.filter ? ` | filter: ${state.filter}` : ''
  const headerRight = loading
    ? 'Loading worktrees…'
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
        const cursor = isSelected ? '>' : ' '
        const marker = isPendingItemAction(state.pendingItemAction, 'worktree', entry.path)
          ? inlineSpinnerGlyph(spinnerFrame, theme.ascii)
          : entry.current ? '*' : ' '
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
