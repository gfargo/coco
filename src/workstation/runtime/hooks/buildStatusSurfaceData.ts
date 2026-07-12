/**
 * Status-surface derived data (#776 / #791 / #808, extracted in the 0.72
 * app.ts decomposition).
 *
 * The status surface renders the worktree file list narrowed by the live
 * `statusFilterMask`, grouped/flattened into canonical staged → unstaged
 * → untracked order, plus the per-file segmentation of the active stash
 * diff. These derivations used to live as a cluster of inline `useMemo`s
 * in `app.ts`; they have been lifted out of the component into this pure
 * core plus a thin hook so `app.ts` stops carrying the status-surface
 * derivation logic.
 *
 * Every derivation here is reproduced verbatim from the original memos —
 * same helper calls (`applyStatusFilterMask`, `groupWorktreeFiles`,
 * `flattenWorktreeGroups`, `parseStashDiffFiles`), same arguments. This
 * is a behavior-preserving move, not a rewrite.
 */

import type * as ReactTypes from 'react'
import {
  applyStatusFilterMask,
  flattenWorktreeGroups,
  groupWorktreeFiles,
  type WorktreeFile,
  type WorktreeFileGroup,
  type WorktreeFileVisibilityMask,
} from '../../../git/statusData'
import { parseStashDiffFiles, type StashDiffFile } from '../../../git/stashData'

export type StatusSurfaceData = {
  visibleWorktreeFiles: WorktreeFile[]
  visibleWorktreeGroups: WorktreeFileGroup[]
  visibleWorktreeFilesGrouped: WorktreeFile[]
  selectedWorktreeFile: WorktreeFile | undefined
  stashDiffParsedFiles: StashDiffFile[]
}

/**
 * Pure derivation of the status surface's derived data from the loaded
 * worktree files, the active visibility mask, the canonical selected
 * file index, and the active stash diff lines.
 *
 * - `visibleWorktreeFiles` is the single source of truth for
 *   staged/unstaged/untracked filtering — `applyStatusFilterMask` on the
 *   raw `context.worktree?.files`.
 * - `visibleWorktreeGroups` / `visibleWorktreeFilesGrouped` are the
 *   sectioned and re-flattened (canonical-order) views the renderer and
 *   the three-tier cursor model both key off.
 * - `selectedWorktreeFile` resolves by `selectedWorktreeFileIndex` into
 *   the flattened list (an out-of-range index yields `undefined`).
 * - `stashDiffParsedFiles` is the per-file segmentation of the active
 *   stash patch (empty when no stash diff is loaded).
 *
 * The helper calls and predicates are lifted verbatim from the original
 * `app.ts` memos.
 */
export function buildStatusSurfaceData(
  worktreeFiles: WorktreeFile[] | undefined,
  statusFilterMask: WorktreeFileVisibilityMask,
  selectedWorktreeFileIndex: number,
  stashDiffLines: string[] | undefined,
): StatusSurfaceData {
  const visibleWorktreeFiles = applyStatusFilterMask(worktreeFiles || [], statusFilterMask)
  const visibleWorktreeGroups = groupWorktreeFiles(visibleWorktreeFiles)
  const visibleWorktreeFilesGrouped = flattenWorktreeGroups(visibleWorktreeGroups)
  const selectedWorktreeFile =
    visibleWorktreeFilesGrouped[
      Math.min(selectedWorktreeFileIndex, Math.max(0, visibleWorktreeFilesGrouped.length - 1))
    ]
  const stashDiffParsedFiles = stashDiffLines ? parseStashDiffFiles(stashDiffLines) : []

  return {
    visibleWorktreeFiles,
    visibleWorktreeGroups,
    visibleWorktreeFilesGrouped,
    selectedWorktreeFile,
    stashDiffParsedFiles,
  }
}

/**
 * Thin hook wrapper. Issues one `React.useMemo` per derived value —
 * preserving the exact hook call-order and per-value dependency arrays of
 * the original `app.ts` memos, so React's hook ordering and
 * reference-identity semantics are unchanged.
 *
 * `selectedWorktreeFile` keeps a dedicated memo with the same dep array
 * the original code used (`visibleWorktreeFilesGrouped` +
 * `selectedWorktreeFileIndex`): it feeds the worktree-diff and
 * worktree-hunks effects elsewhere in `app.ts` via its `.path` /
 * `.indexStatus` / `.worktreeStatus`, so an unchanged selection must
 * yield a stable reference rather than fold into a larger memo that would
 * churn on unrelated input changes.
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */
export function useStatusSurfaceData(
  React: typeof ReactTypes,
  worktreeFiles: WorktreeFile[] | undefined,
  statusFilterMask: WorktreeFileVisibilityMask,
  selectedWorktreeFileIndex: number,
  stashDiffLines: string[] | undefined,
): StatusSurfaceData {
  const visibleWorktreeFiles = React.useMemo(
    () => applyStatusFilterMask(worktreeFiles || [], statusFilterMask),
    [worktreeFiles, statusFilterMask]
  )
  const visibleWorktreeGroups = React.useMemo(
    () => groupWorktreeFiles(visibleWorktreeFiles),
    [visibleWorktreeFiles]
  )
  const visibleWorktreeFilesGrouped = React.useMemo(
    () => flattenWorktreeGroups(visibleWorktreeGroups),
    [visibleWorktreeGroups]
  )
  const selectedWorktreeFile = React.useMemo(
    () =>
      visibleWorktreeFilesGrouped[
        Math.min(selectedWorktreeFileIndex, Math.max(0, visibleWorktreeFilesGrouped.length - 1))
      ],
    [visibleWorktreeFilesGrouped, selectedWorktreeFileIndex]
  )
  const stashDiffParsedFiles = React.useMemo(
    () => stashDiffLines ? parseStashDiffFiles(stashDiffLines) : [],
    [stashDiffLines]
  )

  return {
    visibleWorktreeFiles,
    visibleWorktreeGroups,
    visibleWorktreeFilesGrouped,
    selectedWorktreeFile,
    stashDiffParsedFiles,
  }
}
