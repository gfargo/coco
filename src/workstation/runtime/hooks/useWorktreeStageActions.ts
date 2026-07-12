/**
 * Worktree staging / revert action handlers (extracted in the 0.72 app.ts
 * decomposition — the FIRST extraction of action *callbacks*, after the
 * effect/hydration clusters of PRs 1–10).
 *
 * This module lifts the cluster of four contiguous `React.useCallback`
 * async handlers out of `app.ts`, in original declaration order:
 *
 *   1. `toggleSelectedFileStage` — stage/unstage the cursored worktree file
 *      via `stageFile` / `unstageFile(git, …)`, then refresh + clear the
 *      cached diff/hunks.
 *   2. `toggleSelectedHunkStage` — stage/unstage the hunk under the diff
 *      viewport (resolved from `state.worktreeDiffOffset` via the
 *      already-pure `hunkIndexAtOffset`) using `stageHunk` / `unstageHunk`.
 *   3. `revertSelectedFile` — `revertFile(git, …)` the cursored file.
 *   4. `revertSelectedHunk` — `revertHunk(git, …)` the hunk under the
 *      viewport.
 *
 * Each handler is reproduced **verbatim** — the guard conditions, the
 * dispatch payloads, the await sequencing, the `setWorktreeDiff(undefined)` /
 * `setWorktreeHunks(undefined)` cache resets, and the `useCallback`
 * dependency arrays are byte-for-byte the same as the original `app.ts`
 * callbacks. This is a behavior-preserving move, not a rewrite; the four are
 * deliberately NOT consolidated despite their similar shape.
 *
 * Hook ordering / identity. The four callbacks are contiguous in `app.ts`
 * and are invoked ONLY from the input handler's keystroke dispatch — they
 * are NOT referenced in any `useEffect` / `useMemo` dependency array, so
 * there is no identity-stability hazard from co-locating them. A single
 * hook called at their original slot reproduces both the hook-call order
 * and the four `useCallback` identities exactly.
 *
 * The hunk resolver shared by the two hunk handlers,
 *   `worktreeHunks?.hunks[hunkIndexAtOffset(offset, worktreeDiff?.hunkOffsets ?? [])]`,
 * is a one-line index over `hunkIndexAtOffset`, which is already a pure
 * function with its own unit tests (`inkViewModel.test.ts`). There is no
 * clean new seam to extract, and pulling it into a helper would alter the
 * verbatim handler bodies — so the resolver stays inline.
 *
 * The dedicated `worktreeDiff` / `worktreeHunks` `useState` slots and their
 * setters stay in `app.ts` (they are owned by the diff-hydration loaders and
 * also read by the render and the syntax-highlight effect); this hook
 * receives the values and the setters. `selectedWorktreeFile` comes from
 * `useStatusSurfaceData`, `worktreeDiff` / `worktreeHunks` from
 * `useDiffHydration`, and `refreshWorktreeContext` is a `useCallback` in
 * `app.ts` — all threaded in.
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'
import type { SimpleGit } from 'simple-git'
import { hunkIndexAtOffset } from '../inkViewModel'
import type { LogInkAction } from '../inkViewModel'
import {
  applyStatusFilterMask,
  flattenWorktreeGroups,
  groupWorktreeFiles,
  optimisticToggleWorktreeOverview,
  type WorktreeFile,
  type WorktreeFileVisibilityMask,
  type WorktreeOverview,
} from '../../../git/statusData'
import { revertFile, stageFile, unstageFile } from '../../../git/statusActions'
import {
  WorktreeHunkOverview,
  revertHunk,
  revertHunkLines,
  stageHunk,
  stageHunkLines,
  unstageHunk,
} from '../../../git/statusHunks'
import type { WorktreeFileDiff } from '../../../git/worktreeDiffData'

export type UseWorktreeStageActionsDeps = {
  /** The active frame's `git`. */
  git: SimpleGit
  /** Reducer dispatch — drives status messages. */
  dispatch: (action: LogInkAction) => void
  /** The cursored worktree file (from `useStatusSurfaceData`). */
  selectedWorktreeFile: WorktreeFile | undefined
  /** The loaded worktree file diff (from `useDiffHydration`). */
  worktreeDiff: WorktreeFileDiff | undefined
  /** The parsed worktree hunks (from `useDiffHydration`). */
  worktreeHunks: WorktreeHunkOverview | undefined
  /** `state.worktreeDiffOffset` — the diff viewport scroll offset. */
  worktreeDiffOffset: number
  /** `state.diffLineSelectAnchor` — the visual line-select anchor (#1358). */
  diffLineSelectAnchor: number | undefined
  /** Re-fetch the worktree context after a stage/revert mutation. */
  refreshWorktreeContext: (options?: { silent?: boolean }) => Promise<unknown>
  /**
   * Apply an in-place update to the loaded worktree overview (#1353) —
   * the optimistic stage/unstage flip so `space` repaints on the
   * keystroke instead of after git + a full refresh. The refresh that
   * follows reconciles with git's truth.
   */
  mutateWorktreeOverview: (
    updater: (overview: WorktreeOverview | undefined) => WorktreeOverview | undefined
  ) => void
  /** The grouped/visible status list the cursor indexes into (#1353). */
  visibleWorktreeFilesGrouped: WorktreeFile[]
  /** `state.selectedWorktreeFileIndex` — cursor into the grouped list. */
  selectedWorktreeFileIndex: number
  /** `state.statusFilterMask` — the 1/2/3 visibility mask. */
  statusFilterMask: WorktreeFileVisibilityMask
  /** Clears the cached worktree file diff so it re-hydrates. */
  setWorktreeDiff: ReactTypes.Dispatch<
    ReactTypes.SetStateAction<WorktreeFileDiff | undefined>
  >
  /** Clears the cached worktree hunks so they re-hydrate. */
  setWorktreeHunks: ReactTypes.Dispatch<
    ReactTypes.SetStateAction<WorktreeHunkOverview | undefined>
  >
}

