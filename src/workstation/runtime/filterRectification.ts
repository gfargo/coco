/**
 * Filter-action rectification helpers (extracted from app.ts, #1418
 * decomposition).
 *
 * These pure functions enrich filter-mode reducer actions with a
 * `promotedSelections` snapshot so the reducer can preserve the cursor
 * when the previously-selected item is still in the filtered result.
 *
 * They live in `runtime/` (rather than `chrome/`) because they're tightly
 * coupled to the `LogInkState` filter-mode shape and the reducer's action
 * types. Consumed by `useInputHandler` via the `enrichFilterActionWithRectification`
 * injection point (app.ts passes the function reference through).
 */

import type { LogInkState } from './inkViewModel'
import { applyLogInkAction } from './inkViewModel'
import type { LogInkContext } from './types'
import { PromotedSelectionsSnapshot, rectifyPromotedSelectionIndex } from '../chrome/selectionRectify'
import { sortBranches, sortTags } from '../chrome/sorting'
import { matchesPromotedFilter } from './promotedFilter'

/**
 * Predict what the filter string will be AFTER the given action applies.
 * Returns `undefined` for non-filter actions (no rectification needed).
 */
export function predictNextFilter(
  action: Parameters<typeof applyLogInkAction>[1],
  currentFilter: string
): string | undefined {
  switch (action.type) {
    case 'appendFilter':
      return `${currentFilter}${action.value}`
    case 'backspaceFilter':
      return currentFilter.slice(0, -1)
    case 'clearFilter':
    case 'clearFilterText':
      return ''
    case 'setFilter':
      return action.value
    default:
      return undefined
  }
}

/**
 * Build the post-filter selection snapshot for branches / tags / stash so
 * the reducer can preserve the cursor when the previously-selected item is
 * still in the filtered result. Identifies items by a single key per view
 * (branch shortName, tag name, stash ref) — the same matchesPromotedFilter
 * the surfaces use covers the multi-field haystacks.
 */
export function computePromotedSelectionsSnapshot(
  state: LogInkState,
  context: LogInkContext,
  nextFilter: string
): PromotedSelectionsSnapshot {
  // Sorted with the surfaces' comparators — the cursor indexes the
  // SORTED lists, so rectifying in raw ref order preserved the wrong row.
  const allBranches = sortBranches(context.branches?.localBranches || [], state.branchSort)
  const filteredBranches = nextFilter
    ? allBranches.filter((branch) =>
      matchesPromotedFilter([branch.shortName, branch.upstream || ''], nextFilter))
    : allBranches
  const currentBranches = state.filter
    ? allBranches.filter((branch) =>
      matchesPromotedFilter([branch.shortName, branch.upstream || ''], state.filter))
    : allBranches
  const previousBranchKey = currentBranches[state.selectedBranchIndex]?.shortName
  const branchIndex = rectifyPromotedSelectionIndex(
    filteredBranches.map((branch) => branch.shortName),
    previousBranchKey
  )

  const allTags = sortTags(context.tags?.tags || [], state.tagSort)
  const filteredTags = nextFilter
    ? allTags.filter((tag) => matchesPromotedFilter([tag.name, tag.subject], nextFilter))
    : allTags
  const currentTags = state.filter
    ? allTags.filter((tag) => matchesPromotedFilter([tag.name, tag.subject], state.filter))
    : allTags
  const previousTagKey = currentTags[state.selectedTagIndex]?.name
  const tagIndex = rectifyPromotedSelectionIndex(
    filteredTags.map((tag) => tag.name),
    previousTagKey
  )

  const allStashes = context.stashes?.stashes || []
  const filteredStashes = nextFilter
    ? allStashes.filter((stash) => matchesPromotedFilter([stash.ref, stash.message], nextFilter))
    : allStashes
  const currentStashes = state.filter
    ? allStashes.filter((stash) => matchesPromotedFilter([stash.ref, stash.message], state.filter))
    : allStashes
  const previousStashKey = currentStashes[state.selectedStashIndex]?.ref
  const stashIndex = rectifyPromotedSelectionIndex(
    filteredStashes.map((stash) => stash.ref),
    previousStashKey
  )

  return { branchIndex, tagIndex, stashIndex }
}

/**
 * Enriches a filter action with the cursor-rectification snapshot so the
 * reducer can preserve the selected item across filter changes.
 */
export function enrichFilterActionWithRectification(
  action: Parameters<typeof applyLogInkAction>[1],
  state: LogInkState,
  context: LogInkContext
): Parameters<typeof applyLogInkAction>[1] {
  const nextFilter = predictNextFilter(action, state.filter)
  if (nextFilter === undefined) {
    return action
  }
  const promotedSelections = computePromotedSelectionsSnapshot(state, context, nextFilter)
  switch (action.type) {
    case 'appendFilter':
    case 'setFilter':
      return { ...action, promotedSelections }
    case 'backspaceFilter':
    case 'clearFilter':
    case 'clearFilterText':
      return { ...action, promotedSelections }
    default:
      return action
  }
}
