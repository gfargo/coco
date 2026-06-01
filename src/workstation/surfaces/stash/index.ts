/**
 * Stash surface — promoted view listing `git stash list` entries with
 * filter support. Per-entry actions (apply, pop, drop, file-checkout)
 * are wired in inkInput.ts; this renderer is read-only.
 *
 * Extracted from `src/commands/log/inkRuntime.ts` as part of phase 5a.1
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import type { LogInkContextStatus } from '../../chrome/context'
import { isLogInkContextKeyLoading } from '../../chrome/context'
import { formatLogInkLoading, formatLogInkStashEmpty } from '../../chrome/surfaceStates'
import { truncateCells } from '../../chrome/text'
import type { LogInkTheme } from '../../chrome/theme'
import type { LogInkState } from '../../../commands/log/inkViewModel'
import {
    matchesPromotedFilter,
    renderPromotedFilterAffordance,
} from '../../runtime/promotedFilter'
import type { LogInkComponents, LogInkContext } from '../../runtime/types'
import { focusBorderColor, panelTitle } from '../../runtime/utils'

export function renderStashSurface(
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
  const loading = isLogInkContextKeyLoading(contextStatus, 'stashes')
  const allStashes = context.stashes?.stashes || []
  const stashes = state.filter
    ? allStashes.filter((stash) =>
      matchesPromotedFilter([stash.ref, stash.message], state.filter)
    )
    : allStashes
  const selected = Math.max(0, Math.min(state.selectedStashIndex, Math.max(0, stashes.length - 1)))
  const listRows = Math.max(4, bodyRows - 4)
  const startIndex = Math.max(0, selected - Math.floor(listRows / 2))
  const visible = stashes.slice(startIndex, startIndex + listRows)
  const filterLabel = state.filter ? ` | filter: ${state.filter}` : ''
  const headerRight = loading
    ? 'loading stashes'
    : `${stashes.length}/${allStashes.length} stashes${filterLabel}`
  const emptyLabel = formatLogInkStashEmpty({ filter: state.filter })
  const loadingLabel = formatLogInkLoading({ resource: 'stashes' })
  const lines: ReactTypes.ReactNode[] = loading
    ? [h(Text, { key: 'stash-loading', dimColor: true }, loadingLabel)]
    : stashes.length === 0
      ? [h(Text, { key: 'stash-empty', dimColor: true }, emptyLabel)]
      : visible.map((stash, offset) => {
        const index = startIndex + offset
        const isSelected = index === selected
        const cursor = isSelected ? '>' : ' '
        return h(Text, {
          key: `stash-${index}`,
          bold: isSelected,
          dimColor: !isSelected,
        }, truncateCells(`${cursor} ${stash.ref.padEnd(12)} ${stash.message}`, 140))
      })

  const stashHasMoreAbove = startIndex > 0 && stashes.length > 0
  const stashHasMoreBelow = startIndex + listRows < stashes.length

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexShrink: 0,
    paddingX: 1,
    width,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Stash', focused)),
    h(Text, { dimColor: true }, headerRight)
  ),
  ...renderPromotedFilterAffordance(h, Text, state, theme),
  ...(stashHasMoreAbove
    ? [h(Text, { key: 'stash-more-above', dimColor: true }, `  ↑ ${startIndex} more above`)]
    : []),
  ...lines,
  ...(stashHasMoreBelow
    ? [h(Text, { key: 'stash-more-below', dimColor: true }, `  ↓ ${stashes.length - (startIndex + listRows)} more below`)]
    : []))
}
