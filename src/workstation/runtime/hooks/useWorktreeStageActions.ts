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
import type { WorktreeFile } from '../../../git/statusData'
import { revertFile, stageFile, unstageFile } from '../../../git/statusActions'
import {
  WorktreeHunkOverview,
  revertHunk,
  stageHunk,
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
  /** Re-fetch the worktree context after a stage/revert mutation. */
  refreshWorktreeContext: (options?: { silent?: boolean }) => Promise<unknown>
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
    refreshWorktreeContext,
    setWorktreeDiff,
    setWorktreeHunks,
  } = deps

  const toggleSelectedFileStage = React.useCallback(async () => {
    if (!selectedWorktreeFile) {
      dispatch({ type: 'setStatus', value: 'no worktree file selected', kind: 'warning' })
      return
    }

    dispatch({ type: 'setStatus', value: 'updating file stage state' })
    const result = selectedWorktreeFile.state === 'staged'
      ? await unstageFile(git, selectedWorktreeFile)
      : await stageFile(git, selectedWorktreeFile)

    dispatch({ type: 'setStatus', value: result.message })
    await refreshWorktreeContext()
    setWorktreeDiff(undefined)
    setWorktreeHunks(undefined)
  }, [dispatch, git, refreshWorktreeContext, selectedWorktreeFile])

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

    dispatch({ type: 'setStatus', value: result.message })
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

  return {
    toggleSelectedFileStage,
    toggleSelectedHunkStage,
    revertSelectedFile,
    revertSelectedHunk,
  }
}
