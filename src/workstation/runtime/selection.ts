/**
 * Id-based selection model (#1452).
 *
 * This module introduces the target selection architecture that will replace
 * the 16 scalar `selected*Index` fields in `LogInkState`. The migration is
 * incremental and per view; branches / tags / stashes have completed all
 * three phases below, the rest are still index-only.
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
 *   1. Dual-write: the move action resolves + writes `selected*Id`
 *      alongside the legacy index; every OTHER action that resets or
 *      rectifies the index clears the id mirror in the same reducer case,
 *      so the two are never allowed to silently disagree.
 *   2. Flip: the selector (`getSelectedBranch` etc.) prefers the id when
 *      it's set and still resolves in the current sorted + filtered list,
 *      falling back to the index otherwise — done for branches / tags /
 *      stashes.
 *   3. Remove the legacy `selected*Index` field once every consumer reads
 *      through the selector (not done yet — the field still backs
 *      rendering / cursor-position reads across the codebase).
 */

import type { GitLogCommitRow } from '../../commands/log/data'
import { getSelectedInkCommit, type LogInkState } from './inkViewModel'
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
 *
 * #1452 flip — `selectedBranchId` is now the preferred source of truth:
 * when set and still present in the sorted + filtered list, it wins
 * (this is what keeps the cursor on the same logical branch across a
 * background context refresh that reorders the list). Falls back to
 * the index when the id is unset (actions that reset/rectify the index
 * clear the id mirror in the same reducer case, precisely so this
 * fallback is always consistent with what's on screen) or when the id
 * no longer resolves to anything visible (branch deleted / filtered
 * out elsewhere).
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
  if (state.selectedBranchId) {
    const byId = visible.find((b) => b.shortName === state.selectedBranchId)
    if (byId) return byId
  }
  const index = Math.min(state.selectedBranchIndex, visible.length - 1)
  return visible[index]
}

/**
 * Resolve the branch targets for a batch-capable (`targets: 'multi'`)
 * workflow (#1361). Deterministic priority ladder:
 *
 *   1. Range active (v-anchor set on the branches view) → the contiguous
 *      anchor..cursor span, resolved POSITIONALLY against the visible
 *      (sorted + filtered) list — a range is what the user sees between
 *      two rows on screen.
 *   2. Marked set non-empty → the x-toggled ids, resolved against the
 *      FULL sorted list in list order. Marks are explicit per-item
 *      choices, so an active filter must not silently drop targets —
 *      the confirm panel names every resolved target either way.
 *   3. Neither → the single cursored branch (existing behavior).
 *
 * Marked ids that no longer resolve (branch deleted by another process,
 * or by an earlier item of the same batch) drop out silently. If the
 * range anchor itself no longer resolves in the visible list, the range
 * rung is skipped rather than guessing at a span.
 */
export function getSelectedBranchBatch(
  state: LogInkState,
  context: LogInkContext,
): BranchRef[] {
  const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
  const selection = state.selection?.view === 'branches' ? state.selection : undefined

  if (selection?.anchorId) {
    const visible = state.filter
      ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], state.filter))
      : all
    const anchorIndex = visible.findIndex((b) => b.shortName === selection.anchorId)
    if (anchorIndex >= 0 && visible.length > 0) {
      const cursorIndex = Math.min(state.selectedBranchIndex, visible.length - 1)
      const [from, to] = anchorIndex <= cursorIndex
        ? [anchorIndex, cursorIndex]
        : [cursorIndex, anchorIndex]
      return visible.slice(from, to + 1)
    }
  }

  if (selection && selection.ids.size > 0) {
    const marked = all.filter((b) => selection.ids.has(b.shortName))
    if (marked.length > 0) return marked
  }

  const single = getSelectedBranch(state, context)
  return single ? [single] : []
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
 * #1452 flip — same id-first, index-fallback resolution as `getSelectedBranch`.
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
  if (state.selectedTagId) {
    const byId = visible.find((t) => t.name === state.selectedTagId)
    if (byId) return byId
  }
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
 * #1452 flip — same id-first, index-fallback resolution as `getSelectedBranch`.
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
  if (state.selectedStashId) {
    const byId = visible.find((s) => s.ref === state.selectedStashId)
    if (byId) return byId
  }
  const index = Math.min(state.selectedStashIndex, visible.length - 1)
  return visible[index]
}

