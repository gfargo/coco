import { WorkspaceRepoSummary } from '../../../git/workspaceData'

import {
  filterWorkspaceRepos,
  matchesWorkspaceTab,
  matchesWorkspaceText,
  nextWorkspaceTab,
  previousWorkspaceTab,
  workspaceTabLabel,
  WORKSPACE_TABS,
} from './filter'

function repo(overrides: Partial<WorkspaceRepoSummary>): WorkspaceRepoSummary {
  return {
    path: `/tmp/${overrides.name ?? 'r'}`,
    name: overrides.name ?? 'r',
    branch: overrides.branch ?? 'main',
    ahead: 0,
    behind: 0,
    dirty: 0,
    ...overrides,
  }
}

describe('workspace filter tabs', () => {
  it('cycles forward and backward stably', () => {
    expect(nextWorkspaceTab('all')).toBe('dirty')
    expect(nextWorkspaceTab('pull-requests')).toBe('all')
    expect(previousWorkspaceTab('all')).toBe('pull-requests')
    expect(previousWorkspaceTab('dirty')).toBe('all')
  })

  it('labels each tab', () => {
    expect(WORKSPACE_TABS.map(workspaceTabLabel)).toEqual(['All', 'Dirty', 'Behind', 'PRs'])
  })

  it('all tab matches every repo', () => {
    expect(matchesWorkspaceTab(repo({ name: 'a' }), 'all')).toBe(true)
  })

  it('dirty tab matches repos with at least one porcelain entry', () => {
    expect(matchesWorkspaceTab(repo({ name: 'a', dirty: 0 }), 'dirty')).toBe(false)
    expect(matchesWorkspaceTab(repo({ name: 'a', dirty: 5 }), 'dirty')).toBe(true)
  })

  it('behind tab matches repos that are behind their upstream', () => {
    expect(matchesWorkspaceTab(repo({ name: 'a', behind: 0 }), 'behind')).toBe(false)
    expect(matchesWorkspaceTab(repo({ name: 'a', behind: 2 }), 'behind')).toBe(true)
  })

  it('pull-requests tab requires count > 0 from context', () => {
    const entry = repo({ name: 'a' })
    expect(matchesWorkspaceTab(entry, 'pull-requests')).toBe(false)
    expect(
      matchesWorkspaceTab(entry, 'pull-requests', { pullRequestCounts: { [entry.path]: 0 } })
    ).toBe(false)
    expect(
      matchesWorkspaceTab(entry, 'pull-requests', { pullRequestCounts: { [entry.path]: 3 } })
    ).toBe(true)
  })

  it('filterWorkspaceRepos applies the predicate without mutating input', () => {
    const repos = [
      repo({ name: 'clean', dirty: 0 }),
      repo({ name: 'dirty-1', dirty: 1 }),
      repo({ name: 'dirty-2', dirty: 4 }),
    ]
    expect(filterWorkspaceRepos(repos, 'dirty').map((entry) => entry.name)).toEqual([
      'dirty-1',
      'dirty-2',
    ])
    expect(repos).toHaveLength(3)
  })
})

describe('matchesWorkspaceText', () => {
  it('matches against name, branch and path case-insensitively', () => {
    const entry = repo({ name: 'coco', branch: 'feature/foo', path: '/Users/me/code/coco' })
    expect(matchesWorkspaceText(entry, '')).toBe(true)
    expect(matchesWorkspaceText(entry, 'COCO')).toBe(true)
    expect(matchesWorkspaceText(entry, 'feature')).toBe(true)
    expect(matchesWorkspaceText(entry, 'users/me')).toBe(true)
    expect(matchesWorkspaceText(entry, 'zzz')).toBe(false)
  })
})
