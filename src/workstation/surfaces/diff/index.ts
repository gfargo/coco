/**
 * Diff surface — the unified or side-by-side diff view. Five sources
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
 *   - `'pr'`       → `gh pr diff <n>` patch from the PR-triage drill-in
 *                    (#1363). Read-only like compare, but keeps the
 *                    stash diff's per-file `]` / `[` cursor — a PR
 *                    patch is multi-file and "which file am I in" is
 *                    the core review question.
 *   - default      → worktree-file diff for the active status entry,
 *                    with hunk navigation + per-hunk staging / revert.
 *
 * Side-by-side mode (#785) gates on `MIN_SPLIT_DIFF_WIDTH` (120 cols).
 *
 * Extracted from `src/workstation/runtime/inkRuntime.ts` as part of phase 5a.4
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import { isLogInkContextKeyLoading } from '../../chrome/context'
import { formatStashHeaderIdentity } from '../../chrome/stashHeader'
import {
  formatLogInkLoading,
  formatLogInkPullRequestDiffEmpty,
  formatLogInkPullRequestDiffError,
} from '../../chrome/surfaceStates'
import { cellWidth, truncateCells, truncatePathCells } from '../../chrome/text'
import type {
  GitCommitDetail,
  GitCommitFilePreview,
} from '../../../commands/log/data'
import { hunkIndexAtOffset } from '../../../workstation/runtime/inkViewModel'
import {
  applyStatusFilterMask,
  flattenWorktreeGroups,
  groupWorktreeFiles,
} from '../../../git/statusData'
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
import type { SurfaceRenderContext } from '../../runtime/types'
import {
  focusBorderColor,
  panelTitle,
} from '../../runtime/utils'

/**
 * The diff surface's own data slices (#1136 polish). Grouped into one
 * object so the signature stays `(ctx, diff)` instead of trailing 13
 * positional params — these are the worktree / commit / stash / compare
 * diff bodies the renderer chooses between based on `state`, plus the
 * optional syntax-highlight spans.
 */
export type DiffSurfaceData = {
  worktreeDiff: WorktreeFileDiff | undefined
  worktreeDiffLoading: boolean
  worktreeHunks: WorktreeHunkOverview | undefined
  worktreeHunksLoading: boolean
  filePreview: GitCommitFilePreview | undefined
  filePreviewLoading: boolean
  commitDiffHunkOffsets: number[] | undefined
  selectedDetailFile: GitCommitDetail['files'][number] | undefined
  stashDiffLines: string[] | undefined
  stashDiffLoading: boolean
  compareDiffLines: string[] | undefined
  compareDiffLoading: boolean
  prDiffLines: string[] | undefined
  prDiffLoading: boolean
  prDiffError: string | undefined
  syntaxSpans?: Map<string, SyntaxSpan[]>
}

