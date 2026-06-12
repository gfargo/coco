/**
 * Remotes surface — promoted view listing every configured git remote
 * with its fetch / push URLs at a glance (#0.71 — expanded git ops).
 * Mirrors the submodules / branches / tags surfaces: this surface owns
 * the list view + cursor + filter only; the per-row actions (add /
 * remove / set-url / prune) live in the input + workflow layers.
 */

import type * as ReactTypes from 'react'
import { isLogInkContextKeyLoading } from '../../chrome/context'
import {
  formatLogInkLoading,
  formatLogInkRemotesEmpty,
} from '../../chrome/surfaceStates'
import { cellWidth, truncateCells } from '../../chrome/text'
import type { RemoteEntry } from '../../../git/remoteData'
import {
  matchesPromotedFilter,
  renderPromotedFilterAffordance,
} from '../../runtime/promotedFilter'
import type { SurfaceRenderContext } from '../../runtime/types'
import { focusBorderColor, panelTitle } from '../../runtime/utils'

export function renderRemotesSurface(ctx: SurfaceRenderContext): ReactTypes.ReactElement {
  const { h, components, state, context, contextStatus, bodyRows, width, theme } = ctx
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const loading = isLogInkContextKeyLoading(contextStatus, 'remotes')
  const all = context.remotes?.entries || []
  const filtered = state.filter
    ? all.filter((entry) =>
      matchesPromotedFilter([entry.name, entry.fetchUrl, entry.pushUrl], state.filter)
    )
    : all
  const selected = Math.max(0, Math.min(state.selectedRemoteIndex, Math.max(0, filtered.length - 1)))
  const listRows = Math.max(4, bodyRows - 4)
  const startIndex = Math.max(0, selected - Math.floor(listRows / 2))
  const visible = filtered.slice(startIndex, startIndex + listRows)
  const filterLabel = state.filter ? ` | filter: ${state.filter}` : ''
  const headerRight = loading
    ? 'loading remotes'
    : `${filtered.length}/${all.length} remotes${filterLabel}`
  const emptyLabel = formatLogInkRemotesEmpty({ filter: state.filter })
  const loadingLabel = formatLogInkLoading({ resource: 'remotes' })

  // Per-window name column so short remote names ('origin') don't leave
  // a wide gutter and long ones don't shove the URL off-screen. Cap
  // matches the other promoted surfaces for visual consistency.
  const nameColWidth = visible.length === 0
    ? 12
    : Math.min(20, Math.max(6, ...visible.map((entry) => cellWidth(entry.name))))

  const lines: ReactTypes.ReactNode[] = loading
    ? [h(Text, { key: 'remotes-loading', dimColor: true }, loadingLabel)]
    : filtered.length === 0
      ? [h(Text, { key: 'remotes-empty', dimColor: true }, emptyLabel)]
      : visible.map((entry, offset) => {
        const index = startIndex + offset
        const isSelected = index === selected
        const cursor = isSelected ? '>' : ' '
        const namePadded = truncateCells(entry.name, nameColWidth).padEnd(nameColWidth)
        // Show the fetch URL inline; surface a distinct push URL with a
        // `↑` marker only when it diverges (the common case is a single
        // shared URL, where a second column would just be noise).
        const pushDiffers = entry.pushUrl && entry.pushUrl !== entry.fetchUrl
        const urlText = pushDiffers
          ? `${entry.fetchUrl} ↑ ${entry.pushUrl}`
          : entry.fetchUrl || '(no url)'
        const lineText = truncateCells(
          `${cursor} ${namePadded} ${urlText}`,
          Math.max(20, width - 4),
        )
        return h(Text, {
          key: `remote-${index}`,
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
    h(Text, { bold: true }, panelTitle('Remotes', focused)),
    h(Text, { dimColor: true }, headerRight),
  ),
  ...renderPromotedFilterAffordance(h, Text, state, theme),
  ...lines)
}

export type { RemoteEntry }
