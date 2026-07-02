/**
 * Filtered promoted-view lists (#808, extracted in 0.72 app.ts
 * decomposition).
 *
 * Each promoted surface (branches, tags, stashes, worktrees, reflog,
 * submodules, remotes, issues, PR triage) renders `context.<list>`
 * narrowed by the live `state.filter`. These derivations used to live as
 * nine inline `useMemo`s in `app.ts`; they were recomputed inside
 * `useInput` on every keystroke before #808 memoized them, and have now
 * been lifted out of the component entirely into this pure core plus a
 * thin hook so `app.ts` stops carrying the per-list filter logic.
 *
 * The filter predicate (`matchesPromotedFilter`) and the per-surface
 * match-field arrays are reproduced verbatim from the original memos —
 * this is a behavior-preserving move, not a rewrite.
 */

import type * as ReactTypes from 'react'
import type { LogInkContext } from '../types'
import { matchesPromotedFilter } from '../promotedFilter'
import {
  DEFAULT_BRANCH_SORT_MODE,
  DEFAULT_TAG_SORT_MODE,
  sortBranches,
  sortTags,
  type BranchSortMode,
  type TagSortMode,
} from '../../chrome/sorting'

// Element types are derived from `LogInkContext` via indexed access so
// they track the real overview shapes (BranchRef, GitTagRef, StashEntry,
// WorktreeEntry, ReflogViewEntry, SubmoduleEntry, RemoteEntry,
// IssueListItem, PullRequestListItem) without re-importing each one and
// risking drift.
type BranchListItem = NonNullable<LogInkContext['branches']>['localBranches'][number]
type TagListItem = NonNullable<LogInkContext['tags']>['tags'][number]
type StashListItem = NonNullable<LogInkContext['stashes']>['stashes'][number]
type WorktreeListItem = NonNullable<LogInkContext['worktreeList']>['worktrees'][number]
type ReflogListItem = NonNullable<LogInkContext['reflog']>['entries'][number]
type SubmoduleListItem = NonNullable<LogInkContext['submodules']>['entries'][number]
type RemoteListItem = NonNullable<LogInkContext['remotes']>['entries'][number]
type IssueListItemType = NonNullable<NonNullable<LogInkContext['issueList']>['issues']>[number]
type PullRequestListItemType =
  NonNullable<NonNullable<LogInkContext['pullRequestList']>['pullRequests']>[number]

export type FilteredListSorts = {
  /** `state.branchSort` — branches are sorted BEFORE filtering so the
   * cursor index means the same row everywhere. */
  branchSort?: BranchSortMode
  /** `state.tagSort` — same contract as `branchSort`. */
  tagSort?: TagSortMode
}

export type FilteredLists = {
  filteredBranchList: BranchListItem[]
  filteredTagList: TagListItem[]
  filteredStashList: StashListItem[]
  filteredWorktreeList: WorktreeListItem[]
  filteredReflogList: ReflogListItem[]
  filteredSubmoduleList: SubmoduleListItem[]
  filteredRemoteList: RemoteListItem[]
  filteredIssueList: IssueListItemType[]
  filteredPullRequestTriageList: PullRequestListItemType[]
}

/**
 * Pure derivation of every filtered promoted-view list from the loaded
 * `context` and the active `filter`. A missing `context.*` slice yields
 * `[]`; an empty/undefined filter returns the full list. The filter
 * logic — including the multi-field match arrays for issues and PRs — is
 * lifted verbatim from the original `app.ts` memos.
 */
