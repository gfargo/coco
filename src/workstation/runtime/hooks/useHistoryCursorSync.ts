/**
 * History-cursor sync cluster (extracted in the 0.72 app.ts decomposition,
 * PR 10 — cluster N).
 *
 * This module lifts the "cursoring a branch / tag / stash auto-jumps the
 * history cursor to that ref's commit" machinery out of `app.ts`:
 *
 *   1. the main sync effect — resolves the cursored ref's target hash
 *      (branch tip / tag commit / stash base-or-commit), delegates the
 *      decision to the pure `resolveCursorSyncDecision`, then performs
 *      it: `jump` (move the cursor + status), `load-context` (fire the
 *      bridged targeted loader), or `unreachable` (warn);
 *   2. the reset effect — clears the dedup ref + the attempted-context
 *      set when focus leaves the branches / tags / stashes surface so
 *      re-entering re-fires the sync.
 *
 * THE RACE (why this is the highest-risk extraction in the series).
 * ----------------------------------------------------------------
 * The sync effect (cluster N) and the load-more / targeted-context
 * machinery (cluster O, `useLoadMoreHistory`) are ~2750 lines apart in
 * the original component with dozens of intervening effects. They are
 * coupled through ONE forward-reference ref, `loadCommitContextRef`:
 *
 *   - cluster N **reads** it: when the resolver returns `load-context`,
 *     the effect calls `loadCommitContextRef.current?.(target)` to walk
 *     a `git log` anchored on the cursored commit and merge the result;
 *   - cluster O **writes** it: an effect assigns
 *     `loadCommitContextRef.current = loadCommitContext` after the
 *     `loadCommitContext` `useCallback` is created.
 *
 * The ref MUST hold a *stable* callback. Cluster O's `loadCommitContext`
 * (and its sibling `loadMoreCommits`) are `useCallback`s with stable
 * identity — they read all volatile state through their own snapshot
 * refs. If either regenerated every render, the cursor-sync effect (which
 * runs BEFORE cluster O's ref-assignment effect in declaration order)
 * would invoke the PREVIOUS render's callback still sitting in the ref —
 * the exact render-order race that previously made the auto-load chain
 * fire but never advance through history.
 *
 * To preserve that ordering EXACTLY, `loadCommitContextRef` is declared
 * here (issued in the same slot the original cluster declared it — after
 * the two cluster-N refs, before the sync effect) and **returned** so
 * `app.ts` can thread it into `useLoadMoreHistory`, whose assignment
 * effect keeps its exact relative position far below. Splitting the
 * clusters into two position-preserving hooks (à la PR 6 `repoRootRef`)
 * rather than one merged hook is what keeps every effect in declaration
 * order — merging would reorder them past the ~dozens of intervening
 * effects between the two clusters.
 *
 * The sync effect and reset effect are reproduced **verbatim and
 * separate**, in original order; the resolver call, the dispatch payloads,
 * the `lastSyncedHashRef` dedup, the `attemptedContextHashesRef`
 * bookkeeping, and both dependency arrays are byte-for-byte the same as the
 * original `app.ts` cluster. The branch/tag/stash target-resolution arms
 * now read through the id-based selectors (`getSelectedBranch` /
 * `getSelectedTag` / `getSelectedStash`, #1452) instead of inline
 * sort+filter+index lookups — same resolved target, no behavior change.
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'
import { hashesMatchAny } from '../../../git/hashes'
import {
  buildLoadedHashSet,
  resolveCursorSyncDecision,
} from '../cursorSyncResolver'
import type { LogInkAction, LogInkState } from '../inkViewModel'
import { getSelectedBranch, getSelectedStash, getSelectedTag } from '../selection'
import type { LogInkContext } from '../types'

/** Forward-reference signature for the bridged targeted-context loader. */
/** How long the cursor has to rest on a ref before its commits are fetched (#2209). */
export const CURSOR_SYNC_LOAD_DEBOUNCE_MS = 150

/** `superseded` when a newer anchored fetch replaced this one and its rows were dropped (#2209). */
export type LoadCommitContextFn = (target: { hash: string; label: string }) => Promise<{ superseded?: boolean } | void>

export type UseHistoryCursorSyncDeps = {
  /** Reducer dispatch — drives the cursor jump + status updates. */
  dispatch: (action: LogInkAction) => void
  /** The active frame's loaded context (branches / tags / stashes). */
  context: LogInkContext
  /** The reducer state — read for the cursored row + loaded window. */
  state: LogInkState
}

