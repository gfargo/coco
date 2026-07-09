/**
 * Id-based selection model (#1452).
 *
 * This module introduces the target selection architecture that will replace
 * the 16 scalar `selected*Index` fields in `LogInkState`. The migration is
 * incremental: each view converts one at a time, and during the transition
 * the legacy index fields remain the source of truth while these selectors
 * provide an id-based read interface over them.
 *
 * Design:
 *   - A selection is a set of ids (not indexes) scoped to a view
 *   - A cursor is a selection of size 1 (the current state for all views)
 *   - Multi-select (#1361) extends to size N without changing the model
 *   - Ids are stable across filter/sort/refresh changes (branch shortName,
 *     tag name, stash ref, commit hash, etc.)
 *   - The `anchorId` supports range-select (shift+j/k)
 *
 * Migration path (per view):
 *   1. Use `getSelectedItemId()` to read the selection by id
 *   2. Convert the move action to write through the new model
 *   3. Remove the legacy `selected*Index` field once all consumers migrated
 */

import type { LogInkState } from './inkViewModel'
import type { LogInkContext } from './types'
import type { BranchRef } from '../../git/branchData'
import type { GitTagRef } from '../../git/tagData'
import type { StashEntry } from '../../git/stashData'
import type { WorktreeEntry } from '../../git/worktreeData'
import { sortBranches, sortTags } from '../chrome/sorting'
import { matchesPromotedFilter } from './promotedFilter'

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The target id-based selection model. Not yet stored in state — during
 * the transition, these types define the interface selectors return and
 * future state will carry.
 */
export type LogInkSelection = {
  /** Which view this selection belongs to. */
  view: string
  /** The primary (cursor) item id. */
  cursorId: string | undefined
  /**
   * Anchor for range-select. When set, the selection spans from
   * `anchorId` to `cursorId` inclusive. Undefined = no range active.
   */
  anchorId?: string
  /**
   * All selected item ids. For a cursor (single selection), this is
   * a set of size 0-1. For multi-select, size N.
   */
  ids: ReadonlySet<string>
}

// ─── Selectors (read interface over legacy index state) ───────────────────────

/**
 * Get the currently-selected branch's shortName, or undefined if the
 * branch list is empty or the index is out of range.
 *
 * This is the id-based read interface for the branches view — it
 * replaces inline `filteredBranchList[Math.min(state.selectedBranchIndex, ...)]`
 * resolution scattered across inkInput, useWorkflowAction, and surfaces.
 */
export function getSelectedBranchId(
  state: LogInkState,
  context: LogInkContext,
): string | undefined {
  return getSelectedBranch(state, context)?.shortName
}

/**
 * Get the full BranchRef for the currently-selected branch.
 * Returns the item from the sorted + filtered list at the selected index.
 */
export function getSelectedBranch(
  state: LogInkState,
  context: LogInkContext,
): BranchRef | undefined {
  const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
  const visible = state.filter
    ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], state.filter))
    : all
  if (visible.length === 0) return undefined
  const index = Math.min(state.selectedBranchIndex, visible.length - 1)
  return visible[index]
}

/**
 * Get the currently-selected tag's name.
 */
export function getSelectedTagId(
  state: LogInkState,
  context: LogInkContext,
): string | undefined {
  return getSelectedTag(state, context)?.name
}

/**
 * Get the full GitTagRef for the currently-selected tag.
 */
export function getSelectedTag(
  state: LogInkState,
  context: LogInkContext,
): GitTagRef | undefined {
  const all = sortTags(context.tags?.tags || [], state.tagSort)
  const visible = state.filter
    ? all.filter((t) => matchesPromotedFilter([t.name, t.subject], state.filter))
    : all
  if (visible.length === 0) return undefined
  const index = Math.min(state.selectedTagIndex, visible.length - 1)
  return visible[index]
}

/**
 * Get the currently-selected stash's ref.
 */
export function getSelectedStashId(
  state: LogInkState,
  context: LogInkContext,
): string | undefined {
  return getSelectedStash(state, context)?.ref
}

/**
 * Get the full StashEntry for the currently-selected stash.
 */
export function getSelectedStash(
  state: LogInkState,
  context: LogInkContext,
): StashEntry | undefined {
  const all = context.stashes?.stashes || []
  const visible = state.filter
    ? all.filter((s) => matchesPromotedFilter([s.ref, s.message], state.filter))
    : all
  if (visible.length === 0) return undefined
  const index = Math.min(state.selectedStashIndex, visible.length - 1)
  return visible[index]
}

/**
 * Get the currently-selected worktree's path.
 */
export function getSelectedWorktreeId(
  state: LogInkState,
  context: LogInkContext,
): string | undefined {
  return getSelectedWorktree(state, context)?.path
}

/**
 * Get the full WorktreeEntry for the currently-selected worktree.
 */
export function getSelectedWorktree(
  state: LogInkState,
  context: LogInkContext,
): WorktreeEntry | undefined {
  const all = context.worktreeList?.worktrees || []
  const visible = state.filter
    ? all.filter((w) => matchesPromotedFilter([w.path, w.branch || ''], state.filter))
    : all
  if (visible.length === 0) return undefined
  const index = Math.min(state.selectedWorktreeListIndex, visible.length - 1)
  return visible[index]
}
