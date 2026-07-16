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

function rectifyEntry(id: string | undefined, visibleKeys: string[]): RefreshRectificationEntry | undefined {
  if (!id) {
    return undefined
  }
  const index = visibleKeys.indexOf(id)
  return index >= 0 ? { index } : { clear: true }
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
  const allBranches = sortBranches(context.branches?.localBranches || [], state.branchSort)
  const visibleBranches = state.filter
    ? allBranches.filter((branch) =>
      matchesPromotedFilter([branch.shortName, branch.upstream || ''], state.filter))
    : allBranches
  const branch = rectifyEntry(state.selectedBranchId, visibleBranches.map((b) => b.shortName))

  const allTags = sortTags(context.tags?.tags || [], state.tagSort)
  const visibleTags = state.filter
    ? allTags.filter((tag) => matchesPromotedFilter([tag.name, tag.subject], state.filter))
    : allTags
  const tag = rectifyEntry(state.selectedTagId, visibleTags.map((t) => t.name))

  const allStashes = context.stashes?.stashes || []
  const visibleStashes = state.filter
    ? allStashes.filter((stash) => matchesPromotedFilter([stash.ref, stash.message], state.filter))
    : allStashes
  const stash = rectifyEntry(state.selectedStashId, visibleStashes.map((s) => s.ref))

  const allWorktrees = context.worktreeList?.worktrees || []
  const visibleWorktrees = state.filter
    ? allWorktrees.filter((entry) => matchesPromotedFilter([entry.path, entry.branch || ''], state.filter))
    : allWorktrees
  const worktreeList = rectifyEntry(state.selectedWorktreeListId, visibleWorktrees.map((w) => w.path))

  const allSubmodules = context.submodules?.entries || []
  const visibleSubmodules = state.filter
    ? allSubmodules.filter((entry) =>
      matchesPromotedFilter(
        [entry.name, entry.path, entry.trackingBranch || '', entry.url || ''],
        state.filter,
      ))
    : allSubmodules
  const submodule = rectifyEntry(state.selectedSubmoduleId, visibleSubmodules.map((s) => s.path))

  const allRemotes = context.remotes?.entries || []
  const visibleRemotes = state.filter
    ? allRemotes.filter((entry) => matchesPromotedFilter([entry.name, entry.fetchUrl, entry.pushUrl], state.filter))
    : allRemotes
  const remote = rectifyEntry(state.selectedRemoteId, visibleRemotes.map((r) => r.name))

  return { branch, tag, stash, worktreeList, submodule, remote }
}

/** True when the snapshot has at least one view to rectify — lets the caller skip a no-op dispatch. */
export function hasRefreshRectification(snapshot: RefreshRectificationSnapshot): boolean {
  return Boolean(
    snapshot.branch || snapshot.tag || snapshot.stash ||
    snapshot.worktreeList || snapshot.submodule || snapshot.remote
  )
}
