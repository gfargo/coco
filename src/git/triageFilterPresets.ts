/**
 * Canned filter presets for the issue / PR triage TUI views
 * (#882 phase 6). Each preset compiles to the same shape the
 * underlying list fetchers (`getIssueList` / `getPullRequestList`)
 * already accept — there's no new `gh` surface area, just a
 * curated set of common triage angles surfaced as a single
 * keystroke (`f` cycles).
 *
 * The presets are deliberately *not* a 1:1 mirror across the two
 * surfaces:
 *
 *   - Issues have no draft / mergeable concept, so `draft` /
 *     `mergeable` are skipped on the issue list.
 *   - PRs have a `merged` state distinct from `closed`; issues
 *     don't.
 *   - `mine` semantics differ subtly: for issues it tends to
 *     mean "I'm the assignee" (issues are tasks people pick up);
 *     for PRs it means "I'm the author" (PRs are work people
 *     post). The presets bake those in so the user doesn't have
 *     to think about it.
 */

import type { IssueListFilter } from './issuesListData'
import type { PullRequestListFilter } from './pullRequestListData'

export type IssueFilterPreset =
  | 'open'
  | 'closed'
  | 'mine'
  | 'assigned'

export type PullRequestFilterPreset =
  | 'open'
  | 'draft'
  | 'mine'
  | 'assigned'
  | 'closed'
  | 'merged'

/** Cycle order — must match the keystroke walk on `f`. */
export const ISSUE_FILTER_PRESETS: IssueFilterPreset[] = [
  'open',
  'closed',
  'mine',
  'assigned',
]

export const PULL_REQUEST_FILTER_PRESETS: PullRequestFilterPreset[] = [
  'open',
  'draft',
  'mine',
  'assigned',
  'closed',
  'merged',
]

export const ISSUE_FILTER_LABELS: Record<IssueFilterPreset, string> = {
  open: 'open',
  closed: 'closed',
  mine: 'mine (assigned)',
  assigned: 'assigned to me',
}

export const PULL_REQUEST_FILTER_LABELS: Record<PullRequestFilterPreset, string> = {
  open: 'open',
  draft: 'draft',
  mine: 'mine (authored)',
  assigned: 'assigned to me',
  closed: 'closed',
  merged: 'merged',
}

/**
 * Resolve a preset to the filter object the data fetcher accepts.
 * Pure mapping — no `gh` calls. Kept separate from `getIssueList` /
 * `getPullRequestList` so unit tests can assert the mapping
 * independently from the fetch pipeline.
 */
export function issueFilterForPreset(preset: IssueFilterPreset): IssueListFilter {
  switch (preset) {
    case 'open':
      return { state: 'open' }
    case 'closed':
      return { state: 'closed' }
    case 'mine':
      // Issues are tasks — "mine" is what *I'm working on*, i.e.
      // assigned to me + still open. Same as `assigned` plus the
      // open-state filter for ergonomic single-keystroke focus on
      // the active backlog.
      return { state: 'open', assignee: '@me' }
    case 'assigned':
      return { assignee: '@me' }
  }
}

export function pullRequestFilterForPreset(
  preset: PullRequestFilterPreset
): PullRequestListFilter {
  switch (preset) {
    case 'open':
      return { state: 'open' }
    case 'draft':
      // gh's `--draft` flag implies `--state open`; surface that
      // explicitly so the canonicalize step doesn't elide it.
      return { state: 'open', draft: true }
    case 'mine':
      // PRs are work — "mine" is what *I authored*. Most useful
      // when looking at one's own backlog of in-flight PRs.
      return { state: 'open', author: '@me' }
    case 'assigned':
      return { assignee: '@me' }
    case 'closed':
      return { state: 'closed' }
    case 'merged':
      return { state: 'merged' }
  }
}

export function cycleIssueFilterPreset(current: IssueFilterPreset): IssueFilterPreset {
  const index = ISSUE_FILTER_PRESETS.indexOf(current)
  const next = (index + 1) % ISSUE_FILTER_PRESETS.length
  return ISSUE_FILTER_PRESETS[next]
}

export function cyclePullRequestFilterPreset(
  current: PullRequestFilterPreset
): PullRequestFilterPreset {
  const index = PULL_REQUEST_FILTER_PRESETS.indexOf(current)
  const next = (index + 1) % PULL_REQUEST_FILTER_PRESETS.length
  return PULL_REQUEST_FILTER_PRESETS[next]
}
