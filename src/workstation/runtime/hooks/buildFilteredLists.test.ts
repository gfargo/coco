import { buildFilteredLists } from './buildFilteredLists'
import type { LogInkContext } from '../types'

/**
 * Unit tests for the pure `buildFilteredLists` core (0.72 app.ts
 * decomposition). No React harness — the hook (`useFilteredLists`) is a
 * thin per-list `useMemo` wrapper, so testing the pure derivation
 * exercises all the filter behavior that was lifted verbatim out of
 * app.ts. Mirrors `cursorSyncResolver.test.ts`.
 *
 * Fixtures are hand-built partial overviews cast to `LogInkContext`; the
 * filter predicate only ever reads the match fields each list keys off,
 * so the casts keep the fixtures minimal without changing behavior.
 */

const context: LogInkContext = {
  branches: {
    currentBranch: 'main',
    dirty: false,
    localBranches: [
      { shortName: 'main', upstream: 'origin/main' },
      { shortName: 'feature/login', upstream: '' },
    ],
    remoteBranches: [],
  },
  tags: {
    tags: [
      { name: 'v1.0.0', subject: 'first release' },
      { name: 'v2.0.0', subject: 'login overhaul' },
    ],
  },
  stashes: {
    stashes: [
      { ref: 'stash@{0}', message: 'wip on main' },
      { ref: 'stash@{1}', message: 'login experiment' },
    ],
  },
  worktreeList: {
    worktrees: [
      { path: '/repo/main', branch: 'main' },
      { path: '/repo/feature', branch: 'feature/login' },
    ],
  },
  reflog: {
    entries: [
      { selector: 'HEAD@{0}', hash: 'aaa111', relativeDate: '2 hours ago', subject: 'commit: add main' },
      { selector: 'HEAD@{1}', hash: 'bbb222', relativeDate: '3 hours ago', subject: 'checkout: login' },
    ],
  },
  submodules: {
    entries: [
      { name: 'libfoo', path: 'vendor/foo', trackingBranch: 'main', url: 'https://x/foo.git' },
      { name: 'libbar', path: 'vendor/bar', trackingBranch: 'login', url: 'https://x/bar.git' },
    ],
  },
  remotes: {
    entries: [
      { name: 'origin', fetchUrl: 'https://x/main.git', pushUrl: 'https://x/main.git' },
      { name: 'fork', fetchUrl: 'https://x/login.git', pushUrl: 'https://x/login.git' },
    ],
  },
  issueList: {
    issues: [
      { number: 1, title: 'Fix main', author: 'alice', labels: ['bug'], assignees: ['alice'] },
      { number: 2, title: 'Add login', author: 'bob', labels: ['feature'], assignees: ['bob'] },
    ],
  },
  pullRequestList: {
    pullRequests: [
      {
        number: 10,
        title: 'Main cleanup',
        author: 'alice',
        headRefName: 'cleanup',
        baseRefName: 'main',
        labels: ['chore'],
        assignees: ['alice'],
      },
      {
        number: 11,
        title: 'Login feature',
        author: 'bob',
        headRefName: 'feature/login',
        baseRefName: 'main',
        labels: ['feature'],
        assignees: ['bob'],
      },
    ],
  },
} as unknown as LogInkContext

describe('buildFilteredLists', () => {
  describe('empty/undefined filter returns the full lists', () => {
    it.each([undefined, ''])('filter=%p returns every row', (filter) => {
      const result = buildFilteredLists(context, filter)
      expect(result.filteredBranchList).toHaveLength(2)
      expect(result.filteredTagList).toHaveLength(2)
      expect(result.filteredStashList).toHaveLength(2)
      expect(result.filteredWorktreeList).toHaveLength(2)
      expect(result.filteredReflogList).toHaveLength(2)
      expect(result.filteredSubmoduleList).toHaveLength(2)
      expect(result.filteredRemoteList).toHaveLength(2)
      expect(result.filteredIssueList).toHaveLength(2)
      expect(result.filteredPullRequestTriageList).toHaveLength(2)
    })

    it('returns the original array reference for an undefined filter', () => {
      const result = buildFilteredLists(context, undefined)
      // No filter => the verbatim `return all` path, not a `.filter()` copy.
      expect(result.filteredBranchList).toBe(context.branches?.localBranches)
      expect(result.filteredIssueList).toBe(context.issueList?.issues)
    })
  })

  describe('an active filter narrows each list', () => {
    const result = buildFilteredLists(context, 'login')

    it('matches branches on shortName/upstream', () => {
      expect(result.filteredBranchList.map((b) => b.shortName)).toEqual(['feature/login'])
    })
    it('matches tags on name/subject', () => {
      expect(result.filteredTagList.map((t) => t.name)).toEqual(['v2.0.0'])
    })
    it('matches stashes on ref/message', () => {
      expect(result.filteredStashList.map((s) => s.ref)).toEqual(['stash@{1}'])
    })
    it('matches worktrees on path/branch', () => {
      expect(result.filteredWorktreeList.map((w) => w.branch)).toEqual(['feature/login'])
    })
    it('matches reflog on selector/hash/relativeDate/subject', () => {
      expect(result.filteredReflogList.map((e) => e.selector)).toEqual(['HEAD@{1}'])
    })
    it('matches submodules on name/path/trackingBranch/url', () => {
      expect(result.filteredSubmoduleList.map((e) => e.name)).toEqual(['libbar'])
    })
    it('matches remotes on name/fetchUrl/pushUrl', () => {
      expect(result.filteredRemoteList.map((e) => e.name)).toEqual(['fork'])
    })
    it('matches issues across the multi-field array (title/labels/assignees)', () => {
      expect(result.filteredIssueList.map((i) => i.number)).toEqual([2])
    })
    it('matches PRs across the multi-field array (head/base/labels/assignees)', () => {
      expect(result.filteredPullRequestTriageList.map((p) => p.number)).toEqual([11])
    })

    it('matches issues by label even when title/author miss', () => {
      // "feature" only appears in issue #2's labels — proves the spread
      // of `issue.labels` into the match array is preserved.
      expect(buildFilteredLists(context, 'feature').filteredIssueList.map((i) => i.number)).toEqual([2])
    })
    it('matches PRs by issue-number token (`#11`)', () => {
      expect(buildFilteredLists(context, '#11').filteredPullRequestTriageList.map((p) => p.number)).toEqual([11])
    })
  })

  describe('missing context.* slices return []', () => {
    it('returns empty arrays for every list when context is empty', () => {
      const result = buildFilteredLists({}, undefined)
      expect(result).toEqual({
        filteredBranchList: [],
        filteredTagList: [],
        filteredStashList: [],
        filteredWorktreeList: [],
        filteredReflogList: [],
        filteredSubmoduleList: [],
        filteredRemoteList: [],
        filteredIssueList: [],
        filteredPullRequestTriageList: [],
      })
    })

    it('returns [] for missing slices even with an active filter', () => {
      const result = buildFilteredLists({}, 'anything')
      expect(result.filteredBranchList).toEqual([])
      expect(result.filteredPullRequestTriageList).toEqual([])
    })
  })
})
