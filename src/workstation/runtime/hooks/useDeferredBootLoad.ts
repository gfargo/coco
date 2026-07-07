/**
 * Deferred commit-log boot loader (extracted from `app.ts` as part of
 * the OSS-463 app.ts decomposition).
 *
 * Runs once on mount when the caller opted into the lazy boot path
 * (`loadRows` is defined). The Ink tree is already on screen at this
 * point — without this the user stares at a black terminal during the
 * synchronous git log pre-mount fetch. The mounted-ref guard prevents
 * a late-resolving promise from dispatching after the user `q` quits.
 *
 * Frame-tagged (#1384): if the user drills into a submodule before the
 * boot load resolves, the late `replaceRows` would swap root-repo
 * commits into the child frame. The `isStaleFrameResolve` check drops
 * the result in that case.
 *
 * Reproduced verbatim from the inline effect. Behavior-preserving.
 *
 * `React` is injected per the runtime's convention.
 */

import type * as ReactTypes from 'react'
import type { LogArgv } from '../../../commands/log/config'
import type { GitLogRow } from '../../../commands/log/data'
import type { LogInkAction } from '../inkViewModel'
import { isStaleFrameResolve } from '../loadMoreResolver'
import { computeHasMoreCommits } from './useLoadMoreHistory'

export type UseDeferredBootLoadDeps = {
  /** The deferred row loader, or undefined when boot was synchronous. */
  loadRows: (() => Promise<GitLogRow[]>) | undefined
  /** The interactive log argv (for hasMoreCommits computation). */
  logArgv: LogArgv | undefined
  /** Reducer dispatch. */
  dispatch: (action: LogInkAction) => void
  /** Mount sentinel ref. */
  mountedRef: ReactTypes.MutableRefObject<boolean>
  /** Frame depth ref for stale-frame detection. */
  repoFrameDepthRef: ReactTypes.MutableRefObject<number>
  /** Pagination seed setter. */
  setHasMoreCommits: (value: boolean) => void
}

export function useDeferredBootLoad(
  React: typeof ReactTypes,
  deps: UseDeferredBootLoadDeps,
): void {
  const {
    loadRows,
    logArgv,
    dispatch,
    mountedRef,
    repoFrameDepthRef,
    setHasMoreCommits,
  } = deps

  React.useEffect(() => {
    if (!loadRows) return
    // #1384 — the boot fetch runs against the ROOT frame's git; if the
    // user drills into a submodule before a slow boot load resolves,
    // the late `replaceRows` would swap root-repo commits into the
    // child frame. Same frame-tag-and-drop as `refreshHistoryRows`.
    const issuedAtDepth = repoFrameDepthRef.current
    let cancelled = false
    void loadRows()
      .then((nextRows) => {
        if (cancelled || isStaleFrameResolve({
          mounted: mountedRef.current,
          issuedAtDepth,
          currentDepth: repoFrameDepthRef.current,
        })) return
        dispatch({ type: 'replaceRows', rows: nextRows })
        // Correct the pagination seed: on a cold cache the component
        // mounted with zero rows, so the lazy `hasMoreCommits` seed
        // evaluated false and load-more would stay disabled forever.
        // The fetched window is the real first page — recompute.
        setHasMoreCommits(computeHasMoreCommits(logArgv, nextRows))
      })
      .catch((error: unknown) => {
        if (cancelled || !mountedRef.current) return
        const message = error instanceof Error ? error.message : String(error)
        dispatch({ type: 'setStatus', value: `Failed to load commits: ${message}`, kind: 'error' })
        dispatch({ type: 'setBootLoading', value: false })
      })
    return () => {
      cancelled = true
    }
    // Intentionally one-shot — re-running the boot load on hot
    // dispatch / loader changes would refetch the entire log on every
    // re-render. The loader fires once per app mount and that's it.
  }, [])
}
