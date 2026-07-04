/**
 * Blame surface — on-demand `git blame` drill-down for a single file
 * (#0.71 — expanded git ops).
 *
 * Architecturally distinct from the promoted list surfaces: blame is
 * NOT boot-loaded. It's opened from the status view (`b` on a file
 * row), keyed by path, and hydrated lazily into the runtime's
 * `blameByPath` cache. While the cache is cold the surface shows a
 * loading placeholder; once populated it renders each source line as a
 * dimmed `<shorthash> <author>` gutter followed by the line content,
 * windowed around `state.selectedBlameIndex` so even very large files
 * stay responsive (we never render every line).
 *
 * The renderer is read-only: navigation (j/k) lives in `inkInput.ts`,
 * the cursor model + path on `inkViewModel.ts`, and the hydration in
 * `app.ts`.
 */

import type * as ReactTypes from 'react'
import { formatLogInkBlameEmpty, formatLogInkLoading } from '../../chrome/surfaceStates'
import { expandTabs, cellWidth, truncateCells } from '../../chrome/text'
import type { BlameResult } from '../../../git/blameData'
import type { SurfaceRenderContext } from '../../runtime/types'
import { focusBorderColor, panelTitle } from '../../runtime/utils'

/**
 * Cap the rendered short-hash + author gutter so a long author name on
 * one line doesn't shove every line's content off-screen. The gutter is
 * `<8-char-hash> <author>` with the author column capped here.
 */
const AUTHOR_COL_CAP = 18

/**
 * Per-surface data the blame view needs beyond the universal
 * `SurfaceRenderContext`. Mirrors the diff surface's extra-data bundle:
 * the resolved (cache-hit) blame for the active path, plus a loading
 * flag the runtime sets while the debounced hydration is in flight.
 */
export type BlameSurfaceData = {
  /** Cached blame for `state.blamePath`, or undefined on a cache miss. */
  blame: BlameResult | undefined
  /** True while the on-demand hydration for this path is in flight. */
  loading: boolean
}

export function renderBlameSurface(
  ctx: SurfaceRenderContext,
  data: BlameSurfaceData,
): ReactTypes.ReactElement {
  const { h, components, state, bodyRows, width, theme } = ctx
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const path = state.blamePath
  const blame = data.blame
  // Loading covers both the explicit in-flight flag and the cold-cache
  // window before the debounced fetch resolves into `blameByPath`.
  const loading = data.loading || (!blame && Boolean(path))

  const lines = blame && blame.ok ? blame.lines : []
  const failureMessage = blame && !blame.ok ? blame.message : undefined

  // Row budget: border(2) + title(1) + path(1) + both scroll indicators
  // (2, worst case) = 6 rows of chrome the list itself doesn't occupy.
  const listRows = Math.max(4, bodyRows - 6)
  const selected = Math.max(0, Math.min(state.selectedBlameIndex, Math.max(0, lines.length - 1)))
  // Window around the cursor — never render the whole file.
  const windowStart = Math.max(
    0,
    Math.min(
      Math.max(0, lines.length - listRows),
      selected - Math.floor(listRows / 2),
    ),
  )
  const visible = lines.slice(windowStart, windowStart + listRows)

  const headerRight = loading
    ? 'loading blame'
    : lines.length
      ? `${selected + 1}/${lines.length} lines`
      : '0 lines'

  // Line-number gutter width sized to the file's largest line number so
  // the content column aligns; capped via the window so a 100k-line file
  // doesn't reserve an absurd gutter.
  const maxLineNumber = lines.length ? lines[lines.length - 1].lineNumber : 0
  const lineNoWidth = Math.max(3, String(maxLineNumber).length)

  const body: ReactTypes.ReactNode[] = loading
    ? [h(Text, { key: 'blame-loading', dimColor: true }, formatLogInkLoading({ resource: 'blame' }))]
    : lines.length === 0
      ? [h(Text, { key: 'blame-empty', dimColor: true },
          formatLogInkBlameEmpty({ path, failureMessage }))]
      : visible.map((line, offset) => {
        const index = windowStart + offset
        const isSelected = index === selected
        const cursor = isSelected ? '>' : ' '
        const author = truncateCells(line.author, AUTHOR_COL_CAP).padEnd(AUTHOR_COL_CAP)
        const lineNo = String(line.lineNumber).padStart(lineNoWidth)
        // Dimmed blame gutter (`<shorthash> <author>`) + the line's
        // number, then the content. The gutter is rendered as its own
        // dimmed span so the source content reads at full contrast.
        const gutter = `${cursor} ${line.shortHash} ${author} ${lineNo} `
        const contentWidth = Math.max(8, width - 4 - cellWidth(gutter))
        // Tabs expand before truncation (#1393) — Go/Makefile blame
        // rows overran the panel while "measuring" as fitting.
        const content = truncateCells(expandTabs(line.content), contentWidth)
        return h(Text, {
          key: `blame-${index}`,
          bold: isSelected,
        },
        h(Text, { dimColor: true }, gutter),
        content)
      })

  // Scroll affordances — same idiom as the status surface so the user
  // knows there's more file above / below the window.
  const hasMoreAbove = !loading && windowStart > 0 && lines.length > 0
  const hasMoreBelow = !loading && windowStart + listRows < lines.length

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexShrink: 0,
    paddingX: 1,
    width,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Blame', focused)),
    h(Text, { dimColor: true }, headerRight),
  ),
  h(Text, { dimColor: true }, truncateCells(path ? `  ${path}` : '  (no file)', Math.max(10, width - 4))),
  ...(hasMoreAbove
    ? [h(Text, { key: 'blame-more-above', dimColor: true }, `  ↑ ${windowStart} more above`)]
    : []),
  ...body,
  ...(hasMoreBelow
    ? [h(Text, { key: 'blame-more-below', dimColor: true }, `  ↓ ${lines.length - (windowStart + listRows)} more below`)]
    : []))
}
