/**
 * Hunk-aware renderer for the worktree (staging) diff.
 *
 * Unlike the read-only commit/stash diff, the worktree diff is a
 * *staging surface*: the user moves between hunks and stages/unstages
 * them. To make that tactile we render three cues the plain diff lacks:
 *
 *   - a left **accent bar** down the currently-selected hunk, so you can
 *     see exactly what `space` will act on;
 *   - a per-hunk **badge** on each `@@` header — `●` (staged, green) /
 *     `○` (unstaged, dim) — so the staged/unstaged split is visible at a
 *     glance instead of buried in a header counter;
 *   - **dimming** of already-staged hunks, so they read as "done" and
 *     your eye lands on what's left.
 *
 * The mapping line→hunk uses `hunkOffsets` (the `@@` line indices in the
 * diff) which line up 1:1 with `hunks` (staged hunks first, then
 * unstaged — the same order `getWorktreeHunks` builds).
 */
import type * as ReactTypes from 'react'
import { expandTabs, truncateCells } from '../chrome/text'
import type { LogInkTheme } from '../chrome/theme'
import type { WorktreeHunk } from '../../git/statusHunks'
import type { SyntaxSpan } from '../../lib/syntax/highlightEngine'
import type { LogInkComponents } from './types'
import { renderDiffLine } from './diffLineRender'

export type WorktreeDiffBodyParams = {
  lines: string[]
  offset: number
  visibleRows: number
  width: number
  theme: LogInkTheme
  syntaxSpans: Map<string, SyntaxSpan[]> | undefined
  hunkOffsets: number[]
  hunks: WorktreeHunk[]
  selectedIndex: number
  keyPrefix: string
  /**
   * Absolute line range of the active visual selection (#1358), when the
   * user is line-staging. Selected rows get a solid accent bar so what
   * `space` will stage is unambiguous.
   */
  lineSelect?: { start: number; end: number }
}

/** The hunk index owning `absLine`, or -1 for pre-hunk header/label rows. */
function hunkIndexForLine(absLine: number, hunkOffsets: number[]): number {
  let index = -1
  for (let k = 0; k < hunkOffsets.length; k++) {
    if (hunkOffsets[k] <= absLine) index = k
    else break
  }
  return index
}

export function renderWorktreeDiffBody(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  params: WorktreeDiffBodyParams
): ReactTypes.ReactElement[] {
  const { Box, Text } = components
  const { lines, offset, visibleRows, width, theme, syntaxSpans, hunkOffsets, hunks, selectedIndex, keyPrefix, lineSelect } = params
  const headerSet = new Set(hunkOffsets)
  const accent = theme.noColor ? undefined : theme.colors.accent
  const added = theme.noColor ? undefined : theme.colors.gitAdded
  const codeWidth = Math.max(8, width - 5) // 2 chrome + 1 gutter + slack

  const visible = lines.slice(offset, offset + visibleRows)
  return visible.map((line, i) => {
    const abs = offset + i
    const key = `${keyPrefix}-${abs}`
    const hunkIndex = hunkIndexForLine(abs, hunkOffsets)
    const hunk = hunkIndex >= 0 ? hunks[hunkIndex] : undefined
    const isSelected = hunkIndex >= 0 && hunkIndex === selectedIndex
    const isStaged = hunk?.state === 'staged'
    const isLineSelected = lineSelect !== undefined && abs >= lineSelect.start && abs <= lineSelect.end
    const bar = isLineSelected ? '▌' : isSelected ? '▎' : ' '

    // `@@` header row — badge + (dim) hunk position, emphasized when selected.
    if (headerSet.has(abs)) {
      const badge = theme.ascii ? (isStaged ? '[x] ' : '[ ] ') : (isStaged ? '● ' : '○ ')
      const badgeColor = theme.noColor ? undefined : isStaged ? added : theme.colors.muted
      return h(Box, { key, flexDirection: 'row' },
        h(Text, { color: accent }, bar),
        h(Text, { color: badgeColor, bold: isSelected }, badge),
        h(Text, { bold: isSelected, color: isSelected ? accent : (theme.noColor ? undefined : theme.colors.muted) },
          truncateCells(expandTabs(line), codeWidth))
      )
    }

    // Body / context / pre-hunk lines.
    // A staged hunk that ISN'T selected renders dim ("done", out of
    // focus); the selected hunk and unstaged hunks keep full diff +
    // syntax coloring via renderDiffLine so the focus stays vivid.
    const content = isStaged && !isSelected && hunkIndex >= 0
      ? h(Text, { key: `${key}-c`, dimColor: true }, truncateCells(expandTabs(line), codeWidth))
      : renderDiffLine(h, Text, line, theme, syntaxSpans, codeWidth, `${key}-c`)

    return h(Box, { key, flexDirection: 'row' },
      h(Text, { color: accent }, bar),
      content
    )
  })
}
