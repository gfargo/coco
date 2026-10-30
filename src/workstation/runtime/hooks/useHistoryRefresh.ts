/**
 * History refresh callback (extracted from app.ts, #1418 decomposition).
 *
 * Owns `refreshHistoryRows` — the async callback that re-fetches the head
 * of the commit log and replaces `state.rows` after any operation that
 * creates or rewrites history locally.
 *
 * The callback is called after split-apply, regular commit, PR creation,
 * and any other operation that mutates the history. Best-effort: a failed
 * re-fetch keeps the existing rows on screen (stale but better than blank).
 *
 * The `useCallback` is issued at the original slot (after `refreshContext` /
 * `refreshWorktreeContext` and before `useRefreshWatcher`). Hook order is
 * preserved.
 *
 * `React` is injected per the runtime's convention.
 */

import type * as ReactTypes from 'react'
import type { SimpleGit } from 'simple-git'
import type { LogArgv } from '../../../commands/log/config'
import type { LogInkAction, LogInkState } from '../inkViewModel'
import { LOG_INTERACTIVE_DEFAULT_LIMIT, getCommitRows, getLogRows } from '../../../git/logData'
import { getStashCommitHashes } from '../../../git/stashData'
import { buildHistoryRefetchArgv } from '../historyRefetchResolver'
import { isStaleBootLoadResolve } from '../loadMoreResolver'
import { computeHasMoreCommits } from './useLoadMoreHistory'

export type UseHistoryRefreshDeps = {
  git: SimpleGit
  logArgv?: LogArgv
  dispatch: (action: LogInkAction) => void
  mountedRef: ReactTypes.MutableRefObject<boolean>
  repoFrameDepthRef: ReactTypes.MutableRefObject<number>
  setHasMoreCommits: ReactTypes.Dispatch<ReactTypes.SetStateAction<boolean>>
  fullGraph: boolean
  historyFetchArgs: LogInkState['historyFetchArgs']
  /**
   * Same #1361-follow-up staleness guard as `useDeferredBootLoad` — if
   * the user changes the filter/graph mode WHILE this post-mutation
   * refresh is in flight, `useHistoryRefetch` may already have painted
   * the newer result by the time this one resolves. See
   * `isStaleBootLoadResolve`.
   */
  historyRefetchGenerationRef: ReactTypes.MutableRefObject<number>
  /**
   * How many main-ordering commits are loaded (`state.mainHistoryCommitCount`).
   * The refresh refetches at least this many so pages the user already
   * loaded survive it (#2209).
   */
  loadedCommitCount: number
}

export type UseHistoryRefreshResult = {
  refreshHistoryRows: (options?: { fromWatcher?: boolean }) => Promise<void>
  /** `Date.now()` when a history refresh not issued by the watcher last started; 0 before any. */
  lastSelfHistoryRefreshAtRef: ReactTypes.MutableRefObject<number>
}

export function useHistoryRefresh(
  React: typeof ReactTypes,
  deps: UseHistoryRefreshDeps,
): UseHistoryRefreshResult {
  const { git, logArgv, dispatch, mountedRef, repoFrameDepthRef, setHasMoreCommits, fullGraph, historyFetchArgs, historyRefetchGenerationRef, loadedCommitCount } = deps

  // Read at call time, not a callback dep: the callback's identity feeds the
  // fs watcher's effect, and a fresh identity on every page would
  // re-subscribe it.
  const loadedCommitCountRef = React.useRef(loadedCommitCount)
  loadedCommitCountRef.current = loadedCommitCount

  /**
   * Re-fetch the head of the commit log and replace `state.rows`.
   *
   * The boot loader fires `replaceRows` once on app mount. After that,
   * NOTHING in the workstation refreshes `state.rows` — `refreshContext`
   * updates the metadata context but not the commits. This callback is
   * called after any operation that creates or rewrites history locally
   * so the history view reflects reality.
   */
  const lastSelfHistoryRefreshAtRef = React.useRef(0)

  const refreshHistoryRows = React.useCallback(async (options: { fromWatcher?: boolean } = {}) => {
    if (!options.fromWatcher) lastSelfHistoryRefreshAtRef.current = Date.now()
    try {
      // #1384 — capture the repo-frame depth BEFORE the awaits.
      const issuedAtDepth = repoFrameDepthRef.current
      // #1361 follow-up — same for the refetch generation, and this
      // refresh itself counts as a fresher generation so a still-
      // in-flight boot load (or an even-earlier refresh) yields to it.
      historyRefetchGenerationRef.current += 1
      const issuedRefetchGeneration = historyRefetchGenerationRef.current
      // Same single-source argv derivation as the merged history refetch
      // effect (#1385) — graph mode AND server-side filter.
      const fetchArgs = historyFetchArgs
      const mergedArgv: LogArgv = logArgv
        ? buildHistoryRefetchArgv(logArgv, fullGraph, fetchArgs)
        : ({
            ...(fetchArgs?.author ? { author: fetchArgs.author } : {}),
            ...(fetchArgs?.path ? { path: fetchArgs.path } : {}),
            ...(fetchArgs?.pickaxe ? { pickaxe: fetchArgs.pickaxe } : {}),
            ...(fetchArgs?.grep ? { grep: fetchArgs.grep } : {}),
          } as LogArgv)
      // Stash commits as graph roots so post-operation refreshes keep the
      // same rich graph the boot loader assembled.
      const stashHashes = await getStashCommitHashes(git).catch(() => [])
      // A refresh used to refetch only the first 1000 commits and replace
      // the rows with them, so every watcher event threw away pages the
      // user had loaded, and a cursor past row 1000 jumped to the top
      // (#2209). Refetch at least as deep as what is loaded.
      const limit = Math.max(LOG_INTERACTIVE_DEFAULT_LIMIT, loadedCommitCountRef.current)
      const fresh = await getLogRows(git, mergedArgv, {
        limit,
        extraRefs: stashHashes,
      })
      const stale = isStaleBootLoadResolve({
        mounted: mountedRef.current,
        issuedAtDepth,
        currentDepth: repoFrameDepthRef.current,
        issuedRefetchGeneration,
        currentRefetchGeneration: historyRefetchGenerationRef.current,
      })
      if (!stale && fresh) {
        dispatch({ type: 'replaceRows', rows: fresh })
        // Re-arm pagination from the fresh window (#1337). A full window
        // means git had more to give; measured against what was asked for,
        // since the window can be deeper than one page.
        setHasMoreCommits(
          computeHasMoreCommits(logArgv, fresh) && getCommitRows(fresh).length >= limit
        )
      }
    } catch { /* ignore — stale rows beat blank rows */ }
  }, [dispatch, git, logArgv, setHasMoreCommits, historyFetchArgs, fullGraph, historyRefetchGenerationRef])

  return { refreshHistoryRows, lastSelfHistoryRefreshAtRef }
}
