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

/**
 * Tab glyphs — semantic, color-paired in the renderer:
 *   ◯ All     (neutral / circle)
 *   ● Dirty   (warn / filled)
 *   ↓ Behind  (warn / down)
 *   ⊙ PRs     (accent / target)
 *
 * Used in two places: as a label prefix in the expanded sidebar,
 * and as the standalone icon when the sidebar is rail-collapsed at
 * narrow terminal widths.
 *
 * ASCII fallback isn't wired through yet — none of these glyphs
 * affect layout (they're width-1), so even on `TERM=dumb` they
 * render as best the terminal can. Add a `theme.ascii`-aware lookup
 * here if we hit a real environment where the unicode breaks.
 */
const TAB_GLYPHS: Record<WorkspaceTab, string> = {
  all: '◯',
  dirty: '●',
  behind: '↓',
  'pull-requests': '⊙',
}

export function workspaceTabLabel(tab: WorkspaceTab): string {
  return TAB_LABELS[tab]
}

export function workspaceTabGlyph(tab: WorkspaceTab): string {
  return TAB_GLYPHS[tab]
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
