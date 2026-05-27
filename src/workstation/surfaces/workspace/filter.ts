import type { WorkspaceRepoSummary } from '../../../git/workspaceData'

/**
 * Sidebar tabs for the workspace surface. Each tab is a predicate on
 * the repo summary plus an optional dependency on PR data — tabs whose
 * predicate would yield zero rows in absence of PR data are gated so
 * the surface can dim them rather than show empty lists.
 */
export const WORKSPACE_TABS = ['all', 'dirty', 'behind', 'pull-requests'] as const

export type WorkspaceTab = (typeof WORKSPACE_TABS)[number]

const TAB_LABELS: Record<WorkspaceTab, string> = {
  all: 'All',
  dirty: 'Dirty',
  behind: 'Behind',
  'pull-requests': 'PRs',
}

export function workspaceTabLabel(tab: WorkspaceTab): string {
  return TAB_LABELS[tab]
}

export function nextWorkspaceTab(current: WorkspaceTab): WorkspaceTab {
  const idx = WORKSPACE_TABS.indexOf(current)
  return WORKSPACE_TABS[(idx + 1) % WORKSPACE_TABS.length]
}

export function previousWorkspaceTab(current: WorkspaceTab): WorkspaceTab {
  const idx = WORKSPACE_TABS.indexOf(current)
  return WORKSPACE_TABS[(idx - 1 + WORKSPACE_TABS.length) % WORKSPACE_TABS.length]
}

export type WorkspaceTabContext = {
  pullRequestCounts?: Readonly<Record<string, number>>
}

export function matchesWorkspaceTab(
  repo: WorkspaceRepoSummary,
  tab: WorkspaceTab,
  context: WorkspaceTabContext = {}
): boolean {
  switch (tab) {
    case 'all':
      return true
    case 'dirty':
      return repo.dirty > 0
    case 'behind':
      return repo.behind > 0
    case 'pull-requests': {
      const count = context.pullRequestCounts?.[repo.path] ?? 0
      return count > 0
    }
    default:
      return true
  }
}

export function filterWorkspaceRepos(
  repos: ReadonlyArray<WorkspaceRepoSummary>,
  tab: WorkspaceTab,
  context: WorkspaceTabContext = {}
): WorkspaceRepoSummary[] {
  return repos.filter((entry) => matchesWorkspaceTab(entry, tab, context))
}

/**
 * Case-insensitive substring match against the repo name + branch.
 * Used by the surface's filter prompt; the surface decides whether to
 * also apply the sidebar tab filter on top.
 */
export function matchesWorkspaceText(repo: WorkspaceRepoSummary, query: string): boolean {
  if (!query) {
    return true
  }
  const haystack = [repo.name, repo.branch ?? '', repo.path].join('').toLowerCase()
  return haystack.includes(query.toLowerCase())
}