export function renderDiffSurface(
  ctx: SurfaceRenderContext,
  diff: DiffSurfaceData
): ReactTypes.ReactElement {
  const { h, components, state, context, contextStatus, bodyRows, width, theme } = ctx
  const {
    worktreeDiff,
    worktreeDiffLoading,
    worktreeHunks,
    worktreeHunksLoading,
    filePreview,
    filePreviewLoading,
    commitDiffHunkOffsets,
    selectedDetailFile,
    stashDiffLines,
    stashDiffLoading,
    compareDiffLines,
    compareDiffLoading,
    prDiffLines,
    prDiffLoading,
    prDiffError,
    syntaxSpans,
  } = diff
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const worktree = context.worktree
  // Resolve the subject file through the SAME masked+grouped list the
  // selection index refers to (#1345) — `selectedWorktreeFileIndex` is a
  // cursor into the status surface's grouped/visible ordering, so
  // indexing the raw `worktree.files` here named a different file in
  // the "Loading diff for X…" line (and mis-gated the body) whenever
  // grouping or the 1/2/3 visibility mask reordered the list. Mirrors
  // `buildStatusSurfaceData` (`selectedWorktreeFile`).
  const worktreeFile = flattenWorktreeGroups(
    groupWorktreeFiles(applyStatusFilterMask(worktree?.files || [], state.statusFilterMask))
  )[state.selectedWorktreeFileIndex]
  // Row budget: border(2) + title(1) + the ~3 fixed header lines each
  // branch below renders (hunk/lines summary, stash/compare identity,
  // etc.) = 6 rows of chrome the diff body itself doesn't occupy.
  const visibleRows = Math.max(4, bodyRows - 6)

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
      // Cell-budgeted (#1390): default WIP stash subjects run 60+ chars
      // and wrapped the space-between header row, stealing a body row.
      h(Text, { dimColor: true }, truncateCells(stashIdentity.subtitle, Math.max(10, width - 4 - 20)))
    ),
    ...headerLines.map((line, index) => h(Text, {
      key: `stash-diff-header-${index}`,
      dimColor: index > 0,
    }, truncateCells(line, width - 4))),
    ...stashBodyNodes)
  }

  // PR-triage drill-in branch (#1363). Mirrors the stash diff above —
  // same per-file `diff --git` segmentation so `]` / `[` jump between
  // files and the active file's header carries the selection bar — but
  // read-only: the patch's files live on the PR's head branch, not
  // necessarily in the local worktree, so cherry-pick / open-in-editor
  // have no sensible target here (checkout the PR with `C` instead).
  if (state.diffSource === 'pr') {
    const lines = prDiffLines || []
    const splitActive = isSplitDiffViable(state, width)
    const splitRequestedButTooNarrow = state.diffViewMode === 'split' && !splitActive
    const visibleLines = lines.slice(
      state.diffPreviewOffset,
      state.diffPreviewOffset + visibleRows
    )
    const prFiles = parseStashDiffFiles(lines)
    const fileCount = prFiles.length
    const currentFile = findStashFileForOffset(prFiles, state.diffPreviewOffset)
    const currentFileIndex = currentFile
      ? Math.max(0, prFiles.findIndex((file) => file.startLine === currentFile.startLine))
      : -1
    // Panel subtitle: the triage row the user drilled in from. The
    // number is authoritative (`state.prDiffNumber`); the title is a
    // best-effort lookup against the triage list so a refetch that
    // dropped the PR still renders a usable `#<n>` header.
    const prItem = context.pullRequestList?.pullRequests?.find(
      (pr) => pr.number === state.prDiffNumber
    )
    const prLabel = `#${state.prDiffNumber ?? '?'}${prItem ? ` ${prItem.title}` : ''}`
    const baseHeaderLines: string[] = prDiffLoading
      ? [formatLogInkLoading({ resource: `diff for #${state.prDiffNumber ?? '?'}` })]
      : prDiffError
        ? [formatLogInkPullRequestDiffError({ message: prDiffError })]
        : lines.length
          ? [
            fileCount > 0 && currentFile
              ? `File ${currentFileIndex + 1}/${fileCount}: ${currentFile.path}`
              : 'No files in this diff.',
            `Lines ${Math.min(state.diffPreviewOffset + 1, lines.length)}-${Math.min(state.diffPreviewOffset + visibleLines.length, lines.length)}/${lines.length}`,
            '',
          ]
          : [formatLogInkPullRequestDiffEmpty()]
    const headerLines = splitRequestedButTooNarrow
      ? [...baseHeaderLines.slice(0, -1), 'Terminal too narrow for side-by-side; showing unified.', '']
      : baseHeaderLines

    // File header anchor map — see the stash branch above: O(1) restyle
    // of each `diff --git` row, with the file containing the scroll
    // offset marked active on the selection bar.
    const prFileByStartLine = new Map(prFiles.map((file) => [file.startLine, file]))
    const activeStartLine = currentFile?.startLine
    const prBodyNodes: ReactTypes.ReactNode[] = prDiffLoading || prDiffError || !lines.length
      ? []
      : splitActive
        ? renderSplitDiffBody(
          h, components, lines, state.diffPreviewOffset, visibleRows, width, theme,
          'pr-diff-split', syntaxSpans
        )
        : visibleLines.map((line, index) => {
          const absoluteIndex = state.diffPreviewOffset + index
          const headerFile = prFileByStartLine.get(absoluteIndex)
          if (headerFile) {
            const isActive = absoluteIndex === activeStartLine
            const arrow = theme.ascii ? '> ' : '▾ '
            const activeHeader = isActive && focused && !theme.noColor
            return h(Text, {
              key: `pr-diff-line-${absoluteIndex}`,
              bold: true,
              color: activeHeader
                ? theme.colors.selectionForeground
                : (theme.noColor ? undefined : theme.colors.accent),
              backgroundColor: activeHeader ? theme.colors.selection : undefined,
            }, (() => {
              const pathBudget = (width - 4) - cellWidth(arrow)
              return pathBudget >= 8
                ? `${arrow}${truncatePathCells(headerFile.path, pathBudget)}`
                : truncateCells(`${arrow}${headerFile.path}`, width - 4)
            })())
          }
          return renderDiffLine(
            h, Text, line, theme, syntaxSpans, width - 4,
            `pr-diff-line-${absoluteIndex}`
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
      h(Text, { bold: true }, panelTitle(splitActive ? 'PR diff (split)' : 'PR diff', focused)),
      // Cell-budgeted like the stash subtitle (#1390) so a long PR
      // title can't wrap the space-between header row.
      h(Text, { dimColor: true }, truncateCells(prLabel, Math.max(10, width - 4 - 20)))
    ),
    ...headerLines.map((line, index) => h(Text, {
      key: `pr-diff-header-${index}`,
      dimColor: index > 0,
    }, truncateCells(line, width - 4))),
    ...prBodyNodes)
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
    // #1628 — shares `hunkIndexAtOffset` with the worktree branch below
    // instead of a reversed findIndex: with offset before the first hunk,
    // findIndex returned -1 (clamped to reversed-index 0), so the label
    // computed `hunkCount - 0` and showed "Hunk N/N" instead of "Hunk 1/N".
    const currentHunkIndex = hunkCount > 0
      ? hunkIndexAtOffset(state.diffPreviewOffset, commitDiffHunkOffsets || [])
      : 0
    const currentHunkLabel = hunkCount > 0
      ? `Hunk ${currentHunkIndex + 1}/${hunkCount}`
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
          h, Text, line, theme, syntaxSpans, Math.max(8, width - 5),
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
      // Path middle-elides into the budget (#1390) so a deep monorepo
      // path can't wrap the header row.
      h(Text, { dimColor: true }, truncatePathCells(selectedDetailFile?.path || 'no file', Math.max(10, width - 4 - 14)))
    ),
    ...headerLines.map((line, index) => h(Text, {
      key: `diff-surface-header-${index}`,
      dimColor: index > 0,
    }, truncateCells(line, Math.max(20, width - 4)))),
    ...commitBodyNodes)
  }

  const diffLines = worktreeDiff?.lines || []
  const totalHunks = worktreeHunks?.hunks.length ?? 0
  const stagedHunks = worktreeHunks?.hunks.filter((hunk) => hunk.state === 'staged').length ?? 0
  // The "current" hunk is derived from the scroll position (#1185) —
  // the single source of truth is `worktreeDiffOffset`. ↑/↓ scroll
  // lines and `[`/`]` jump hunks; either way the header, rail, and
  // stage/revert target all follow what's on screen.
  const currentHunkIndex = hunkIndexAtOffset(state.worktreeDiffOffset, worktreeDiff?.hunkOffsets ?? [])
  const visibleDiffLines = diffLines.slice(
    state.worktreeDiffOffset,
    state.worktreeDiffOffset + visibleRows
  )
  // Hunk-position line: `Hunk n/N` + an at-a-glance staging rail + a
  // staged/total count, so the user sees how far through staging they
  // are without reading each hunk. The rail shows one marker per hunk —
  // filled = staged, hollow = unstaged — with the current hunk bracketed
  // (which also conveys whether the current hunk is staged, replacing
  // the old standalone "● staged / ○ unstaged" badge). Untracked/new
  // files have no hunks — point them at whole-file staging instead of a
  // dead-end "no hunks" message.
  const railMarker = (staged: boolean) =>
    staged ? (theme.ascii ? 'x' : '●') : (theme.ascii ? '.' : '○')
  const hunkRail = (worktreeHunks?.hunks ?? [])
    .map((hunk, index) => {
      const marker = railMarker(hunk.state === 'staged')
      return index === currentHunkIndex ? `[${marker}]` : marker
    })
    .join('')
  const hunkHeaderLine = worktreeHunksLoading
    ? 'Hunks loading…'
    : worktreeDiff?.untracked
      ? (theme.ascii ? 'New file — press space to stage it whole.' : '✚ New file — press space to stage it whole.')
      : totalHunks
        ? `Hunk ${currentHunkIndex + 1}/${totalHunks}  ${hunkRail}  ${stagedHunks}/${totalHunks} staged`
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
    // Middle-elided into the budget (#1390) so it can't wrap the header.
    h(Text, { dimColor: true }, truncatePathCells(worktreeDiff?.filePath || worktreeFile?.path || 'no file', Math.max(10, width - 4 - 6)))
  ),
  ...headerLines.map((line, index) => h(Text, {
    key: `diff-surface-header-${index}`,
    dimColor: index > 0,
  }, truncateCells(line, Math.max(20, width - 4)))),
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
      selectedIndex: currentHunkIndex,
      keyPrefix: 'diff-surface-line',
      lineSelect: state.diffLineSelectAnchor !== undefined
        ? {
          start: Math.min(state.diffLineSelectAnchor, state.worktreeDiffOffset),
          end: Math.max(state.diffLineSelectAnchor, state.worktreeDiffOffset),
        }
        : undefined,
    })
    : []))
}
