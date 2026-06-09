/**
 * Stash surface — promoted view listing `git stash list` entries with
 * filter support. Per-entry actions (apply, pop, drop, file-checkout)
 * are wired in inkInput.ts; this renderer is read-only.
 *
 * Extracted from `src/workstation/runtime/inkRuntime.ts` as part of phase 5a.1
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import { isLogInkContextKeyLoading } from '../../chrome/context'
import { formatCompactRelativeDate } from '../../chrome/dateFormat'
import { getRenderNow } from '../../chrome/snapshotMode'
import { inlineSpinnerGlyph } from '../../chrome/spinner'
import { formatLogInkLoading, formatLogInkStashEmpty } from '../../chrome/surfaceStates'
import { cellWidth, truncateCells } from '../../chrome/text'
import {
    matchesPromotedFilter,
    renderPromotedFilterAffordance,
} from '../../runtime/promotedFilter'
import type { SurfaceRenderContext } from '../../runtime/types'
import { focusBorderColor, panelTitle } from '../../runtime/utils'
import { isPendingItemAction } from '../../../workstation/runtime/inkViewModel'

const GAP = 2 // cells between columns

/** Truncate to `w` cells, then pad to `w` (left = padEnd, right = padStart). */
function cell(value: string, w: number, align: 'left' | 'right' = 'left'): string {
  const t = truncateCells(value, w)
  // padStart/padEnd count code units; refs / ages / counts / branch
  // names are ASCII in practice, matching the branches surface's
  // padEnd-based column alignment.
  return align === 'right' ? t.padStart(w) : t.padEnd(w)
}

