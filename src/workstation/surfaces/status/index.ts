/**
 * Status surface — `git status` rendered as grouped, mask-filterable
 * rows. Supports both header and per-file cursors so users can act on
 * a whole group ("stage all unstaged") or a single file. The mask
 * (#776) lets users narrow visibility to a subset of staged /
 * unstaged / untracked.
 *
 * Per-row actions (stage, unstage, revert, hunk-stage) are wired in
 * inkInput.ts; this renderer is read-only.
 *
 * Extracted from `src/commands/log/inkRuntime.ts` as part of phase 5a.3
 * of #890. The local helpers (`buildStatusSurfaceRows`,
 * `capitalizeGroupName`, `formatStatusFilterMask`,
 * `isStatusFilterMaskActive`) and the `StatusSurfaceRow` type lived in
 * inkRuntime.ts only to support this surface; they migrate together.
 */

import type * as ReactTypes from 'react'
import type { LogInkContextStatus } from '../../chrome/context'
import { isLogInkContextKeyLoading } from '../../chrome/context'
import { STAGE_STATUS_DOT, getStageStatusDotColor } from '../../chrome/iconography'
import {
    formatLogInkLoading,
    formatLogInkStatusEmpty,
} from '../../chrome/surfaceStates'
import { cellWidth, truncateCells } from '../../chrome/text'
import type { LogInkTheme } from '../../chrome/theme'
import { isPathLfsTracked } from '../../../git/lfsAttributes'
import type { WorktreeFile, WorktreeFileGroup } from '../../../git/statusData'
import { applyStatusFilterMask, groupWorktreeFiles } from '../../../git/statusData'
import type {
    LogInkState,
    LogInkStatusFilterMask,
} from '../../../commands/log/inkViewModel'
import type { LogInkComponents, LogInkContext } from '../../runtime/types'
import { focusBorderColor, panelTitle } from '../../runtime/utils'

// Each rendered row is either a group header (e.g. "▾ Unstaged (3)") or a
// file under that group; both are first-class cursor targets.
type StatusSurfaceRow =
  | { kind: 'header'; group: WorktreeFileGroup }
  | { kind: 'file'; group: WorktreeFileGroup; file: WorktreeFile; flatIndex: number }

function buildStatusSurfaceRows(groups: WorktreeFileGroup[]): StatusSurfaceRow[] {
  const rows: StatusSurfaceRow[] = []
  for (const group of groups) {
    rows.push({ kind: 'header', group })
    group.files.forEach((file, offset) => {
      rows.push({ kind: 'file', group, file, flatIndex: group.startIndex + offset })
    })
  }
  return rows
}

