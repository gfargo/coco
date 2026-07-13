/**
 * Merged history refetch effect (extracted from `app.ts` as part of the
 * OSS-463 app.ts decomposition, following the 0.72 `useLoadMoreHistory` /
 * `useContextHydration` precedent).
 *
 * Merged history refetch (#1385): server-side filter (#776), graph mode
 * toggle (`g`, #791 follow-up), and repo-frame switches all funnel through
 * ONE effect.
 *
 * These used to be two sibling effects — one keyed on
 * `state.historyFetchArgs`, one on `state.fullGraph` — both listing the
 * active frame's `git` with mount-consumed first-run-skip refs. Every
 * drill-in/out therefore ran BOTH bodies: two concurrent `getLogRows` calls
 * whose argv genuinely diverged (the filter fetch ignored `fullGraph`; the
 * graph fetch ignored the filter), and whichever resolved last decided —
 * nondeterministically — whether the frame showed full/compact and
 * filtered/unfiltered rows, plus contradictory status lines. One effect
 * means one merged argv (`buildHistoryRefetchArgv` consults BOTH
 * dimensions) and one request id, so a superseded fetch always drops. The
 * prev-value ref exists only to pick the right status copy
 * (`resolveHistoryRefetch`) — filter submit, graph toggle, or frame switch.
 *
 * Reproduced verbatim: the refs, the request-id stale guard, the dispatch
 * payloads, and the dependency array are byte-for-byte the same as the
 * original `app.ts` cluster. This is a behavior-preserving move, not a
 * rewrite.
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'
import type { SimpleGit } from 'simple-git'
import type { LogArgv } from '../../../commands/log/config'
import {
  LOG_INTERACTIVE_DEFAULT_LIMIT,
  getCommitRows,
  getLogRows,
} from '../../../git/logData'
import { getStashCommitHashes } from '../../../git/stashData'
import { resolveHistoryRefetch } from '../historyRefetchResolver'
import type { LogInkAction, LogInkState } from '../inkViewModel'

/**
 * Best-effort promise unwrap, lifted verbatim from `app.ts`. Swallows the
 * rejection so a failed refetch leaves the existing rows on screen instead
 * of crashing the workstation.
 */
async function safe<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise
  } catch {
    return undefined
  }
}

export type UseHistoryRefetchDeps = {
  /** The active frame's `git`. */
  git: SimpleGit
  /** Reducer dispatch — drives status + row replacement. */
  dispatch: (action: LogInkAction) => void
  /** The interactive log argv, or undefined when not in interactive log mode. */
  logArgv: LogArgv | undefined
  /** Current graph mode (`state.fullGraph`). */
  fullGraph: boolean
  /** Current server-side filter (`state.historyFetchArgs`). */
  historyFetchArgs: LogInkState['historyFetchArgs']
  /**
   * Mount sentinel ref shared across the component (read by many other
   * clusters), kept in `app.ts` and passed in so the stale-completion guard
   * still sees the live value.
   */
  mountedRef: ReactTypes.MutableRefObject<boolean>
  setHasMoreCommits: (value: boolean) => void
  /**
   * Monotonic counter bumped every time this effect actually fires a
   * fetch (#1361 follow-up — see `isStaleBootLoadResolve`). Read by
   * `useDeferredBootLoad` so its own one-shot background fetch can tell
   * whether a real filter/graph refetch has started since it was
   * dispatched, and drop its resolve instead of clobbering the result.
   */
  historyRefetchGenerationRef: ReactTypes.MutableRefObject<number>
}

export function useHistoryRefetch(
  React: typeof ReactTypes,
  deps: UseHistoryRefetchDeps,
): void {
  const {
    git,
    dispatch,
    logArgv,
    fullGraph,
    historyFetchArgs,
    mountedRef,
    setHasMoreCommits,
    historyRefetchGenerationRef,
  } = deps

  const historyRefetchInitialized = React.useRef(false)
  const historyRefetchRequestRef = React.useRef(0)
  const historyRefetchPrevRef = React.useRef<{
    fullGraph: boolean
    fetchArgs: LogInkState['historyFetchArgs']
  } | undefined>(undefined)
  React.useEffect(() => {
    if (!logArgv) return
    const prev = historyRefetchPrevRef.current
    historyRefetchPrevRef.current = {
      fullGraph,
      fetchArgs: historyFetchArgs,
    }
    // Skip the first run — initial rows came in via deps.rows; we only
    // want to fetch in response to *changes*.
    if (!historyRefetchInitialized.current) {
      historyRefetchInitialized.current = true
      return
    }

    const requestId = historyRefetchRequestRef.current + 1
    historyRefetchRequestRef.current = requestId
    // #1361 follow-up — bump BEFORE the async fetch starts so an
    // in-flight refetch already outranks a slower-resolving boot load
    // regardless of which promise settles first (see
    // isStaleBootLoadResolve in loadMoreResolver.ts).
    historyRefetchGenerationRef.current += 1
    // #1612 — capture OUR OWN generation too. The guard below used to
    // check only historyRefetchRequestRef (this hook's own sibling
    // fetches), never the shared generation counter — so a slower
    // refetch that resolved after a fresher post-mutation
    // refreshHistoryRows (which also bumps this same counter) would
    // still pass its own request-id check and overwrite the newer rows
    // with pre-mutation data. Same one-way hazard the boot loader
    // already guards against via isStaleBootLoadResolve.
    const issuedRefetchGeneration = historyRefetchGenerationRef.current
    const plan = resolveHistoryRefetch({
      logArgv,
      fullGraph,
      fetchArgs: historyFetchArgs,
      fetchArgsChanged: prev !== undefined && prev.fetchArgs !== historyFetchArgs,
      fullGraphChanged: prev !== undefined && prev.fullGraph !== fullGraph,
    })

    dispatch({ type: 'setStatus', value: plan.pendingStatus })

    void (async () => {
      // Include stash commits as graph roots so the re-fetch sees the
      // same rich graph the boot loader assembles. Without this, any
      // refetch would lose the stash anchors that loadRowsWithStashes
      // seeded on boot.
      const stashHashes = await getStashCommitHashes(git).catch(() => [])
      const nextRows = await safe(getLogRows(git, plan.argv, {
        limit: LOG_INTERACTIVE_DEFAULT_LIMIT,
        extraRefs: stashHashes,
      }))
      if (
        !mountedRef.current ||
        historyRefetchRequestRef.current !== requestId ||
        historyRefetchGenerationRef.current !== issuedRefetchGeneration
      ) {
        return
      }
      if (!nextRows) {
        dispatch({ type: 'setStatus', value: plan.errorStatus, kind: 'error' })
        return
      }
      dispatch({ type: 'replaceRows', rows: nextRows })
      const matched = getCommitRows(nextRows).length
      setHasMoreCommits(matched >= LOG_INTERACTIVE_DEFAULT_LIMIT)
      dispatch({ type: 'setStatus', value: plan.successStatus(matched), kind: 'success' })
    })()
  }, [dispatch, git, logArgv, historyFetchArgs, fullGraph])
}