/**
 * Resolve the stash targets for a batch-capable workflow (#1361). Same
 * priority ladder as `getSelectedBranchBatch`: range → marks → cursored
 * single. The caller (`dropStashes`) is responsible for the
 * descending-`stash@{N}`-order drop discipline — this selector just
 * resolves WHICH stashes, in list (chronological) order, matching how
 * the confirm panel names them.
 */
export function getSelectedStashBatch(
  state: LogInkState,
  context: LogInkContext,
): StashEntry[] {
  const all = context.stashes?.stashes || []
  const selection = state.selection?.view === 'stash' ? state.selection : undefined

  if (selection?.anchorId) {
    const visible = state.filter
      ? all.filter((s) => matchesPromotedFilter([s.ref, s.message], state.filter))
      : all
    const anchorIndex = visible.findIndex((s) => s.ref === selection.anchorId)
    if (anchorIndex >= 0 && visible.length > 0) {
      const cursorIndex = Math.min(state.selectedStashIndex, visible.length - 1)
      const [from, to] = anchorIndex <= cursorIndex
        ? [anchorIndex, cursorIndex]
        : [cursorIndex, anchorIndex]
      return visible.slice(from, to + 1)
    }
  }

  if (selection && selection.ids.size > 0) {
    const marked = all.filter((s) => selection.ids.has(s.ref))
    if (marked.length > 0) return marked
  }

  const single = getSelectedStash(state, context)
  return single ? [single] : []
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
 *
 * Falls back to indexing the unfiltered list when the active filter hides
 * every worktree — a worktree action reachable from the palette (rather
 * than from the worktrees view itself) can fire with a stale filter still
 * applied, and the cursor should still resolve to something rather than
 * silently going target-less.
 */
export function getSelectedWorktree(
  state: LogInkState,
  context: LogInkContext,
): WorktreeEntry | undefined {
  const all = context.worktreeList?.worktrees || []
  const visible = state.filter
    ? all.filter((w) => matchesPromotedFilter([w.path, w.branch || ''], state.filter))
    : all
  if (visible.length > 0) {
    return visible[Math.min(state.selectedWorktreeListIndex, visible.length - 1)]
  }
  if (all.length === 0) return undefined
  return all[Math.min(state.selectedWorktreeListIndex, all.length - 1)]
}

/**
 * Confirmable workflow ids whose target is the cursored HISTORY commit,
 * not a promoted-view list item. Everything list-shaped (branch/tag/
 * stash/worktree deletes and checkouts) resolves through the selectors
 * above; this is the commit-target counterpart, used by
 * `describeConfirmationTarget` (overlays.ts) to name the confirm
 * target so the user never confirms blind.
 */
const COMMIT_TARGET_CONFIRMATION_IDS = new Set([
  'cherry-pick-commit',
  'revert-commit',
  'interactive-rebase',
  'reset-to-commit',
  'fixup-into-commit',
  'autosquash-rebase',
])

/**
 * Get the cursored commit when `id` is one of the commit-target
 * confirmation workflows, or undefined otherwise (either `id` isn't a
 * commit-target workflow, or no commit is under the cursor).
 */
export function getSelectedCommitTarget(
  id: string | undefined,
  state: LogInkState,
): GitLogCommitRow | undefined {
  if (!id || !COMMIT_TARGET_CONFIRMATION_IDS.has(id)) return undefined
  return getSelectedInkCommit(state)
}