function capitalizeGroupName(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function isStatusFilterMaskActive(mask: LogInkStatusFilterMask): boolean {
  return !mask.staged || !mask.unstaged || !mask.untracked
}

function formatStatusFilterMask(mask: LogInkStatusFilterMask): string {
  const active: string[] = []
  if (mask.staged) active.push('staged')
  if (mask.unstaged) active.push('unstaged')
  if (mask.untracked) active.push('untracked')
  return active.join(' + ') || 'none'
}

export function renderStatusSurface(
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
  const worktree = context.worktree
  // Apply the status visibility mask (#776) at render time so the
  // rendered rows match the filtered count the input context already
  // uses for j/k navigation. `visibleFiles` may be a strict subset of
  // worktree.files when the user has narrowed via 1/2/3.
  const visibleFiles = applyStatusFilterMask(worktree?.files || [], state.statusFilterMask)
  // Group + canonical-sort. The runtime + input handler agree on this
  // order so a `selectedWorktreeFileIndex` of N always points to the
  // same file across all three (renderer / input / workflow handlers).
  const visibleGroups = groupWorktreeFiles(visibleFiles)
  const surfaceRows = buildStatusSurfaceRows(visibleGroups)
  const listRows = Math.max(4, bodyRows - 5)
  const selectedIndex = state.selectedWorktreeFileIndex
  const headerFocused = state.statusGroupHeaderFocused
  // Resolve the cursor's row index in the flat (header-and-file) row
  // list. Used to window the visible slice around the cursor.
  const cursorRowIndex = (() => {
    if (!surfaceRows.length) return 0
    const currentGroup = visibleGroups.find((group) =>
      selectedIndex >= group.startIndex && selectedIndex < group.startIndex + group.files.length
    )
    if (!currentGroup) return 0
    if (headerFocused) {
      const idx = surfaceRows.findIndex((row) => row.kind === 'header' && row.group === currentGroup)
      return idx >= 0 ? idx : 0
    }
    const idx = surfaceRows.findIndex((row) => row.kind === 'file' && row.flatIndex === selectedIndex)
    return idx >= 0 ? idx : 0
  })()
  const cleanHint = formatLogInkStatusEmpty({ hasChanges: Boolean(worktree?.files.length) })
  const windowStart = Math.max(
    0,
    Math.min(
      Math.max(0, surfaceRows.length - listRows),
      cursorRowIndex - Math.floor(listRows / 2)
    )
  )
  const isLoading = isLogInkContextKeyLoading(contextStatus, 'worktree')
  const renderedRows: ReactTypes.ReactNode[] = isLoading || !surfaceRows.length
    ? []
    : surfaceRows.slice(windowStart, windowStart + listRows).map((row, offset) => {
      const rowIndex = windowStart + offset
      if (row.kind === 'header') {
        const groupContainsCursor =
          selectedIndex >= row.group.startIndex &&
          selectedIndex < row.group.startIndex + row.group.files.length
        const headerSelected = focused && headerFocused && groupContainsCursor
        const arrow = theme.ascii ? '>' : '▾'
        const groupLabel = capitalizeGroupName(row.group.state)
        const text = `  ${arrow} ${groupLabel} (${row.group.files.length})`
        return h(Text, {
          key: `status-group-${row.group.state}-${rowIndex}`,
          bold: true,
          dimColor: !headerSelected && rowIndex > cursorRowIndex,
          backgroundColor: headerSelected && !theme.noColor ? theme.colors.selection : undefined,
          inverse: headerSelected,
        }, truncateCells(text, 140))
      }
      const isSelected = !headerFocused && row.flatIndex === selectedIndex
      const cursorPart = `${isSelected ? '>' : ' '} `
      const dotColor = getStageStatusDotColor(row.file.state, theme)
      const useDot = dotColor !== undefined
      const dotCells = useDot ? cellWidth(STAGE_STATUS_DOT) + 1 : 0
      // #884 — append an "LFS" badge on rows tracked by a
      // `.gitattributes` filter=lfs pattern, so the user can tell
      // the on-disk file is a pointer (not the real binary) even
      // when the row has no diff. Detection lives in the context
      // slice we lazily-loaded on boot; missing context → no badge.
      const lfsBadge = context.lfs && isPathLfsTracked(context.lfs, row.file.path) ? ' LFS' : ''
      const tail = `${row.file.indexStatus}${row.file.worktreeStatus} ${row.file.path}${lfsBadge}`
      const tailTrunc = truncateCells(tail, Math.max(0, 140 - cellWidth(cursorPart) - dotCells - 2))
      return h(Text, {
        key: `status-file-${row.flatIndex}-${rowIndex}`,
        dimColor: !isSelected && rowIndex > cursorRowIndex,
        backgroundColor: isSelected && focused && !theme.noColor ? theme.colors.selection : undefined,
        inverse: isSelected && focused,
      },
      `  ${cursorPart}`,
      // Suppress dot color on selected rows — inverse makes colored
      // text unreadable against the light background.
      ...(useDot ? [h(Text, { color: (isSelected && focused) ? undefined : dotColor }, STAGE_STATUS_DOT), ' '] : []),
      tailTrunc)
    })
  // When the mask narrows the list to nothing but the underlying repo
  // is non-clean, surface why the panel looks empty so the user can
  // un-narrow rather than wonder if the repo is actually clean.
  const maskHidesAll =
    Boolean(worktree?.files.length) && visibleFiles.length === 0
  const fallbackLines = isLoading
    ? [formatLogInkLoading({ resource: 'worktree status' })]
    : visibleFiles.length
      ? []
      : maskHidesAll
        ? [`No files match the active filter (${formatStatusFilterMask(state.statusFilterMask)}). Press 1/2/3 to widen.`]
        : cleanHint
          ? [cleanHint]
          : ['Worktree clean']

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexShrink: 0,
    paddingX: 1,
    width,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Worktree', focused)),
    h(Text, { dimColor: true }, worktree
      ? `${worktree.stagedCount} staged | ${worktree.unstagedCount} unstaged | ${worktree.untrackedCount} untracked`
      : 'status loading')
  ),
  // Mask indicator (#776). Only rendered when the mask is narrower
  // than the all-on default — keeps the chrome clean for users who
  // never touch the filter.
  ...(isStatusFilterMaskActive(state.statusFilterMask)
    ? [h(Text, { key: 'status-mask-indicator', dimColor: true },
        `filter: ${formatStatusFilterMask(state.statusFilterMask)}  (1/2/3 to toggle)`)]
    : []),
  ...renderedRows,
  ...fallbackLines.map((line, index) => h(Text, {
    key: `status-surface-fallback-${index}`,
    dimColor: index > 0,
  }, truncateCells(line, 140))))
}
