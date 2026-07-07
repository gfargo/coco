/**
 * File-history surface — on-demand `git log --follow` drill-down for a
 * single file (#COCO-14 — file-history drill-down).
 *
 * Opened from the blame view (`L`) or the status view (`L` on a file row).
 * Shows a scrollable list of commits that touched the file, tracking renames
 * via `--follow`. While the cache is cold the surface shows a loading
 * placeholder; once populated each row renders as:
 *
 *   `> <shorthash>  <author>  <age>  <subject>`
 *
 * The renderer is read-only: navigation (j/k, Enter) lives in `inkInput.ts`,
 * cursor model + path on `inkViewModel.ts`, and hydration in the detail-
 * hydration hook.
 */

import type * as ReactTypes from 'react'
import { formatLogInkLoading } from '../../chrome/surfaceStates'
import { cellWidth, truncateCells } from '../../chrome/text'
import type { FileHistoryResult } from '../../../git/fileHistoryData'
import type { SurfaceRenderContext } from '../../runtime/types'
import { focusBorderColor, panelTitle } from '../../runtime/utils'

/** Cap the author column so long names don't push the subject off-screen. */
const AUTHOR_COL_CAP = 14

/**
 * Compact relative-age string from a Unix epoch timestamp (seconds).
 * Intentionally small — no dependency on a Date instance so the surface
 * can take `now` as a parameter for deterministic tests.
 */
export function formatCommitAge(authorTime: number, nowSeconds: number): string {
  const diffSec = nowSeconds - authorTime
  if (diffSec <= 0) return 'just now'
  const days = Math.floor(diffSec / 86400)
  if (days === 0) return 'today'
  if (days < 14) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 9) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(days / 365)
  return `${years}y ago`
}

export type FileHistorySurfaceData = {
  /** Cached history for `state.fileHistoryPath`, or undefined on a cache miss. */
  history: FileHistoryResult | undefined
  /** True while the on-demand hydration for this path is in flight. */
  loading: boolean
}

export function renderFileHistorySurface(
  ctx: SurfaceRenderContext,
  data: FileHistorySurfaceData,
): ReactTypes.ReactElement {
  const { h, components, state, bodyRows, width, theme } = ctx
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const path = state.fileHistoryPath
  const history = data.history
  const loading = data.loading || (!history && Boolean(path))

  const commits = history && history.ok ? history.commits : []
  const failureMessage = history && !history.ok ? history.message : undefined

  // Row budget: border(2) + title(1) + path(1) + both scroll indicators
  // (2, worst case) = 6 rows of chrome the list itself doesn't occupy.
  const listRows = Math.max(4, bodyRows - 6)
  const selected = Math.max(
    0,
    Math.min(state.selectedFileHistoryIndex, Math.max(0, commits.length - 1)),
  )
  const windowStart = Math.max(
    0,
    Math.min(
      Math.max(0, commits.length - listRows),
      selected - Math.floor(listRows / 2),
    ),
  )
  const visible = commits.slice(windowStart, windowStart + listRows)

  const headerRight = loading
    ? 'Loading history…'
    : commits.length
      ? `${selected + 1}/${commits.length} commits`
      : '0 commits'

  const nowSeconds = Math.floor(Date.now() / 1000)

  const body: ReactTypes.ReactNode[] = loading
    ? [
        h(
          Text,
          { key: 'fh-loading', dimColor: true },
          formatLogInkLoading({ resource: 'file history' }),
        ),
      ]
    : commits.length === 0
      ? [
          h(
            Text,
            { key: 'fh-empty', dimColor: true },
            failureMessage
              ? `  error: ${failureMessage}`
              : path
                ? `  no history found for ${path}`
                : '  (no file selected)',
          ),
        ]
      : visible.map((commit, offset) => {
          const index = windowStart + offset
          const isSelected = index === selected
          const cursor = isSelected ? '>' : ' '
          const author = truncateCells(commit.author, AUTHOR_COL_CAP).padEnd(AUTHOR_COL_CAP)
          const age = formatCommitAge(commit.authorTime, nowSeconds)
          const gutterPart = `${cursor} ${commit.shortHash}  ${author}  ${age}  `
          const subjectWidth = Math.max(8, width - 4 - cellWidth(gutterPart))
          const subject = truncateCells(commit.subject, subjectWidth)
          return h(
            Text,
            { key: `fh-${index}`, bold: isSelected },
            h(Text, { dimColor: true }, gutterPart),
            subject,
          )
        })

  const hasMoreAbove = !loading && windowStart > 0 && commits.length > 0
  const hasMoreBelow = !loading && windowStart + listRows < commits.length

  return h(
    Box,
    {
      borderColor: focusBorderColor(theme, focused),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      flexShrink: 0,
      paddingX: 1,
      width,
    },
    h(
      Box,
      { justifyContent: 'space-between' },
      h(Text, { bold: true }, panelTitle('File History', focused)),
      h(Text, { dimColor: true }, headerRight),
    ),
    h(
      Text,
      { dimColor: true },
      truncateCells(path ? `  ${path}` : '  (no file)', Math.max(10, width - 4)),
    ),
    ...(hasMoreAbove
      ? [h(Text, { key: 'fh-more-above', dimColor: true }, `  ↑ ${windowStart} more above`)]
      : []),
    ...body,
    ...(hasMoreBelow
      ? [
          h(
            Text,
            { key: 'fh-more-below', dimColor: true },
            `  ↓ ${commits.length - (windowStart + listRows)} more below`,
          ),
        ]
      : []),
  )
}