export function renderStashSurface(ctx: SurfaceRenderContext, spinnerFrame: number = 0): ReactTypes.ReactElement {
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
  // One extra row reserved (vs the other surfaces' `- 4`) for the column
  // header row below.
  const listRows = Math.max(4, bodyRows - 5)
  const startIndex = Math.max(0, selected - Math.floor(listRows / 2))
  const visible = stashes.slice(startIndex, startIndex + listRows)
  const filterLabel = state.filter ? ` | filter: ${state.filter}` : ''
  const headerRight = loading
    ? 'loading stashes'
    : `${stashes.length}/${allStashes.length} stashes${filterLabel}`
  const emptyLabel = formatLogInkStashEmpty({ filter: state.filter })
  const loadingLabel = formatLogInkLoading({ resource: 'stashes' })
  const now = getRenderNow()
  // Usable interior width: panel width minus the border (2) and the
  // paddingX:1 (2). The previous `width - 2` under-counted the border
  // and made every near-full row overflow by 2 cells and wrap — the
  // single biggest readability hit in the old list.
  const contentWidth = Math.max(20, width - 4)

  const ageOf = (s: typeof visible[number]) => formatCompactRelativeDate(s.date, now)

  // Column widths derived from the visible window (#833 pattern) so rows
  // align without re-measuring the whole list. Each column is at least
  // as wide as its header label so the header never truncates ("age",
  // "branch", "files"); age tops out at 5 ("today" is the longest value
  // formatCompactRelativeDate emits).
  const refCol = visible.length
    ? Math.min(11, Math.max(3, ...visible.map((s) => cellWidth(s.ref))))
    : 9
  const ageCol = visible.length
    ? Math.min(5, Math.max(3, ...visible.map((s) => cellWidth(ageOf(s)))))
    : 3
  const branchColMax = visible.length
    ? Math.max(0, ...visible.map((s) => cellWidth(s.branch || '')))
    : 0
  const filesCol = visible.length
    ? Math.max(5, ...visible.map((s) => String(s.files.length).length))
    : 5

  // Responsive degradation. Keep ref + message always; when the message
  // floor is threatened, shed columns the preview pane already shows —
  // branch first, then age, then the file count — before squeezing the
  // message.
  // Widen to fit the "branch" header when any stash carries a branch;
  // stays 0 (column dropped) when none do.
  let branchCol = branchColMax > 0 ? Math.min(18, Math.max(6, branchColMax)) : 0
  let showAge = true
  let showFiles = true
  const fixedWidth = () =>
    2 + refCol +
    (showAge ? GAP + ageCol : 0) +
    (branchCol > 0 ? GAP + branchCol : 0) +
    (showFiles ? GAP + filesCol : 0) +
    GAP // gap before the message column
  let messageWidth = contentWidth - fixedWidth()
  if (messageWidth < 24 && branchCol > 0) { branchCol = 0; messageWidth = contentWidth - fixedWidth() }
  if (messageWidth < 16 && showAge) { showAge = false; messageWidth = contentWidth - fixedWidth() }
  if (messageWidth < 12 && showFiles) { showFiles = false; messageWidth = contentWidth - fixedWidth() }
  messageWidth = Math.max(8, messageWidth)

  // Column header. Right-aligned labels over the right-aligned numeric
  // columns (age, files) so header and data share an edge.
  let headerText = `  ${cell('ref', refCol)}`
  if (showAge) headerText += `${' '.repeat(GAP)}${cell('age', ageCol, 'right')}`
  if (branchCol > 0) headerText += `${' '.repeat(GAP)}${cell('branch', branchCol)}`
  if (showFiles) headerText += `${' '.repeat(GAP)}${cell('files', filesCol, 'right')}`
  headerText += `${' '.repeat(GAP)}message`

  const lines: ReactTypes.ReactNode[] = loading
    ? [h(Text, { key: 'stash-loading', dimColor: true }, loadingLabel)]
    : stashes.length === 0
      ? [h(Text, { key: 'stash-empty', dimColor: true }, emptyLabel)]
      : visible.map((stash, offset) => {
        const index = startIndex + offset
        const isSelected = index === selected
        const cursor = isSelected ? '>' : ' '
        const deleting = isPendingItemAction(state.pendingItemAction, 'stash', stash.ref)
        // The `stash@{N}` ref is an identifier, not a status icon, so a
        // delete-in-flight appends an accent spinner at the row's end
        // (2 cells reserved from the message budget).
        const spinnerSpan = deleting
          ? h(Text, { color: theme.noColor ? undefined : theme.colors.accent, dimColor: false },
            ` ${inlineSpinnerGlyph(spinnerFrame, theme.ascii)}`)
          : null
        const message = truncateCells(stash.message, messageWidth - (deleting ? 2 : 0))
        // ref + message read as primary; age / branch / file-count are
        // dim metadata (kept dim even on the bold selected row so the
        // message stays the focal point).
        return h(Text, {
          key: `stash-${index}`,
          bold: isSelected,
          dimColor: !isSelected,
        },
        `${cursor} `,
        cell(stash.ref, refCol),
        showAge ? h(Text, { dimColor: true }, `${' '.repeat(GAP)}${cell(ageOf(stash), ageCol, 'right')}`) : null,
        branchCol > 0 ? h(Text, { dimColor: true }, `${' '.repeat(GAP)}${cell(stash.branch || '', branchCol)}`) : null,
        showFiles ? h(Text, { dimColor: true }, `${' '.repeat(GAP)}${cell(String(stash.files.length), filesCol, 'right')}`) : null,
        `${' '.repeat(GAP)}${message}`,
        spinnerSpan,
        )
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
  // Column header — only when there are rows to label.
  ...(!loading && stashes.length > 0
    ? [h(Text, { key: 'stash-col-header', dimColor: true }, truncateCells(headerText, contentWidth))]
    : []),
  ...(stashHasMoreAbove
    ? [h(Text, { key: 'stash-more-above', dimColor: true }, `  ↑ ${startIndex} more above`)]
    : []),
  ...lines,
  ...(stashHasMoreBelow
    ? [h(Text, { key: 'stash-more-below', dimColor: true }, `  ↓ ${stashes.length - (startIndex + listRows)} more below`)]
    : []))
}
