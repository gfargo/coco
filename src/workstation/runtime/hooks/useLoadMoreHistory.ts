/**
 * Load-more pagination cluster (extracted in the 0.72 app.ts
 * decomposition, PR 10 — cluster O).
 *
 * This module lifts the older-commit pagination machinery out of
 * `app.ts`, in original declaration order:
 *
 *   1. `loadingMoreCommitsRef` mirror effect — keeps the synchronous
 *      ref in step with the `loadingMoreCommits` state so the callbacks
 *      can read in-flight status without a stale closure;
 *   2. `loadMoreStateRef` + `loadMoreCommits` — the STABLE (empty-ish
 *      dep) `useCallback` that pages a fresh `git log` window AFTER the
 *      loaded commits, reading all volatile state via the snapshot ref;
 *   3. the scroll-near-bottom auto-trigger effect — fires `loadMoreCommits`
 *      once the cursor is within 20 rows of the last loaded commit;
 *   4. `loadCommitContextStateRef` + `loadCommitContext` — the STABLE
 *      `useCallback` that walks a `git log` anchored on a cursored ref's
 *      commit (the targeted-context loader the cursor-sync effect bridges
 *      to);
 *   5. the bridge-assignment effect — `loadCommitContextRef.current =
 *      loadCommitContext`, in its EXACT original slot at the end of the
 *      cluster.
 *
 * THE RACE (read `useHistoryCursorSync` for the full write-up). Cluster N
 * (cursor sync) **reads** `loadCommitContextRef.current`; this cluster
 * **writes** it. The cursor-sync effect runs BEFORE this cluster's
 * assignment effect in declaration order, so the ref must always hold a
 * STABLE callback — otherwise the sync effect would invoke a stale
 * previous-render callback that captured an old `state.commits.length`
 * and re-fetched the same window, making the auto-load chain fire but
 * never advance. `loadMoreCommits` and `loadCommitContext` are therefore
 * kept as stable `useCallback`s (deps `[dispatch, git]`) that read all
 * volatile state through their own snapshot refs. Both `useCallback` dep
 * arrays and the `loadCommitContextRef.current = ` assignment timing are
 * preserved BYTE-FOR-BYTE.
 *
 * Why two position-preserving hooks instead of one merged hook: the two
 * clusters sit ~2750 lines apart with dozens of intervening effects.
 * React fires effects in declaration order; merging would reorder them.
 * So `loadCommitContextRef` is declared in `useHistoryCursorSync` (at the
 * cluster-N slot) and threaded in here so the assignment effect keeps its
 * exact relative position (à la PR 6 `repoRootRef`).
 *
 * Everything is reproduced **verbatim and separate**, in original order;
 * the request-id stale guards, the `mountedRef` mount checks, the
 * cancellation logic, the dispatch payloads, and every dependency array
 * are byte-for-byte the same as the original `app.ts` cluster.
 *
 * #1384 layered the repo-frame discipline on top: both loaders capture
 * the repo-stack depth at dispatch and drop their resolve when the
 * frame stack changed mid-flight (the pure decisions live in
 * `loadMoreResolver.ts`), and a rescope effect bumps
 * `loadMoreRequestRef` / resets the in-flight flags on every frame
 * push / pop so a parent-frame page can never splice into a child
 * frame's history.
 *
 * `mountedRef`, `loadingMoreCommitsRef`, and `loadMoreRequestRef` stay
 * declared in `app.ts` (they are shared with — or, for `mountedRef`, read
 * by — many other clusters) and are passed in.
 *
 * The `hasMoreCommits` / `loadingMoreCommits` `useState` pair is owned by
 * {@link useHistoryPaginationState} (app.ts decomposition item 3 / #1237),
 * which issues the pair in its original `app.ts` slot near the top of the
 * component. The setters are shared — the render and the history-filter /
 * graph-toggle effects also read and write them — so the state hook only
 * *owns* the slots and hands the values + setters back to `app.ts`, which
 * threads them into this loader (and the filter / graph effects) exactly as
 * before. A position-preserving split: the state hook is called where the
 * `useState`s were, this loader stays at its original slot far below.
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'
import type { SimpleGit } from 'simple-git'
import type { LogArgv } from '../../../commands/log/config'
import {
  GitLogRow,
  LOG_INTERACTIVE_DEFAULT_LIMIT,
  getCommitRows,
  getLogRows,
  getLogRowsAnchoredOn,
} from '../../../commands/log/data'
import { getStashCommitHashes } from '../../../git/stashData'
import type { LogInkAction, LogInkState } from '../inkViewModel'
import { isStaleFrameResolve, isStaleLoadMoreCompletion } from '../loadMoreResolver'
import type { LoadCommitContextFn } from './useHistoryCursorSync'

/**
 * Best-effort promise unwrap, lifted verbatim from `app.ts`. Swallows the
 * rejection so a failed page leaves the existing rows on screen instead
 * of crashing the workstation.
 */
