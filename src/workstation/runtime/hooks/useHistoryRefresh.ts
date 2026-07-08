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
import { LOG_INTERACTIVE_DEFAULT_LIMIT, getLogRows } from '../../../commands/log/data'
import { getStashCommitHashes } from '../../../git/stashData'
import { buildHistoryRefetchArgv } from '../historyRefetchResolver'
import { isStaleFrameResolve } from '../loadMoreResolver'
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
}

export type UseHistoryRefreshResult = {
  refreshHistoryRows: () => Promise<void>
}

export function useHistoryRefresh(
  React: typeof ReactTypes,
  deps: UseHistoryRefreshDeps,
): UseHistoryRefreshResult {
  const { git, logArgv, dispatch, mountedRef, repoFrameDepthRef, setHasMoreCommits, fullGraph, historyFetchArgs } = deps

  /**
   * Re-fetch the head of the commit log and replace `state.rows`.
   *
   * The boot loader fires `replaceRows` once on app mount. After that,
   * NOTHING in the workstation refreshes `state.rows` — `refreshContext`
   * updates the metadata context but not the commits. This callback is
   * called after any operation that creates or rewrites history locally
   * so the history view reflects reality.
   */
  const refreshHistoryRows = React.useCallback(async () => {
    try {
      // #1384 — capture the repo-frame depth BEFORE the awaits.
      const issuedAtDepth = repoFrameDepthRef.current
      // Same single-source argv derivation as the merged history refetch
      // effect (#1385) — graph mode AND server-side filter.
      const fetchArgs = historyFetchArgs
      const mergedArgv: LogArgv = logArgv
        ? buildHistoryRefetchArgv(logArgv, fullGraph, fetchArgs)
        : ({
            ...(fetchArgs?.author ? { author: fetchArgs.author } : {}),
            ...(fetchArgs?.path ? { path: fetchArgs.path } : {}),
          } as LogArgv)
      // Stash commits as graph roots so post-operation refreshes keep the
      // same rich graph the boot loader assembled.
      const stashHashes = await getStashCommitHashes(git).catch(() => [])
      const fresh = await getLogRows(git, mergedArgv, {
        limit: LOG_INTERACTIVE_DEFAULT_LIMIT,
        extraRefs: stashHashes,
      })
      const staleFrame = isStaleFrameResolve({
        mounted: mountedRef.current,
        issuedAtDepth,
        currentDepth: repoFrameDepthRef.current,
      })
      if (!staleFrame && fresh) {
        dispatch({ type: 'replaceRows', rows: fresh })
        // Re-arm pagination from the fresh window (#1337).
        setHasMoreCommits(computeHasMoreCommits(logArgv, fresh))
      }
    } catch { /* ignore — stale rows beat blank rows */ }
  }, [dispatch, git, logArgv, setHasMoreCommits, historyFetchArgs, fullGraph])

  return { refreshHistoryRows }
}
