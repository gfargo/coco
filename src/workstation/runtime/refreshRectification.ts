/**
 * Refresh-rectification helpers (OSS-1001 / #1671).
 *
 * `moveBranch`/`moveTag`/`moveStash`/`moveWorktreeListEntry`/`moveSubmodule`/
 * `moveRemote` dual-write `selected*Id` alongside `selected*Index` (#1452),
 * and the selectors in `selection.ts` prefer the id. But a background
 * context refresh (`useContextRefresh.refreshContext`, driven by
 * `useRefreshWatcher` or a post-workflow reload) only replaces
 * `LogInkContext` — it never touches the reducer, so `selected*Index` goes
 * stale the moment the refresh reorders, inserts, or removes rows. Every
 * renderer and `useInputHandler`'s `branchSelectedShortName` (etc.) still
 * read the raw index, so the on-screen highlight and the id-first
 * `useWorkflowAction` target silently diverge until the next cursor move.
 *
 * These pure functions compute, for each `selected*Id`-bearing view, where
 * that id now sits in the freshly sorted + filtered list — so the caller
 * can re-sync the index to it (or clear the id when it no longer resolves)
 * in the same tick the new context lands. No id set → nothing to
 * rectify for that view.
 *
 * The sort + filter logic mirrors `buildFilteredLists.ts` / `selection.ts`
 * verbatim (same comparators, same per-view haystacks) — a mismatch there
 * would rectify the index to the wrong row.
 */

import type { LogInkState } from './inkViewModel'
import type { LogInkContext } from './types'
import { sortBranches, sortTags } from '../chrome/sorting'
import { matchesPromotedFilter } from './promotedFilter'

/** Either "the id now resolves at this index" or "the id no longer resolves — clear it". */
export type RefreshRectificationEntry =
  | { index: number }
  | { clear: true }

export type RefreshRectificationSnapshot = {
  branch?: RefreshRectificationEntry
  tag?: RefreshRectificationEntry
  stash?: RefreshRectificationEntry
  worktreeList?: RefreshRectificationEntry
  submodule?: RefreshRectificationEntry
  remote?: RefreshRectificationEntry
}

/**
 * `allKeys`, when passed, is the corresponding selector's unfiltered-list
 * fallback tier (worktree/submodule/remote only — see `getSelectedWorktree`
 * et al. in `selection.ts`). When the id isn't in the filtered `visibleKeys`
 * but still resolves in `allKeys`, the selector would still find it via that
 * fallback, so we leave the view out of the snapshot entirely (`undefined`)
 * rather than clearing a still-valid id.
 */
function rectifyEntry(
  id: string | undefined,
  visibleKeys: string[],
  allKeys?: string[],
): RefreshRectificationEntry | undefined {
  if (!id) {
    return undefined
  }
  const index = visibleKeys.indexOf(id)
  if (index >= 0) {
    return { index }
  }
  if (allKeys && allKeys.includes(id)) {
    return undefined
  }
  return { clear: true }
}

/**
 * Compute the post-refresh rectification snapshot for every
 * id-bearing promoted view. `context` is the FRESH context (the refresh's
 * result) — `state` is the live reducer state at the moment the refresh
 * lands (read through a ref by the caller, not a stale render closure).
 */
export function computeRefreshRectificationSnapshot(
  state: LogInkState,
  context: LogInkContext,
): RefreshRectificationSnapshot {
  // A section that's entirely absent (as opposed to present with an empty
  // list) means THIS refresh's fetch for it failed and `safe()` swallowed
  // the error (see `useContextRefresh.loadLogInkContext`) — a transient
  // hiccup (e.g. a flaky git submodule subprocess), not evidence the row
  // is actually gone. Skip rectifying that view entirely rather than
  // treating the failure as "zero rows", which would otherwise clear a
  // still-valid id. Unlike the context merge itself (which self-heals on
  // the next successful refresh), a cleared id has no such recovery.
  const branch = context.branches
    ? rectifyEntry(
      state.selectedBranchId,
      (() => {
        const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
        const visible = state.filter
          ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], state.filter))
          : all
        return visible.map((b) => b.shortName)
      })(),
    )
    : undefined

  const tag = context.tags
    ? rectifyEntry(
      state.selectedTagId,
      (() => {
        const all = sortTags(context.tags?.tags || [], state.tagSort)
        const visible = state.filter
          ? all.filter((t) => matchesPromotedFilter([t.name, t.subject], state.filter))
          : all
        return visible.map((t) => t.name)
      })(),
    )
    : undefined

  const stash = context.stashes
    ? rectifyEntry(
      state.selectedStashId,
      (() => {
        const all = context.stashes?.stashes || []
        const visible = state.filter
          ? all.filter((s) => matchesPromotedFilter([s.ref, s.message], state.filter))
          : all
        return visible.map((s) => s.ref)
      })(),
    )
    : undefined

  const worktreeList = context.worktreeList
    ? (() => {
      const all = context.worktreeList?.worktrees || []
      const visible = state.filter
        ? all.filter((entry) => matchesPromotedFilter([entry.path, entry.branch || ''], state.filter))
        : all
      return rectifyEntry(state.selectedWorktreeListId, visible.map((w) => w.path), all.map((w) => w.path))
    })()
    : undefined

  const submodule = context.submodules
    ? (() => {
      const all = context.submodules?.entries || []
      const visible = state.filter
        ? all.filter((entry) =>
          matchesPromotedFilter(
            [entry.name, entry.path, entry.trackingBranch || '', entry.url || ''],
            state.filter,
          ))
        : all
      return rectifyEntry(state.selectedSubmoduleId, visible.map((s) => s.path), all.map((s) => s.path))
    })()
    : undefined

  const remote = context.remotes
    ? (() => {
      const all = context.remotes?.entries || []
      const visible = state.filter
        ? all.filter((entry) => matchesPromotedFilter([entry.name, entry.fetchUrl, entry.pushUrl], state.filter))
        : all
      return rectifyEntry(state.selectedRemoteId, visible.map((r) => r.name), all.map((r) => r.name))
    })()
    : undefined

  return { branch, tag, stash, worktreeList, submodule, remote }
}

/** True when the snapshot has at least one view to rectify — lets the caller skip a no-op dispatch. */
export function hasRefreshRectification(snapshot: RefreshRectificationSnapshot): boolean {
  return Boolean(
    snapshot.branch || snapshot.tag || snapshot.stash ||
    snapshot.worktreeList || snapshot.submodule || snapshot.remote
  )
}