export type UseWorktreeStageActionsResult = {
  toggleSelectedFileStage: () => Promise<void>
  toggleSelectedHunkStage: () => Promise<void>
  revertSelectedFile: () => Promise<void>
  revertSelectedHunk: () => Promise<void>
  stageSelectedLines: () => Promise<void>
  revertSelectedLines: () => Promise<void>
}

export function useWorktreeStageActions(
  React: typeof ReactTypes,
  deps: UseWorktreeStageActionsDeps,
): UseWorktreeStageActionsResult {
  const {
    git,
    dispatch,
    selectedWorktreeFile,
    worktreeDiff,
    worktreeHunks,
    worktreeDiffOffset,
    diffLineSelectAnchor,
    refreshWorktreeContext,
    mutateWorktreeOverview,
    visibleWorktreeFilesGrouped,
    selectedWorktreeFileIndex,
    statusFilterMask,
    setWorktreeDiff,
    setWorktreeHunks,
  } = deps

  const toggleSelectedFileStage = React.useCallback(async () => {
    if (!selectedWorktreeFile) {
      dispatch({ type: 'setStatus', value: 'no worktree file selected', kind: 'warning' })
      return
    }

    const wasStaged = selectedWorktreeFile.state === 'staged'
    // #1353 part 2 — optimistic flip: move the file to its new group in
    // local context on the keystroke, so `space` never feels dead on a
    // big repo. The awaited refresh below reconciles with git's truth
    // (including when the git call fails).
    mutateWorktreeOverview((overview) =>
      overview ? optimisticToggleWorktreeOverview(overview, selectedWorktreeFile.path) : overview
    )
    // #1353 part 1 — capture, from the PRE-toggle ordering, the
    // actionable files that follow the cursor (wrapping) so a
    // successful stage can advance onto the next one: staging N files
    // becomes `space space space` instead of `space j space j`.
    const followers = wasStaged
      ? []
      : [
        ...visibleWorktreeFilesGrouped.slice(selectedWorktreeFileIndex + 1),
        ...visibleWorktreeFilesGrouped.slice(0, selectedWorktreeFileIndex),
      ]
        .filter((file) => file.state !== 'staged' && file.path !== selectedWorktreeFile.path)
        .map((file) => file.path)

    dispatch({ type: 'setStatus', value: 'updating file stage state' })
    const result = wasStaged
      ? await unstageFile(git, selectedWorktreeFile)
      : await stageFile(git, selectedWorktreeFile)

    dispatch({ type: 'setStatus', value: result.message, kind: result.ok ? undefined : 'error' })
    const fresh = (await refreshWorktreeContext()) as WorktreeOverview | undefined
    setWorktreeDiff(undefined)
    setWorktreeHunks(undefined)

    if (result.ok && !wasStaged && followers.length && fresh?.files) {
      // Re-anchor by PATH against the fresh grouped ordering — staging
      // reflows the groups, so the old index is meaningless.
      const grouped = flattenWorktreeGroups(
        groupWorktreeFiles(applyStatusFilterMask(fresh.files, statusFilterMask))
      )
      for (const path of followers) {
        const index = grouped.findIndex(
          (file) => file.path === path && file.state !== 'staged'
        )
        if (index >= 0) {
          dispatch({ type: 'jumpToStatusGroup', targetIndex: index })
          break
        }
      }
    }
  }, [
    dispatch,
    git,
    mutateWorktreeOverview,
    refreshWorktreeContext,
    selectedWorktreeFile,
    selectedWorktreeFileIndex,
    statusFilterMask,
    visibleWorktreeFilesGrouped,
  ])

  const toggleSelectedHunkStage = React.useCallback(async () => {
    // The staging target is the hunk under the viewport (#1185) —
    // derived from the scroll offset, the single source of truth.
    const selectedHunk = worktreeHunks?.hunks[
      hunkIndexAtOffset(worktreeDiffOffset, worktreeDiff?.hunkOffsets ?? [])
    ]

    if (!selectedHunk) {
      dispatch({ type: 'setStatus', value: 'no hunk selected', kind: 'warning' })
      return
    }

    dispatch({ type: 'setStatus', value: 'updating hunk stage state' })
    try {
      if (selectedHunk.state === 'staged') {
        await unstageHunk(git, selectedHunk)
      } else {
        await stageHunk(git, selectedHunk)
      }

      dispatch({
        type: 'setStatus',
        value: `${selectedHunk.state === 'staged' ? 'Unstaged' : 'Staged'} hunk`,
        kind: 'success',
      })
      await refreshWorktreeContext()
      setWorktreeDiff(undefined)
      setWorktreeHunks(undefined)
    } catch (error) {
      dispatch({
        type: 'setStatus',
        value: (error as Error).message || 'failed to update hunk stage state',
        kind: 'error',
      })
    }
  }, [dispatch, git, refreshWorktreeContext, worktreeDiffOffset, worktreeDiff, worktreeHunks])

  const revertSelectedFile = React.useCallback(async () => {
    if (!selectedWorktreeFile) {
      dispatch({ type: 'setStatus', value: 'no worktree file selected', kind: 'warning' })
      return
    }

    dispatch({ type: 'setStatus', value: 'reverting selected file' })
    const result = await revertFile(git, selectedWorktreeFile)

    dispatch({ type: 'setStatus', value: result.message, kind: result.ok ? undefined : 'error' })
    await refreshWorktreeContext()
    setWorktreeDiff(undefined)
    setWorktreeHunks(undefined)
  }, [dispatch, git, refreshWorktreeContext, selectedWorktreeFile])

  const revertSelectedHunk = React.useCallback(async () => {
    const selectedHunk = worktreeHunks?.hunks[
      hunkIndexAtOffset(worktreeDiffOffset, worktreeDiff?.hunkOffsets ?? [])
    ]

    if (!selectedHunk) {
      dispatch({ type: 'setStatus', value: 'no hunk selected', kind: 'warning' })
      return
    }

    dispatch({ type: 'setStatus', value: 'reverting selected hunk' })
    try {
      await revertHunk(git, selectedHunk)
      dispatch({ type: 'setStatus', value: `Reverted hunk in ${selectedHunk.filePath}`, kind: 'success' })
      await refreshWorktreeContext()
      setWorktreeDiff(undefined)
      setWorktreeHunks(undefined)
    } catch (error) {
      dispatch({
        type: 'setStatus',
        value: (error as Error).message || 'failed to revert hunk',
        kind: 'error',
      })
    }
  }, [dispatch, git, refreshWorktreeContext, worktreeDiffOffset, worktreeDiff, worktreeHunks])

  /**
   * Resolve the active line selection into (hunk, body-line range). The
   * "cursor" on the staging diff is the viewport top, so the selection
   * is [min(anchor, offset), max(anchor, offset)] in absolute diff-line
   * space, clamped to the body of the hunk containing its start. Only
   * unstaged hunks participate — the same restriction the whole-hunk
   * Space stage applies implicitly by acting on the visible unstaged
   * diff.
   */
  const resolveLineSelection = React.useCallback(() => {
    if (diffLineSelectAnchor === undefined) return undefined
    const offsets = worktreeDiff?.hunkOffsets ?? []
    if (offsets.length === 0) return undefined
    const a = Math.min(diffLineSelectAnchor, worktreeDiffOffset)
    const b = Math.max(diffLineSelectAnchor, worktreeDiffOffset)
    const hunkIndex = hunkIndexAtOffset(a, offsets)
    const hunk = worktreeHunks?.hunks[hunkIndex]
    if (!hunk) return undefined
    const bodyStartAbs = offsets[hunkIndex] + 1
    const bodyEndAbs = bodyStartAbs + hunk.hunk.lines.length - 1
    const start = Math.max(a, bodyStartAbs) - bodyStartAbs
    const end = Math.min(b, bodyEndAbs) - bodyStartAbs
    if (end < start) return undefined
    return { hunk, range: { start, end }, lineCount: end - start + 1 }
  }, [diffLineSelectAnchor, worktreeDiffOffset, worktreeDiff, worktreeHunks])

  const stageSelectedLines = React.useCallback(async () => {
    const selection = resolveLineSelection()
    if (!selection) {
      dispatch({ type: 'setStatus', value: 'Selection has no hunk lines', kind: 'warning' })
      return
    }
    try {
      await stageHunkLines(git, selection.hunk, selection.range)
      dispatch({ type: 'setDiffLineSelectAnchor', value: undefined })
      dispatch({
        type: 'setStatus',
        value: `Staged ${selection.lineCount} selected line${selection.lineCount === 1 ? '' : 's'} in ${selection.hunk.filePath}`,
        kind: 'success',
      })
      await refreshWorktreeContext({ silent: true })
      setWorktreeDiff(undefined)
      setWorktreeHunks(undefined)
    } catch (error) {
      dispatch({
        type: 'setStatus',
        value: (error as Error).message || 'failed to stage selected lines',
        kind: 'error',
      })
    }
  }, [dispatch, git, refreshWorktreeContext, resolveLineSelection, setWorktreeDiff, setWorktreeHunks])

  const revertSelectedLines = React.useCallback(async () => {
    const selection = resolveLineSelection()
    if (!selection) {
      dispatch({ type: 'setStatus', value: 'Selection has no hunk lines', kind: 'warning' })
      return
    }
    try {
      await revertHunkLines(git, selection.hunk, selection.range)
      dispatch({ type: 'setDiffLineSelectAnchor', value: undefined })
      dispatch({
        type: 'setStatus',
        value: `Discarded ${selection.lineCount} selected line${selection.lineCount === 1 ? '' : 's'} in ${selection.hunk.filePath}`,
        kind: 'success',
      })
      await refreshWorktreeContext()
      setWorktreeDiff(undefined)
      setWorktreeHunks(undefined)
    } catch (error) {
      dispatch({
        type: 'setStatus',
        value: (error as Error).message || 'failed to discard selected lines',
        kind: 'error',
      })
    }
  }, [dispatch, git, refreshWorktreeContext, resolveLineSelection, setWorktreeDiff, setWorktreeHunks])

  return {
    toggleSelectedFileStage,
    toggleSelectedHunkStage,
    revertSelectedFile,
    revertSelectedHunk,
    stageSelectedLines,
    revertSelectedLines,
  }
}
