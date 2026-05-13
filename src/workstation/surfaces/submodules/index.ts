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
import type { LogInkContextStatus } from '../../chrome/context'
import { isLogInkContextKeyLoading } from '../../chrome/context'
import {
  formatLogInkLoading,
  formatLogInkSubmodulesEmpty,
} from '../../chrome/surfaceStates'
import { cellWidth, truncateCells } from '../../chrome/text'
import type { LogInkTheme } from '../../chrome/theme'
import type { LogInkState } from '../../../commands/log/inkViewModel'
import type { SubmoduleEntry } from '../../../git/submoduleData'
import {
  matchesPromotedFilter,
  renderPromotedFilterAffordance,
} from '../../runtime/promotedFilter'
import type { LogInkComponents, LogInkContext } from '../../runtime/types'
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

export function renderSubmodulesSurface(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  bodyRows: number,
  width: number,
  theme: LogInkTheme,
): ReactTypes.ReactElement {
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
  const listRows = Math.max(4, bodyRows - 4)
  const startIndex = Math.max(0, selected - Math.floor(listRows / 2))
  const visible = filtered.slice(startIndex, startIndex + listRows)
  const filterLabel = state.filter ? ` | filter: ${state.filter}` : ''
  const headerRight = loading
    ? 'loading submodules'
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
  ...lines)
}