export function buildFilteredLists(
  context: LogInkContext,
  filter: string | undefined,
  sorts: FilteredListSorts = {},
): FilteredLists {
  // Branches and tags are SORTED before filtering, with the same
  // comparators the surfaces render with (current-branch-first +
  // sort mode). Every consumer of these lists indexes them with the
  // shared cursor (`selectedBranchIndex` / `selectedTagIndex`), so
  // serving the raw for-each-ref order here meant the input-context
  // snapshot, compare-mark, the rebase-onto prompt, and the preview
  // panes all resolved a DIFFERENT row than the one highlighted on
  // screen (the workflow runner sorted correctly — the two disagreed).
  const filteredBranchList = (() => {
    const all = sortBranches(context.branches?.localBranches || [], sorts.branchSort ?? DEFAULT_BRANCH_SORT_MODE)
    if (!filter) return all
    return all.filter((branch) =>
      matchesPromotedFilter([branch.shortName, branch.upstream || ''], filter)
    )
  })()
  const filteredTagList = (() => {
    const all = sortTags(context.tags?.tags || [], sorts.tagSort ?? DEFAULT_TAG_SORT_MODE)
    if (!filter) return all
    return all.filter((tag) =>
      matchesPromotedFilter([tag.name, tag.subject], filter)
    )
  })()
  const filteredStashList = (() => {
    const all = context.stashes?.stashes || []
    if (!filter) return all
    return all.filter((stash) =>
      matchesPromotedFilter([stash.ref, stash.message], filter)
    )
  })()
  const filteredWorktreeList = (() => {
    const all = context.worktreeList?.worktrees || []
    if (!filter) return all
    return all.filter((entry) =>
      matchesPromotedFilter([entry.path, entry.branch || ''], filter)
    )
  })()
  const filteredReflogList = (() => {
    const all = context.reflog?.entries || []
    if (!filter) return all
    return all.filter((entry) =>
      matchesPromotedFilter(
        [entry.selector, entry.hash, entry.relativeDate, entry.subject],
        filter
      )
    )
  })()
  const filteredSubmoduleList = (() => {
    const all = context.submodules?.entries || []
    if (!filter) return all
    return all.filter((entry) =>
      matchesPromotedFilter(
        [entry.name, entry.path, entry.trackingBranch || '', entry.url || ''],
        filter,
      )
    )
  })()
  const filteredRemoteList = (() => {
    const all = context.remotes?.entries || []
    if (!filter) return all
    return all.filter((entry) =>
      matchesPromotedFilter([entry.name, entry.fetchUrl, entry.pushUrl], filter)
    )
  })()
  const filteredIssueList = (() => {
    const all = context.issueList?.issues || []
    if (!filter) return all
    return all.filter((issue) =>
      matchesPromotedFilter(
        [
          `#${issue.number}`,
          issue.title,
          issue.author || '',
          ...(issue.labels || []),
          ...(issue.assignees || []),
        ],
        filter,
      )
    )
  })()
  const filteredPullRequestTriageList = (() => {
    const all = context.pullRequestList?.pullRequests || []
    if (!filter) return all
    return all.filter((pr) =>
      matchesPromotedFilter(
        [
          `#${pr.number}`,
          pr.title,
          pr.author || '',
          pr.headRefName,
          pr.baseRefName,
          ...(pr.labels || []),
          ...(pr.assignees || []),
        ],
        filter,
      )
    )
  })()

  return {
    filteredBranchList,
    filteredTagList,
    filteredStashList,
    filteredWorktreeList,
    filteredReflogList,
    filteredSubmoduleList,
    filteredRemoteList,
    filteredIssueList,
    filteredPullRequestTriageList,
  }
}

/**
 * Thin hook wrapper. Issues one `React.useMemo` per list — preserving the
 * exact hook call-order and per-list dependency arrays of the original
 * `app.ts` memos so React's hook ordering and reference-identity
 * semantics are unchanged. Each memo delegates to `buildFilteredLists`
 * (recomputing only its own list) and returns the destructurable bundle.
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */
export function useFilteredLists(
  React: typeof ReactTypes,
  context: LogInkContext,
  filter: string | undefined,
  sorts: FilteredListSorts = {},
): FilteredLists {
  const filteredBranchList = React.useMemo(
    () => buildFilteredLists(context, filter, sorts).filteredBranchList,
    [context.branches?.localBranches, filter, sorts.branchSort]
  )
  const filteredTagList = React.useMemo(
    () => buildFilteredLists(context, filter, sorts).filteredTagList,
    [context.tags?.tags, filter, sorts.tagSort]
  )
  const filteredStashList = React.useMemo(
    () => buildFilteredLists(context, filter).filteredStashList,
    [context.stashes?.stashes, filter]
  )
  const filteredWorktreeList = React.useMemo(
    () => buildFilteredLists(context, filter).filteredWorktreeList,
    [context.worktreeList?.worktrees, filter]
  )
  const filteredReflogList = React.useMemo(
    () => buildFilteredLists(context, filter).filteredReflogList,
    [context.reflog?.entries, filter]
  )
  const filteredSubmoduleList = React.useMemo(
    () => buildFilteredLists(context, filter).filteredSubmoduleList,
    [context.submodules?.entries, filter]
  )
  const filteredRemoteList = React.useMemo(
    () => buildFilteredLists(context, filter).filteredRemoteList,
    [context.remotes?.entries, filter]
  )
  const filteredIssueList = React.useMemo(
    () => buildFilteredLists(context, filter).filteredIssueList,
    [context.issueList?.issues, filter]
  )
  const filteredPullRequestTriageList = React.useMemo(
    () => buildFilteredLists(context, filter).filteredPullRequestTriageList,
    [context.pullRequestList?.pullRequests, filter]
  )

  return {
    filteredBranchList,
    filteredTagList,
    filteredStashList,
    filteredWorktreeList,
    filteredReflogList,
    filteredSubmoduleList,
    filteredRemoteList,
    filteredIssueList,
    filteredPullRequestTriageList,
  }
}