async function safe<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise
  } catch {
    return undefined
  }
}

export type UseHistoryPaginationStateDeps = {
  /** The interactive log argv, or undefined when not in interactive log mode. */
  logArgv: LogArgv | undefined
  /** The initial commit-log rows the component mounted with. */
  rows: GitLogRow[]
}

/**
 * Whether a freshly-loaded window of rows leaves more history to page in:
 * interactive log mode without an explicit `--limit`, and the window
 * filled the default page. Shared by the mount-time seed below and the
 * boot loader's post-fetch correction — `coco ui` mounts with the cached
 * rows (or none at all on a cold cache) and fetches the real window
 * async, so a seed computed from the mount rows alone would permanently
 * disable pagination on first run.
 */
export function computeHasMoreCommits(
  logArgv: LogArgv | undefined,
  rows: GitLogRow[],
): boolean {
  return (
    Boolean(logArgv?.interactive && !logArgv.limit) &&
    getCommitRows(rows).length >= LOG_INTERACTIVE_DEFAULT_LIMIT
  )
}

/**
 * Issues the `hasMoreCommits` / `loadingMoreCommits` `useState` pair, in its
 * original `app.ts` position. `hasMoreCommits` keeps its verbatim lazy seed —
 * true only in interactive log mode without an explicit `--limit` when the
 * initial window already filled the default page — so the first render's
 * pagination affordance is unchanged. Returns the values (read by the render)
 * and the setters (shared: threaded into {@link useLoadMoreHistory} and the
 * history-filter / graph-toggle effects, which also write them). A
 * position-preserving split; see the module header.
 */
export function useHistoryPaginationState(
  React: typeof ReactTypes,
  deps: UseHistoryPaginationStateDeps,
): {
  hasMoreCommits: boolean
  setHasMoreCommits: ReactTypes.Dispatch<ReactTypes.SetStateAction<boolean>>
  loadingMoreCommits: boolean
  setLoadingMoreCommits: ReactTypes.Dispatch<ReactTypes.SetStateAction<boolean>>
} {
  const { logArgv, rows } = deps
  const [hasMoreCommits, setHasMoreCommits] = React.useState(() => computeHasMoreCommits(logArgv, rows))
  const [loadingMoreCommits, setLoadingMoreCommits] = React.useState(false)
  return {
    hasMoreCommits,
    setHasMoreCommits,
    loadingMoreCommits,
    setLoadingMoreCommits,
  }
}

