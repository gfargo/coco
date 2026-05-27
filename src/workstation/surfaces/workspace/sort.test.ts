import { WorkspaceRepoSummary } from '../../../git/workspaceData'

import {
  nextWorkspaceSortMode,
  sortWorkspaceRepos,
  workspaceSortLabel,
  WORKSPACE_SORT_MODES,
  type WorkspaceSortMode,
} from './sort'

function repo(overrides: Partial<WorkspaceRepoSummary>): WorkspaceRepoSummary {
  return {
    path: `/tmp/${overrides.name ?? 'r'}`,
    name: overrides.name ?? 'r',
    branch: 'main',
    ahead: 0,
    behind: 0,
    dirty: 0,
    ...overrides,
  }
}

describe('workspace sort', () => {
  it('cycles through the sort modes in a stable order', () => {
    let mode: WorkspaceSortMode = WORKSPACE_SORT_MODES[0]
    const seen: string[] = []
    for (let i = 0; i < WORKSPACE_SORT_MODES.length + 1; i++) {
      seen.push(mode)
      mode = nextWorkspaceSortMode(mode)
    }
    expect(seen).toEqual(['recency', 'name', 'dirty', 'recency'])
  })

  it('labels each mode with a one-word display string', () => {
    expect(workspaceSortLabel('recency')).toBe('Recent')
    expect(workspaceSortLabel('name')).toBe('Name')
    expect(workspaceSortLabel('dirty')).toBe('Dirty')
  })

  it('sorts by name alphabetically', () => {
    const out = sortWorkspaceRepos(
      [repo({ name: 'gamma' }), repo({ name: 'alpha' }), repo({ name: 'beta' })],
      'name'
    )
    expect(out.map((entry) => entry.name)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('sorts by recency with newer first; ties fall back to name', () => {
    const out = sortWorkspaceRepos(
      [
        repo({ name: 'old', lastCommit: { hash: 'a', date: '2024-01-01', subject: 'x' } }),
        repo({ name: 'newer', lastCommit: { hash: 'b', date: '2026-01-01', subject: 'x' } }),
        repo({ name: 'same-a', lastCommit: { hash: 'c', date: '2025-06-01', subject: 'x' } }),
        repo({ name: 'same-b', lastCommit: { hash: 'd', date: '2025-06-01', subject: 'x' } }),
        repo({ name: 'no-commit' }),
      ],
      'recency'
    )
    expect(out.map((entry) => entry.name)).toEqual([
      'newer',
      'same-a',
      'same-b',
      'old',
      'no-commit',
    ])
  })

  it('sorts by dirty count desc with recency tiebreaker', () => {
    const out = sortWorkspaceRepos(
      [
        repo({ name: 'clean', dirty: 0 }),
        repo({ name: 'a-bit-dirty', dirty: 2, lastCommit: { hash: 'a', date: '2025-01-01', subject: 'x' } }),
        repo({ name: 'very-dirty', dirty: 8, lastCommit: { hash: 'b', date: '2025-01-01', subject: 'x' } }),
        repo({ name: 'also-dirty', dirty: 2, lastCommit: { hash: 'c', date: '2026-01-01', subject: 'x' } }),
      ],
      'dirty'
    )
    expect(out.map((entry) => entry.name)).toEqual([
      'very-dirty',
      'also-dirty',
      'a-bit-dirty',
      'clean',
    ])
  })

  it('does not mutate its input', () => {
    const input = [repo({ name: 'b' }), repo({ name: 'a' })]
    const snapshot = input.map((entry) => entry.name)
    sortWorkspaceRepos(input, 'name')
    expect(input.map((entry) => entry.name)).toEqual(snapshot)
  })
})
