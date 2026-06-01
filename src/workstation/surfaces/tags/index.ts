/**
 * Tags surface — promoted view listing tags with sort and filter,
 * OSC-8 hyperlinks per name when a remote is detected. Per-entry
 * actions (delete, push, create-from-commit) are wired in inkInput.ts;
 * this renderer is read-only.
 *
 * Extracted from `src/commands/log/inkRuntime.ts` as part of phase 5a.2
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import type { LogInkContextStatus } from '../../chrome/context'
import { isLogInkContextKeyLoading } from '../../chrome/context'
import { formatHyperlink } from '../../chrome/hyperlinks'
import { formatSortIndicator, sortTags } from '../../chrome/sorting'
import {
    formatLogInkLoading,
    formatLogInkTagsEmpty,
} from '../../chrome/surfaceStates'
import { truncateCells } from '../../chrome/text'
import type { LogInkTheme } from '../../chrome/theme'
import type { LogInkState } from '../../../commands/log/inkViewModel'
import {
    matchesPromotedFilter,
    renderPromotedFilterAffordance,
} from '../../runtime/promotedFilter'
import type { LogInkComponents, LogInkContext } from '../../runtime/types'
import { buildRefUrl, focusBorderColor, panelTitle } from '../../runtime/utils'

export function renderTagsSurface(
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
  const loading = isLogInkContextKeyLoading(contextStatus, 'tags')
  const sortedAll = sortTags(context.tags?.tags || [], state.tagSort)
  const tags = state.filter
    ? sortedAll.filter((tag) => matchesPromotedFilter([tag.name, tag.subject], state.filter))
    : sortedAll
  const selected = Math.max(0, Math.min(state.selectedTagIndex, Math.max(0, tags.length - 1)))
  const listRows = Math.max(4, bodyRows - 4)
  const startIndex = Math.max(0, selected - Math.floor(listRows / 2))
  const visible = tags.slice(startIndex, startIndex + listRows)
  const filterLabel = state.filter ? ` | filter: ${state.filter}` : ''
  const sortLabel = ` | ${formatSortIndicator(state.tagSort, { ascii: theme.ascii })}`
  const headerRight = loading
    ? 'loading tags'
    : `${tags.length}/${sortedAll.length} tags${filterLabel}${sortLabel}`
  const emptyLabel = formatLogInkTagsEmpty({ filter: state.filter })
  const loadingLabel = formatLogInkLoading({ resource: 'tags' })
  // Per-window name column width (#833) so short tags don't leave a
  // wide gutter and long tags don't push the subject off-screen. Cap
  // matches the branches surface for visual consistency across the
  // promoted views.
  const tagNameColWidth = visible.length === 0
    ? 20
    : Math.min(40, Math.max(8, ...visible.map((tag) => tag.name.length)))
  const lines: ReactTypes.ReactNode[] = loading
    ? [h(Text, { key: 'tags-loading', dimColor: true }, loadingLabel)]
    : tags.length === 0
      ? [h(Text, { key: 'tags-empty', dimColor: true }, emptyLabel)]
      : visible.map((tag, offset) => {
        const index = startIndex + offset
        const isSelected = index === selected
        const cursor = isSelected ? '>' : ' '
        // P5.1 — link the tag name to its GitHub tree page when we know
        // the remote. Truncation runs on the visible (pre-OSC) text;
        // formatHyperlink wraps just the tag name, leaving width math
        // intact.
        const url = buildRefUrl(context.provider?.repository, tag.name)
        const namePadded = truncateCells(tag.name, tagNameColWidth).padEnd(tagNameColWidth)
        const lineText = truncateCells(
          `${cursor} ${namePadded} ${tag.subject}`,
          Math.max(20, width - 4)
        )
        if (!url || lineText.indexOf(namePadded) < 0) {
          return h(Text, {
            key: `tag-${index}`,
            bold: isSelected,
            dimColor: !isSelected,
          }, lineText)
        }
        const linkStart = lineText.indexOf(namePadded)
        const before = lineText.slice(0, linkStart)
        const after = lineText.slice(linkStart + namePadded.length)
        return h(Text, {
          key: `tag-${index}`,
          bold: isSelected,
          dimColor: !isSelected,
        }, before, formatHyperlink(namePadded, url), after)
      })

  const tagsHasMoreAbove = startIndex > 0 && tags.length > 0
  const tagsHasMoreBelow = startIndex + listRows < tags.length

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexShrink: 0,
    paddingX: 1,
    width,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Tags', focused)),
    h(Text, { dimColor: true }, headerRight)
  ),
  ...renderPromotedFilterAffordance(h, Text, state, theme),
  ...(tagsHasMoreAbove
    ? [h(Text, { key: 'tags-more-above', dimColor: true }, `  ↑ ${startIndex} more above`)]
    : []),
  ...lines,
  ...(tagsHasMoreBelow
    ? [h(Text, { key: 'tags-more-below', dimColor: true }, `  ↓ ${tags.length - (startIndex + listRows)} more below`)]
    : []))
}