export type UseLoadMoreHistoryDeps = {
  /** The active frame's `git`. */
  git: SimpleGit
  /** Reducer dispatch — drives status + row appends. */
  dispatch: (action: LogInkAction) => void
  /** The reducer state — read for commit counts, fetch args, cursor. */
  state: LogInkState
  /** The interactive log argv, or undefined when not in interactive log mode. */
  logArgv: LogArgv | undefined
  /** Whether the runtime believes more pages exist beyond the loaded window. */
  hasMoreCommits: boolean
  setHasMoreCommits: (value: boolean) => void
  /** Whether a page fetch is currently in flight. */
  loadingMoreCommits: boolean
  setLoadingMoreCommits: (value: boolean) => void
  /**
   * Mount sentinel ref shared across the component (read by many other
   * clusters), kept in `app.ts` and passed in so the stale-completion
   * guards still see the live value.
   */
  mountedRef: ReactTypes.MutableRefObject<boolean>
  /** Synchronous in-flight mirror of `loadingMoreCommits`, kept in `app.ts`. */
  loadingMoreCommitsRef: ReactTypes.MutableRefObject<boolean>
  /** Monotonic request id for the page fetch stale-completion guard. */
  loadMoreRequestRef: ReactTypes.MutableRefObject<number>
  /**
   * The forward-reference bridge ref declared in `useHistoryCursorSync`.
   * This hook's assignment effect writes `loadCommitContext` into it at
   * the cluster's original slot so the cursor-sync effect can invoke the
   * stable targeted-context loader.
   */
  loadCommitContextRef: ReactTypes.MutableRefObject<LoadCommitContextFn | null>
}

