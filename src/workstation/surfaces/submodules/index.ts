/**
 * Submodules surface — promoted view listing every registered
 * submodule in the repo with status / pinned commit / tracking
 * branch / remote at a glance (#932). Mirrors the
 * branches / tags / stash surfaces.
 *
 * The richer per-submodule metadata block (the same one the inspector
 * side-panel renders when the cursored file is a submodule) is
 * rendered by `detail/index.ts`; this surface owns the list view +
 * cursor + filter only.
 */

import type * as ReactTypes from 'react'
import { isLogInkContextKeyLoading } from '../../chrome/context'
import { clampListWindowStart } from '../../chrome/layout'
import {
  formatLogInkLoading,
  formatLogInkSubmodulesEmpty,
} from '../../chrome/surfaceStates'
import { cellWidth, truncateCells } from '../../chrome/text'
import type { LogInkTheme } from '../../chrome/theme'
import type { SubmoduleEntry } from '../../../git/submoduleData'
import {
  matchesPromotedFilter,
  renderPromotedFilterAffordance,
} from '../../runtime/promotedFilter'
import type { SurfaceRenderContext } from '../../runtime/types'
import { focusBorderColor, panelTitle } from '../../runtime/utils'

const FLAG_LABEL: Record<SubmoduleEntry['flag'], string> = {
  clean: 'clean',
  modified: 'modified',
  uninitialized: 'uninit',
  conflicted: 'conflict',
}

function flagColor(flag: SubmoduleEntry['flag'], theme: LogInkTheme): string | undefined {
  if (theme.noColor) return undefined
  if (flag === 'modified') return theme.colors.warning
  if (flag === 'uninitialized') return theme.colors.muted
  if (flag === 'conflicted') return theme.colors.danger
  return undefined
}

export function renderSubmodulesSurface(ctx: SurfaceRenderContext): ReactTypes.ReactElement {
  const { h, components, state, context, contextStatus, bodyRows, width, theme } = ctx
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const loading = isLogInkContextKeyLoading(contextStatus, 'submodules')
  const all = context.submodules?.entries || []
  const filtered = state.filter
    ? all.filter((entry) =>
      matchesPromotedFilter([entry.name, entry.path, entry.trackingBranch || '', entry.url || ''], state.filter)
    )
    : all
  const selected = Math.max(0, Math.min(state.selectedSubmoduleIndex, Math.max(0, filtered.length - 1)))
  // Row budget (#1392, #1615): the base reserve (borders + title + one
  // spare) must also count the conditional rows, or the panel grows past
  // its box mid-scroll — the filter affordance while filtering, and BOTH
  // scroll indicators once the list overflows the window (the single
  // spare absorbed only one of them). Mirrors the branches surface.
  const baseRows = Math.max(4, bodyRows - 4 - (state.filterMode ? 1 : 0))
  const listRows = filtered.length > baseRows ? Math.max(4, baseRows - 1) : baseRows
  const startIndex = clampListWindowStart(selected, filtered.length, listRows)
  const visible = filtered.slice(startIndex, startIndex + listRows)
  const filterLabel = state.filter ? ` | filter: ${state.filter}` : ''
  const headerRight = loading
    ? 'Loading submodules…'
    : `${filtered.length}/${all.length} submodules${filterLabel}`
  const emptyLabel = formatLogInkSubmodulesEmpty({ filter: state.filter })
  const loadingLabel = formatLogInkLoading({ resource: 'submodules' })

  // Per-window column widths so short names don't leave a wide gutter
  // and long names don't push the trailing columns off-screen. Cap
  // matches the branches/tags surfaces for visual consistency.
  const nameColWidth = visible.length === 0
    ? 20
    : Math.min(28, Math.max(8, ...visible.map((entry) => cellWidth(entry.name))))
  const pathColWidth = visible.length === 0
    ? 24
    : Math.min(36, Math.max(8, ...visible.map((entry) => cellWidth(entry.path))))

  const lines: ReactTypes.ReactNode[] = loading
    ? [h(Text, { key: 'submodules-loading', dimColor: true }, loadingLabel)]
    : filtered.length === 0
      ? [h(Text, { key: 'submodules-empty', dimColor: true }, emptyLabel)]
      : visible.map((entry, offset) => {
        const index = startIndex + offset
        const isSelected = index === selected
        const cursor = isSelected ? '>' : ' '
        const sha = entry.pinnedSha ? entry.pinnedSha.slice(0, 8) : '--------'
        const namePadded = truncateCells(entry.name, nameColWidth).padEnd(nameColWidth)
        const pathPadded = truncateCells(entry.path, pathColWidth).padEnd(pathColWidth)
        const flagText = FLAG_LABEL[entry.flag]
        const branch = entry.trackingBranch ? ` · ${entry.trackingBranch}` : ''
        const lineText = truncateCells(
          `${cursor} ${namePadded} ${pathPadded} ${sha} ${flagText}${branch}`,
          Math.max(20, width - 4),
        )
        const color = flagColor(entry.flag, theme)
        return h(Text, {
          key: `submodule-${index}`,
          bold: isSelected,
          dimColor: !isSelected && entry.flag === 'clean',
          color,
        }, lineText)
      })

  // Scroll indicators (#1615) — same "N more above/below" pattern as
  // branches/tags so the user knows the list continues past the window.
  const submodulesHasMoreAbove = startIndex > 0 && filtered.length > 0
  const submodulesHasMoreBelow = startIndex + listRows < filtered.length

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexShrink: 0,
    paddingX: 1,
    width,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Submodules', focused)),
    h(Text, { dimColor: true }, headerRight),
  ),
  ...renderPromotedFilterAffordance(h, Text, state, theme),
  ...(submodulesHasMoreAbove
    ? [h(Text, { key: 'submodules-more-above', dimColor: true }, `  ↑ ${startIndex} more above`)]
    : []),
  ...lines,
  ...(submodulesHasMoreBelow
    ? [h(Text, { key: 'submodules-more-below', dimColor: true }, `  ↓ ${filtered.length - (startIndex + listRows)} more below`)]
    : []))
}
