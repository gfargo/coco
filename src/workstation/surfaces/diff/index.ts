/**
 * Diff surface — the unified or side-by-side diff view. Four sources
 * route through here, disambiguated by `state.diffSource`:
 *
 *   - `'stash'`    → render the patch text from a `git stash show -p`,
 *                    parse out per-file headers so `]` / `[` jumps
 *                    between files and `c` cherry-picks the file at
 *                    the cursor (#776).
 *   - `'compare'`  → `git diff <base>..<head>` from the cross-view
 *                    compare flow (#779). Read-only — comparing two
 *                    arbitrary refs has no sensible mutate-from-here
 *                    flow.
 *   - `'commit'`   → file preview hunks for a commit (history → Enter
 *                    on a commit). Read-only commit-diff exploration.
 *   - default      → worktree-file diff for the active status entry,
 *                    with hunk navigation + per-hunk staging / revert.
 *
 * Side-by-side mode (#785) gates on `MIN_SPLIT_DIFF_WIDTH` (120 cols).
 *
 * Extracted from `src/commands/log/inkRuntime.ts` as part of phase 5a.4
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import type { LogInkContextStatus } from '../../chrome/context'
import { isLogInkContextKeyLoading } from '../../chrome/context'
import { formatStashHeaderIdentity } from '../../chrome/stashHeader'
import { cellWidth, truncateCells, truncatePathCells } from '../../chrome/text'
import type { LogInkTheme } from '../../chrome/theme'
import type {
  GitCommitDetail,
  GitCommitFilePreview,
} from '../../../commands/log/data'
import type { LogInkState } from '../../../commands/log/inkViewModel'
import {
  findStashFileForOffset,
  parseStashDiffFiles,
} from '../../../git/stashData'
import type { WorktreeHunkOverview } from '../../../git/statusHunks'
import type { WorktreeFileDiff } from '../../../git/worktreeDiffData'
import {
  isSplitDiffViable,
  renderSplitDiffBody,
} from '../../runtime/splitDiff'
import { renderDiffLine } from '../../runtime/diffLineRender'
import { renderWorktreeDiffBody } from '../../runtime/worktreeDiffBody'
import type { SyntaxSpan } from '../../../lib/syntax/highlightEngine'
import type { LogInkComponents, LogInkContext } from '../../runtime/types'
import {
  focusBorderColor,
  panelTitle,
} from '../../runtime/utils'

export function renderDiffSurface(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  worktreeDiff: WorktreeFileDiff | undefined,
  worktreeDiffLoading: boolean,
  worktreeHunks: WorktreeHunkOverview | undefined,
  worktreeHunksLoading: boolean,
  filePreview: GitCommitFilePreview | undefined,
  filePreviewLoading: boolean,
  commitDiffHunkOffsets: number[] | undefined,
  selectedDetailFile: GitCommitDetail['files'][number] | undefined,
  stashDiffLines: string[] | undefined,
  stashDiffLoading: boolean,
  compareDiffLines: string[] | undefined,
  compareDiffLoading: boolean,
  bodyRows: number,
  width: number,
  theme: LogInkTheme,
  syntaxSpans?: Map<string, SyntaxSpan[]>
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const worktree = context.worktree
  const worktreeFile = worktree?.files[state.selectedWorktreeFileIndex]
  const visibleRows = Math.max(4, bodyRows - 4)

  // Stash diff branch: when the user opened the diff via Enter on a stash
  // row, render the stash patch text directly. The patch is parsed into
  // per-file sections so `]` / `[` jumps between files and `c`
  // cherry-picks the file at the cursor.
  if (state.diffSource === 'stash') {
    const lines = stashDiffLines || []
    const splitActive = isSplitDiffViable(state, width)
    const splitRequestedButTooNarrow = state.diffViewMode === 'split' && !splitActive
    const visibleLines = lines.slice(
      state.diffPreviewOffset,
      state.diffPreviewOffset + visibleRows
    )
    const stashFiles = parseStashDiffFiles(lines)
    const fileCount = stashFiles.length
    const currentFile = findStashFileForOffset(stashFiles, state.diffPreviewOffset)
    const currentFileIndex = currentFile
      ? Math.max(0, stashFiles.findIndex((file) => file.startLine === currentFile.startLine))
      : -1
    // Look up the active stash entry so the panel header can show a
    // human-identifier instead of the raw `stash@{<iso-date>}` ref.
    // The git ref is the timestamp form (we fetch with --date=iso for
    // stable parsing) which reads as noise in the title bar; the
    // message + branch + index combination is what the user wrote down
    // when they ran `git stash`. Body still shows the full ref so it
    // stays unambiguous.
    const stashIdentity = formatStashHeaderIdentity(state.stashDiffRef, context.stashes?.stashes)
    const baseHeaderLines: string[] = stashDiffLoading
      ? [`Loading diff for ${stashIdentity.subtitle}...`]
      : lines.length
        ? [
          stashIdentity.bodyLine,
          fileCount > 0 && currentFile
            ? `File ${currentFileIndex + 1}/${fileCount}: ${currentFile.path}`
            : 'No files in this stash.',
          `Lines ${Math.min(state.diffPreviewOffset + 1, lines.length)}-${Math.min(state.diffPreviewOffset + visibleLines.length, lines.length)}/${lines.length}`,
          '',
        ]
        : ['No diff to display for this stash.']
    const headerLines = splitRequestedButTooNarrow
      ? [...baseHeaderLines.slice(0, -1), 'Terminal too narrow for side-by-side; showing unified.', '']
      : baseHeaderLines

    // File header anchor map: absolute line index → owning stash file.
    // Lets the body-render pass restyle each `diff --git` row in O(1)
    // and decide which one is the *active* file (the one currently
    // containing `diffPreviewOffset`). The active header gets the
    // selection background to mark "the file the cursor is inside."
    const stashFileByStartLine = new Map(stashFiles.map((file) => [file.startLine, file]))
    const activeStartLine = currentFile?.startLine
    const stashBodyNodes: ReactTypes.ReactNode[] = stashDiffLoading || !lines.length
      ? []
      : splitActive
        ? renderSplitDiffBody(
          h, components, lines, state.diffPreviewOffset, visibleRows, width, theme,
          'stash-diff-split', syntaxSpans
        )
        : visibleLines.map((line, index) => {
          const absoluteIndex = state.diffPreviewOffset + index
          const headerFile = stashFileByStartLine.get(absoluteIndex)
          if (headerFile) {
            // Replace the verbose `diff --git a/<path> b/<path>` text
            // with a compact `▾ <path>` marker — the path itself is
            // the meaningful identifier, not the a/b duplication. The
            // active file's header gets selection styling so the user
            // sees at a glance which file the cursor is inside.
            const isActive = absoluteIndex === activeStartLine
            const arrow = theme.ascii ? '> ' : '▾ '
            const activeHeader = isActive && focused && !theme.noColor
            return h(Text, {
              key: `stash-diff-line-${absoluteIndex}`,
              bold: true,
              // Active header sits on the selection bar with a
              // contrast-guaranteed foreground (matches history/status).
              // The old `inverse` swap turned the accent into the bar and
              // left the path in the selection color — low-contrast on
              // light themes (e.g. accent blue bar + light-gray text).
              color: activeHeader
                ? theme.colors.selectionForeground
                : (theme.noColor ? undefined : theme.colors.accent),
              backgroundColor: activeHeader ? theme.colors.selection : undefined,
            }, (() => {
              // Smart path truncation for the diff file header: keep
              // the leading arrow glyph and elide middle path
              // segments so the filename is never lost. Falls back to
              // plain truncation when there isn't room for a
              // meaningful filename.
              const pathBudget = (width - 4) - cellWidth(arrow)
              return pathBudget >= 8
                ? `${arrow}${truncatePathCells(headerFile.path, pathBudget)}`
                : truncateCells(`${arrow}${headerFile.path}`, width - 4)
            })())
          }
          return renderDiffLine(
            h, Text, line, theme, syntaxSpans, width - 4,
            `stash-diff-line-${absoluteIndex}`
          )
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
      h(Text, { bold: true }, panelTitle(splitActive ? 'Stash diff (split)' : 'Stash diff', focused)),
      h(Text, { dimColor: true }, stashIdentity.subtitle)
    ),
    ...headerLines.map((line, index) => h(Text, {
      key: `stash-diff-header-${index}`,
      dimColor: index > 0,
    }, truncateCells(line, width - 4))),
    ...stashBodyNodes)
  }

  // Compare-two-refs branch (#779). Mirrors the stash diff above but
  // sourced from `git diff <base>..<head>`. No per-file cherry-pick or
  // hunk apply — comparing arbitrary refs doesn't have a sensible
  // mutate-from-here flow, so the surface is read-only navigation.
  if (state.diffSource === 'compare') {
    const lines = compareDiffLines || []
    const splitActive = isSplitDiffViable(state, width)
    const splitRequestedButTooNarrow = state.diffViewMode === 'split' && !splitActive
    const visibleLines = lines.slice(
      state.diffPreviewOffset,
      state.diffPreviewOffset + visibleRows
    )
    const baseLabel = state.compareBase?.label || state.compareBase?.ref || '<base>'
    const headLabel = state.compareHead?.label || state.compareHead?.ref || '<head>'
    const compareTitle = `${baseLabel} → ${headLabel}`
    const baseHeaderLines: string[] = compareDiffLoading
      ? [`Loading diff for ${compareTitle}...`]
      : lines.length && (lines.length > 1 || lines[0])
        ? [
          compareTitle,
          `Lines ${Math.min(state.diffPreviewOffset + 1, lines.length)}-${Math.min(state.diffPreviewOffset + visibleLines.length, lines.length)}/${lines.length}`,
          '',
        ]
        : ['No diff to display — refs may resolve to the same tree.']
    const headerLines = splitRequestedButTooNarrow
      ? [...baseHeaderLines.slice(0, -1), 'Terminal too narrow for side-by-side; showing unified.', '']
      : baseHeaderLines

    const compareBodyNodes: ReactTypes.ReactNode[] = compareDiffLoading || !lines.length || (lines.length === 1 && !lines[0])
      ? []
      : splitActive
        ? renderSplitDiffBody(
          h, components, lines, state.diffPreviewOffset, visibleRows, width, theme,
          'compare-diff-split', syntaxSpans
        )
        : visibleLines.map((line, index) => renderDiffLine(
          h, Text, line, theme, syntaxSpans, width - 4,
          `compare-diff-line-${state.diffPreviewOffset + index}`
        ))

    return h(Box, {
      borderColor: focusBorderColor(theme, focused),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      flexShrink: 0,
      paddingX: 1,
      width,
    },
    h(Box, { justifyContent: 'space-between' },
      h(Text, { bold: true }, panelTitle(splitActive ? 'Compare (split)' : 'Compare', focused)),
      h(Text, { dimColor: true }, truncateCells(compareTitle, Math.max(20, Math.floor(width / 2))))
    ),
    ...headerLines.map((line, index) => h(Text, {
      key: `compare-diff-header-${index}`,
      dimColor: index > 0,
    }, truncateCells(line, width - 4))),
    ...compareBodyNodes)
  }

  // diffSource disambiguates: 'commit' was set when the user opened the
  // diff via history → Enter (read-only commit-diff explore), 'worktree'
  // was set when they came from status → Enter (stage / hunk / revert).
  // Falls back to the previous heuristic when no source is recorded so
  // older entry paths still render something sensible.
  const useCommitDiff = state.diffSource === 'commit' ||
    (state.diffSource === undefined && !worktreeFile && Boolean(selectedDetailFile))

  if (useCommitDiff) {
    const previewHunks = filePreview?.hunks || []
    const splitActive = isSplitDiffViable(state, width)
    const splitRequestedButTooNarrow = state.diffViewMode === 'split' && !splitActive
    const visiblePreviewHunks = previewHunks.slice(
      state.diffPreviewOffset,
      state.diffPreviewOffset + visibleRows
    )
    const hunkCount = commitDiffHunkOffsets?.length || 0
    const currentHunkIndex = hunkCount > 0
      ? Math.max(0, [...(commitDiffHunkOffsets || [])]
          .reverse()
          .findIndex((offset) => offset <= state.diffPreviewOffset))
      : 0
    const currentHunkLabel = hunkCount > 0
      ? `Hunk ${Math.min(hunkCount - currentHunkIndex, hunkCount)}/${hunkCount}`
      : 'No hunks for this file.'

    const baseHeaderLines: string[] = filePreviewLoading
      ? [`Loading diff for ${selectedDetailFile?.path || 'selected file'}...`]
      : previewHunks.length
        ? [
          // File path is already shown in the panel title bar (right) —
          // no redundant "Selected file:" line here.
          currentHunkLabel,
          `Lines ${Math.min(state.diffPreviewOffset + 1, previewHunks.length || 1)}-${Math.min(state.diffPreviewOffset + visiblePreviewHunks.length, previewHunks.length)}/${previewHunks.length}`,
          '',
        ]
        : ['No diff preview available for this file.']
    const headerLines = splitRequestedButTooNarrow
      ? [...baseHeaderLines.slice(0, -1), 'Terminal too narrow for side-by-side; showing unified.', '']
      : baseHeaderLines

    const commitBodyNodes: ReactTypes.ReactNode[] = filePreviewLoading || !previewHunks.length
      ? []
      : splitActive
        ? renderSplitDiffBody(
          h, components, previewHunks, state.diffPreviewOffset, visibleRows, width, theme,
          'commit-diff-split', syntaxSpans
        )
        : visiblePreviewHunks.map((line, index) => renderDiffLine(
          h, Text, line, theme, syntaxSpans, 140,
          `diff-surface-line-${state.diffPreviewOffset + index}`
        ))

    return h(Box, {
      borderColor: focusBorderColor(theme, focused),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      flexShrink: 0,
      paddingX: 1,
      width,
    },
    h(Box, { justifyContent: 'space-between' },
      h(Text, { bold: true }, panelTitle(splitActive ? 'Diff (split)' : 'Diff', focused)),
      h(Text, { dimColor: true }, selectedDetailFile?.path || 'no file')
    ),
    ...headerLines.map((line, index) => h(Text, {
      key: `diff-surface-header-${index}`,
      dimColor: index > 0,
    }, truncateCells(line, 140))),
    ...commitBodyNodes)
  }

  const diffLines = worktreeDiff?.lines || []
  const selectedHunk = worktreeHunks?.hunks[state.selectedWorktreeHunkIndex]
  const totalHunks = worktreeHunks?.hunks.length ?? 0
  const stagedHunks = worktreeHunks?.hunks.filter((hunk) => hunk.state === 'staged').length ?? 0
  const visibleDiffLines = diffLines.slice(
    state.worktreeDiffOffset,
    state.worktreeDiffOffset + visibleRows
  )
  // Hunk-position line: badge + selected hunk's state + a staged/total
  // progress count, so the user always sees how far through staging they
  // are. Untracked/new files have no hunks — point them at whole-file
  // staging instead of a dead-end "no hunks" message.
  const hunkHeaderLine = worktreeHunksLoading
    ? 'Hunks loading…'
    : worktreeDiff?.untracked
      ? (theme.ascii ? 'New file — press space to stage it whole.' : '✚ New file — press space to stage it whole.')
      : totalHunks
        ? `Hunk ${state.selectedWorktreeHunkIndex + 1}/${totalHunks} · ${
          selectedHunk?.state === 'staged'
            ? (theme.ascii ? '[x] staged' : '● staged')
            : (theme.ascii ? '[ ] unstaged' : '○ unstaged')
        } · ${stagedHunks}/${totalHunks} staged`
        : 'No stageable hunks for this file.'
  const headerLines: string[] = isLogInkContextKeyLoading(contextStatus, 'worktree')
    ? ['Loading file context...']
    : worktreeDiffLoading
      ? [`Loading diff for ${worktreeFile?.path || 'selected file'}...`]
      : worktreeFile
      ? [
        // File path is already shown in the panel title bar (right) —
        // no redundant "Selected file:" line here.
        hunkHeaderLine,
        `Lines ${Math.min(state.worktreeDiffOffset + 1, diffLines.length || 1)}-${Math.min(state.worktreeDiffOffset + visibleDiffLines.length, diffLines.length)}/${diffLines.length}`,
        '',
      ]
      : ['No changed file selected.']

  const showDiffLines = Boolean(worktreeFile) &&
    !worktreeDiffLoading &&
    !isLogInkContextKeyLoading(contextStatus, 'worktree')

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexShrink: 0,
    paddingX: 1,
    width,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Diff', focused)),
    // Use the path of the file actually being diffed (the grouped/visible
    // selection feeds the loaded diff) — `worktreeFile` indexes the raw,
    // ungrouped file list and can name a different file than the diff body.
    h(Text, { dimColor: true }, worktreeDiff?.filePath || worktreeFile?.path || 'no file')
  ),
  ...headerLines.map((line, index) => h(Text, {
    key: `diff-surface-header-${index}`,
    dimColor: index > 0,
  }, truncateCells(line, 140))),
  ...(showDiffLines
    ? renderWorktreeDiffBody(h, components, {
      lines: diffLines,
      offset: state.worktreeDiffOffset,
      visibleRows,
      width,
      theme,
      syntaxSpans,
      hunkOffsets: worktreeDiff?.hunkOffsets || [],
      hunks: worktreeHunks?.hunks || [],
      selectedIndex: state.selectedWorktreeHunkIndex,
      keyPrefix: 'diff-surface-line',
    })
    : []))
}