/**
 * Cluster N — history-cursor sync. Issues the two cluster-local refs and
 * the bridge ref in their original order, then the two effects verbatim.
 * Returns `loadCommitContextRef` so `app.ts` can thread it into
 * `useLoadMoreHistory`, which assigns `.current` at its original slot.
 */
export function useHistoryCursorSync(
  React: typeof ReactTypes,
  deps: UseHistoryCursorSyncDeps,
): ReactTypes.MutableRefObject<LoadCommitContextFn | null> {
  const { dispatch, context, state } = deps

  const lastSyncedHashRef = React.useRef<string | undefined>(undefined)
  // Tracks which target hashes we've already anchored a `git log`
  // fetch on (#1034 follow-up). When the cursor-syncs-history effect
  // sees a target whose hash isn't in the loaded window AND isn't in
  // this set, it kicks off `getLogRowsAnchoredOn` and adds the hash
  // here. After the fetch resolves and rows are appended, the effect
  // re-fires; if the target STILL isn't loaded the resolver sees the
  // hash in this set and returns `unreachable` instead of looping.
  //
  // Stored as a ref because (a) the resolver only ever reads it and
  // (b) component re-renders on state.filteredCommits change are the
  // re-fire trigger; storing here in state would add a redundant
  // render per attempt.
  const attemptedContextHashesRef = React.useRef<Set<string>>(new Set())
  // Forward-reference for the targeted context loader. Defined later
  // in the component body — see the load-more refactor for why this
  // forward-ref pattern is needed and why the implementation is stable
  // so the race that bit the previous auto-load chain doesn't recur.
  const loadCommitContextRef = React.useRef<LoadCommitContextFn | null>(null)
  React.useEffect(() => {
    let pendingLoad: ReturnType<typeof setTimeout> | undefined
    const cancelPendingLoad = () => {
      if (pendingLoad !== undefined) clearTimeout(pendingLoad)
    }
    const onBranchTab = state.activeView === 'branches' ||
      (state.focus === 'sidebar' && state.sidebarTab === 'branches')
    const onTagTab = state.activeView === 'tags' ||
      (state.focus === 'sidebar' && state.sidebarTab === 'tags')
    // User-reported gap: cursoring a stash didn't sync the history
    // cursor the way cursoring a branch / tag did. Same auto-jump
    // affordance now extends to stashes; the stash's commit hash IS
    // the row to land on (stashes are commits living off the
    // `refs/stash` tree, visible under `--all` / fullGraph).
    const onStashTab = state.activeView === 'stash' ||
      (state.focus === 'sidebar' && state.sidebarTab === 'stashes')
    if (!onBranchTab && !onTagTab && !onStashTab) return cancelPendingLoad

    let targetHash: string | undefined
    let targetLabel: string | undefined

    if (onBranchTab) {
      const branch = getSelectedBranch(state, context)
      if (branch) {
        targetHash = branch.hash
        targetLabel = `branch ${branch.shortName}`
      }
    } else if (onTagTab) {
      const tag = getSelectedTag(state, context)
      if (tag) {
        targetHash = tag.hash
        targetLabel = `tag ${tag.name}`
      }
    } else if (onStashTab) {
      const stash = getSelectedStash(state, context)
      if (stash) {
        // Two-step fallback chain for stash cursor sync:
        //
        //   1. Try `baseHash` (the branch tip the stash was created
        //      from). This answers the user-visible question "where
        //      in larger git history was this stash made?" — that's
        //      the branch origin point, not the stash's own merge-
        //      commit row off in `refs/stash`. Base commits live on
        //      regular branches so they're almost always in the
        //      loaded window.
        //
        //   2. If `baseHash` isn't in the loaded window (the stash's
        //      base branch was deleted, or the base is older than
        //      the 1000-commit cap), fall back to `stash.hash`
        //      itself. The stash commit was added as an extraRef so
        //      it's reachable from the graph if it fits the window.
        //
        // Only after BOTH miss does the effect report "tip not in
        // loaded window." The label flips to mention "base" vs the
        // stash commit so the user knows what they're looking at.
        // hashesMatchAny handles the short-hash auto-extension
        // mismatch between `git stash list --format=%h` (stash hash)
        // and `git log --pretty=format:%h` (history row). Same
        // hazard as the branch/tag cursor sync — see src/git/hashes.ts.
        const baseLoaded = Boolean(stash.baseHash) && state.filteredCommits.some((c) =>
          hashesMatchAny(stash.baseHash, [c.hash, c.shortHash])
        )
        const hashLoaded = state.filteredCommits.some((c) =>
          hashesMatchAny(stash.hash, [c.hash, c.shortHash])
        )
        if (baseLoaded) {
          targetHash = stash.baseHash
          targetLabel = `${stash.ref}'s base`
        } else if (hashLoaded) {
          targetHash = stash.hash
          targetLabel = stash.ref
        } else {
          // Neither in window — set to baseHash so the standard
          // "not in loaded window" message fires with a meaningful
          // label (the base is what the user actually wants to see).
          targetHash = stash.baseHash || stash.hash
          targetLabel = stash.ref
        }
      }
    }

    // Delegate the actual decision to the pure resolver so the
    // logic is testable in isolation. The effect just performs the
    // resolver's chosen action.
    const decision = resolveCursorSyncDecision({
      target: targetHash ? { hash: targetHash, label: targetLabel || targetHash } : undefined,
      loadedHashes: buildLoadedHashSet(state.filteredCommits),
      lastSyncedHash: lastSyncedHashRef.current,
      attemptedContextHashes: attemptedContextHashesRef.current,
    })

    switch (decision.type) {
      case 'noop':
        return cancelPendingLoad
      case 'jump':
        lastSyncedHashRef.current = decision.hash
        dispatch({ type: 'selectCommitByHash', hash: decision.hash })
        dispatch({
          type: 'setStatus',
          value: `Synced history to ${decision.label} tip`,
        })
        return cancelPendingLoad
      case 'load-context': {
        // Debounced (#2209): holding `j` through old tags used to start
        // a `git log` for every row passed. The fetch fires only once the
        // cursor rests; a move before then re-runs this effect, whose
        // cleanup cancels the pending one.
        //
        // The hash is marked attempted when the fetch fires, not before,
        // so a cancelled one is retried when the cursor comes back. Once
        // marked, a re-fire while the load is in flight (state.filteredCommits
        // change) sees it and returns `noop` instead of a duplicate request;
        // on completion the appendRows triggers a final re-fire that
        // either jumps or returns `unreachable`.
        const target = decision.target
        pendingLoad = setTimeout(() => {
          pendingLoad = undefined
          attemptedContextHashesRef.current.add(target.hash)
          void loadCommitContextRef.current?.(target)?.then((outcome) => {
            // A superseded fetch's rows were dropped, so the hash was never
            // loaded: un-mark it, or returning to this ref would resolve to
            // "unreachable" instead of fetching it again.
            if (outcome && outcome.superseded) attemptedContextHashesRef.current.delete(target.hash)
          })
        }, CURSOR_SYNC_LOAD_DEBOUNCE_MS)
        return cancelPendingLoad
      }
      case 'unreachable':
        dispatch({
          type: 'setStatus',
          value: `${decision.target.label} target commit is unreachable — not in any walked ref's history.`,
          kind: 'warning',
        })
        return cancelPendingLoad
    }
    // The dependency list is deliberately field-by-field rather than the whole
    // `state` / `context`: this effect jumps the history cursor, so it must
    // not re-run on unrelated state churn. It must, however, list EVERYTHING
    // `getSelectedBranch` / `getSelectedTag` / `getSelectedStash` read. Those
    // resolve by ID first and fall back to the index, so the `selected*Id`
    // fields are inputs too (#2203): leaving them out meant an id change that
    // kept the same index (e.g. a reset to row 0) resolved a different row
    // without the sync ever re-running.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dispatch, context.branches, context.tags, context.stashes,
    state.activeView, state.focus, state.sidebarTab,
    state.selectedBranchIndex, state.selectedTagIndex, state.selectedStashIndex,
    state.selectedBranchId, state.selectedTagId, state.selectedStashId,
    state.branchSort, state.tagSort, state.filter,
    state.filteredCommits,
  ])

  // Reset the dedup ref when the user moves focus away from the
  // sidebar branches / tags / stashes tab so re-entering re-fires the
  // sync even if the cursored row is the same as before.
  React.useEffect(() => {
    const onBranchTab = state.activeView === 'branches' ||
      (state.focus === 'sidebar' && state.sidebarTab === 'branches')
    const onTagTab = state.activeView === 'tags' ||
      (state.focus === 'sidebar' && state.sidebarTab === 'tags')
    const onStashTab = state.activeView === 'stash' ||
      (state.focus === 'sidebar' && state.sidebarTab === 'stashes')
    if (!onBranchTab && !onTagTab && !onStashTab) {
      lastSyncedHashRef.current = undefined
      // Drop any context-load attempt tracking too. If the user
      // navigates back later we want to retry rather than show
      // "unreachable" based on a stale attempted-set.
      attemptedContextHashesRef.current = new Set()
    }
  }, [state.activeView, state.focus, state.sidebarTab])

  return loadCommitContextRef
}