export function useLoadMoreHistory(
  React: typeof ReactTypes,
  deps: UseLoadMoreHistoryDeps,
): void {
  const {
    git,
    dispatch,
    state,
    logArgv,
    hasMoreCommits,
    setHasMoreCommits,
    loadingMoreCommits,
    setLoadingMoreCommits,
    mountedRef,
    loadingMoreCommitsRef,
    loadMoreRequestRef,
    loadCommitContextRef,
  } = deps

  React.useEffect(() => {
    loadingMoreCommitsRef.current = loadingMoreCommits
  }, [loadingMoreCommits])

  // #1384 — rescope the pagination request family on every repo-frame
  // push / pop. The history rows are swapped in place per frame (the
  // git-keyed refetch effects in app.ts replace them), but nothing used
  // to invalidate an in-flight page fetch: a parent-frame page resolving
  // after a submodule drill-in passed the request-id guard and spliced
  // parent-repo commits into the child frame's graph. Bumping the id on
  // every frame transition means a pre-transition fetch can never
  // satisfy the guard — even after a push → pop round trip back to the
  // same depth. The in-flight flags are reset too: the stale completion
  // returns early WITHOUT clearing them (by design — it must not
  // clobber a newer fetch's state), so without this reset a dropped
  // completion would leave `loadingMoreCommitsRef` true forever and
  // permanently disable pagination in the new frame.
  React.useEffect(() => {
    loadMoreRequestRef.current += 1
    loadingMoreCommitsRef.current = false
    setLoadingMoreCommits(false)
  }, [
    state.repoStack.length,
    loadMoreRequestRef,
    loadingMoreCommitsRef,
    setLoadingMoreCommits,
  ])

  // STABLE useCallback (empty deps) for loadMoreCommits. The function
  // reads the volatile state (commit counts, fetch args, hasMore) via
  // refs that update on every render so the identity stays constant.
  //
  // Why stable matters: the cursor-syncs-history auto-load chain
  // calls this through a forward-reference ref (loadMoreCommitsRef).
  // If loadMoreCommits regenerated on every render — as the previous
  // implementation did via state deps — there was a render-order
  // race: the cursor sync effect would call the PREVIOUS render's
  // callback (still in the ref because the ref-setter useEffect runs
  // after the cursor-sync effect in declaration order), which had
  // captured a stale `state.commits.length` and re-fetched the same
  // window. The auto-load chain appeared to fire but never advanced
  // through history.
  //
  // Stable identity + refs sidesteps the race entirely: the function
  // never changes, and every call reads the latest state.
  const loadMoreStateRef = React.useRef({
    mainHistoryCommitCount: state.mainHistoryCommitCount,
    filteredCommitsLength: state.filteredCommits.length,
    historyFetchArgs: state.historyFetchArgs,
    hasMoreCommits,
    logArgv,
    // #1384 — repo-frame depth, captured at dispatch and re-read at
    // resolve so a fetch issued in one frame drops instead of splicing
    // its rows into whichever frame is active when it lands.
    repoFrameDepth: state.repoStack.length - 1,
  })
  loadMoreStateRef.current = {
    mainHistoryCommitCount: state.mainHistoryCommitCount,
    filteredCommitsLength: state.filteredCommits.length,
    historyFetchArgs: state.historyFetchArgs,
    hasMoreCommits,
    logArgv,
    repoFrameDepth: state.repoStack.length - 1,
  }

  const loadMoreCommits = React.useCallback(async (
    options: { statusMessage?: string } = {}
  ): Promise<{ fired: boolean; addedCommits: number }> => {
    const snap = loadMoreStateRef.current
    if (!snap.logArgv || snap.logArgv.limit || loadingMoreCommitsRef.current || !snap.hasMoreCommits) {
      return { fired: false, addedCommits: 0 }
    }
    if (snap.filteredCommitsLength === 0) {
      return { fired: false, addedCommits: 0 }
    }

    loadingMoreCommitsRef.current = true
    const requestId = loadMoreRequestRef.current + 1
    loadMoreRequestRef.current = requestId
    // #1384 — frame-tag the fetch (same discipline as the #994 context
    // loaders): capture the depth it was issued from so the resolve can
    // drop when the repo-frame stack changed mid-flight.
    const issuedAtDepth = snap.repoFrameDepth
    setLoadingMoreCommits(true)
    dispatch({
      type: 'setStatus',
      value: options.statusMessage || 'loading older commits',
      loading: true,
    })
    const fetchArgs = snap.historyFetchArgs
    const mergedArgv: LogArgv = {
      ...snap.logArgv,
      ...(fetchArgs?.author ? { author: fetchArgs.author } : {}),
      ...(fetchArgs?.path ? { path: fetchArgs.path } : {}),
    }
    // Load-more paths a fresh page from git AFTER what's already
    // loaded; pass the stash hashes again so the additional rows
    // stay graph-consistent with the boot fetch (a window that
    // dropped stashes mid-stream would render with broken junctions).
    const stashHashes = await getStashCommitHashes(git).catch(() => [])
    // Skip by the MAIN-ordering offset, not `commits.length` (#1337):
    // anchored context loads merge rows that aren't a prefix of this
    // ordering, so the total loaded count overshoots the offset and a
    // count-based skip silently drops the commits ranked in the gap.
    const nextRows = await safe(
      getLogRows(git, mergedArgv, {
        limit: LOG_INTERACTIVE_DEFAULT_LIMIT,
        skip: snap.mainHistoryCommitCount,
        extraRefs: stashHashes,
      })
    )

    // Stale-completion guard (#1384): unmounted, superseded request id
    // (a newer fetch OR the frame push/pop rescope bump), or a repo-
    // frame depth change. A stale completion must NOT touch the
    // loading flags or `hasMoreCommits` — they now belong to the new
    // frame (the rescope effect above resets them on frame moves).
    if (isStaleLoadMoreCompletion({
      mounted: mountedRef.current,
      requestId,
      currentRequestId: loadMoreRequestRef.current,
      issuedAtDepth,
      currentDepth: loadMoreStateRef.current.repoFrameDepth,
    })) {
      return { fired: false, addedCommits: 0 }
    }

    loadingMoreCommitsRef.current = false
    setLoadingMoreCommits(false)

    const nextCommitCount = nextRows ? getCommitRows(nextRows).length : 0

    if (!nextRows) {
      dispatch({ type: 'setStatus', value: 'failed to load older commits', kind: 'error' })
      return { fired: false, addedCommits: 0 }
    }

    if (nextRows?.length) {
      // Tag the append with its fetched main-ordering commit count so
      // the reducer advances the pagination offset (#1337).
      dispatch({ type: 'appendRows', rows: nextRows, mainOrderingCount: nextCommitCount })
    }

    setHasMoreCommits(nextCommitCount >= LOG_INTERACTIVE_DEFAULT_LIMIT)
    return { fired: true, addedCommits: nextCommitCount }
    // Empty deps — the function is intentionally stable. State is
    // read via `loadMoreStateRef.current` at call time, and `dispatch`
    // / `git` / `setLoadingMoreCommits` / `setHasMoreCommits` are
    // already stable across renders by React's contract.
  }, [dispatch, git])

  // Scroll-near-bottom auto-trigger. Fires when the user's cursor is
  // within 20 rows of the last loaded commit so older history is
  // already on its way by the time they reach the bottom.
  React.useEffect(() => {
    const remaining = state.filteredCommits.length - state.selectedIndex - 1
    if (remaining > 20) return
    void loadMoreCommits().then((result) => {
      if (result.fired) {
        dispatch({
          type: 'setStatus',
          value: result.addedCommits
            ? `loaded ${result.addedCommits} older commits`
            : 'end of history',
        })
      }
    })
  }, [
    dispatch,
    loadMoreCommits,
    state.filteredCommits.length,
    state.selectedIndex,
  ])

  /**
   * Targeted-context loader for the cursor-syncs-history effect. Called
   * when the resolver returns `load-context` — the user cursored a
   * branch / tag / stash whose target commit isn't in the loaded
   * window, so we run a `git log` anchored on that commit (guaranteed
   * to include it) and merge the result via `appendRows` (which
   * already deduplicates by hash).
   *
   * Stable identity (empty deps) for the same reason as
   * `loadMoreCommits` — the cursor-sync effect calls this through a
   * forward-reference ref, and a regenerating callback would
   * reintroduce the render-order race that bit the previous chain.
   * All volatile state (logArgv, mostly) is read via refs.
   */
  const loadCommitContextStateRef = React.useRef({
    logArgv,
    repoFrameDepth: state.repoStack.length - 1,
  })
  loadCommitContextStateRef.current = {
    logArgv,
    repoFrameDepth: state.repoStack.length - 1,
  }

  const loadCommitContext = React.useCallback(async (
    target: { hash: string; label: string }
  ): Promise<void> => {
    const snap = loadCommitContextStateRef.current
    if (!snap.logArgv) return
    // #1384 — frame-tag the anchored fetch; see `loadMoreCommits`.
    const issuedAtDepth = snap.repoFrameDepth
    dispatch({
      type: 'setStatus',
      value: `Loading commits around ${target.label}…`,
      loading: true,
    })
    try {
      // No stashHashes here — `getLogRowsAnchoredOn` walks only from
      // the target so it can guarantee the target's inclusion.
      // Stashes are already in the loaded graph from boot's
      // `loadRowsWithStashes`; `appendRows` deduplicates by hash so
      // the merged result keeps both views without double-counting.
      const rows = await getLogRowsAnchoredOn(git, snap.logArgv, target.hash, {})
      // #1384 — drop the resolve when the repo-frame stack changed
      // mid-flight: the anchored rows belong to the frame that issued
      // the fetch, and `appendRows` would splice them into whichever
      // frame is active now.
      if (isStaleFrameResolve({
        mounted: mountedRef.current,
        issuedAtDepth,
        currentDepth: loadCommitContextStateRef.current.repoFrameDepth,
      })) return
      if (rows.length > 0) {
        dispatch({ type: 'appendRows', rows })
        // Don't dispatch a setStatus here — the cursor-sync effect
        // will re-fire on the appendRows-driven filteredCommits
        // change and either jump (success) or report unreachable
        // (failure), surfacing the right message.
      } else {
        dispatch({
          type: 'setStatus',
          value: `${target.label} target commit returned no rows — orphan ref?`,
          kind: 'warning',
        })
      }
    } catch (error) {
      // Same frame-scoped drop for the failure path (#1384): a stale
      // frame's error message would mislabel the ACTIVE frame's state.
      if (!isStaleFrameResolve({
        mounted: mountedRef.current,
        issuedAtDepth,
        currentDepth: loadCommitContextStateRef.current.repoFrameDepth,
      })) {
        dispatch({
          type: 'setStatus',
          value: `Failed to load context for ${target.label}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          kind: 'error',
        })
      }
    }
  }, [dispatch, git])

  React.useEffect(() => {
    loadCommitContextRef.current = loadCommitContext
  }, [loadCommitContext])
}
