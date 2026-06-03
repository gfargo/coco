/**
 * Stash surface — promoted view listing `git stash list` entries with
 * filter support. Per-entry actions (apply, pop, drop, file-checkout)
 * are wired in inkInput.ts; this renderer is read-only.
 *
 * Extracted from `src/commands/log/inkRuntime.ts` as part of phase 5a.1
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import { isLogInkContextKeyLoading } from '../../chrome/context'
import { formatCompactRelativeDate } from '../../chrome/dateFormat'
import { getRenderNow } from '../../chrome/snapshotMode'
import { formatLogInkLoading, formatLogInkStashEmpty } from '../../chrome/surfaceStates'
import { truncateCells } from '../../chrome/text'
import {
    matchesPromotedFilter,
    renderPromotedFilterAffordance,
} from '../../runtime/promotedFilter'
import type { SurfaceRenderContext } from '../../runtime/types'
import { focusBorderColor, panelTitle } from '../../runtime/utils'

export function renderStashSurface(ctx: SurfaceRenderContext): ReactTypes.ReactElement {
  const { h, components, state, context, contextStatus, bodyRows, width, theme } = ctx
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
  const now = getRenderNow()
  // Available width for a row: box width minus the 2-cell horizontal
  // padding. Truncate to it (with a small floor) instead of a magic 140
  // so the richer meta degrades gracefully on narrow terminals.
  const rowWidth = Math.max(20, width - 2)
  const lines: ReactTypes.ReactNode[] = loading
    ? [h(Text, { key: 'stash-loading', dimColor: true }, loadingLabel)]
    : stashes.length === 0
      ? [h(Text, { key: 'stash-empty', dimColor: true }, emptyLabel)]
      : visible.map((stash, offset) => {
        const index = startIndex + offset
        const isSelected = index === selected
        const cursor = isSelected ? '>' : ' '
        // Surface the metadata the StashEntry already carries — origin
        // branch, file count, and relative age — between the ref and the
        // message, so the list answers "which stash is this?" without an
        // Enter→diff round trip.
        const age = formatCompactRelativeDate(stash.date, now)
        const fileCount = stash.files.length
        const meta = [
          stash.branch ? `on ${stash.branch}` : '',
          fileCount > 0 ? `${fileCount} file${fileCount === 1 ? '' : 's'}` : '',
          age,
        ].filter(Boolean).join(' · ')
        const rowText = meta
          ? `${cursor} ${stash.ref.padEnd(11)} ${meta}  ${stash.message}`
          : `${cursor} ${stash.ref.padEnd(11)} ${stash.message}`
        return h(Text, {
          key: `stash-${index}`,
          bold: isSelected,
          dimColor: !isSelected,
        }, truncateCells(rowText, rowWidth))
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
