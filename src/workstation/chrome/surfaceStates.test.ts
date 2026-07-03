import {
  formatLogInkBlameEmpty,
  formatLogInkBranchesEmpty,
  formatLogInkComposeEmpty,
  formatLogInkHistoryEmpty,
  formatLogInkLoading,
  formatLogInkPullRequestDiffEmpty,
  formatLogInkPullRequestDiffError,
  formatLogInkStashEmpty,
  formatLogInkStatusEmpty,
  formatLogInkTagsEmpty,
} from './surfaceStates'

describe('log Ink surface states', () => {
  describe('formatLogInkLoading', () => {
    it('renders a uniform leading glyph + text per resource', () => {
      expect(formatLogInkLoading({ resource: 'branches' })).toBe('· Loading branches…')
      expect(formatLogInkLoading({ resource: 'tags' })).toBe('· Loading tags…')
      expect(formatLogInkLoading({ resource: 'stashes' })).toBe('· Loading stashes…')
      expect(formatLogInkLoading({ resource: 'worktree status' })).toBe('· Loading worktree status…')
    })
  })

  describe('formatLogInkBranchesEmpty', () => {
    it('returns a tailored hint when no filter is active', () => {
      const message = formatLogInkBranchesEmpty({ filter: '' })
      expect(message).toContain('No local branches')
      expect(message).toContain('gh') // points at history nav
    })

    it('flags the active filter and tells users how to clear it', () => {
      const message = formatLogInkBranchesEmpty({ filter: 'feature/foo' })
      expect(message).toContain("'feature/foo'")
      expect(message).toContain('ctrl+u')
    })

    it('treats whitespace-only filter as no filter', () => {
      expect(formatLogInkBranchesEmpty({ filter: '   ' })).toContain('No local branches')
    })
  })

  describe('formatLogInkTagsEmpty', () => {
    it('returns a tailored hint when no filter is active', () => {
      const message = formatLogInkTagsEmpty({ filter: '' })
      expect(message).toContain('No tags found')
      expect(message).toContain('git tag')
    })

    it('flags the active filter and tells users how to clear it', () => {
      const message = formatLogInkTagsEmpty({ filter: 'v1' })
      expect(message).toContain("'v1'")
      expect(message).toContain('ctrl+u')
    })
  })

  describe('formatLogInkStashEmpty', () => {
    it('returns a tailored hint when no filter is active', () => {
      const message = formatLogInkStashEmpty({ filter: '' })
      expect(message).toContain('No stashes')
      expect(message).toContain('gs') // hints at status view
    })

    it('flags the active filter and tells users how to clear it', () => {
      const message = formatLogInkStashEmpty({ filter: 'wip' })
      expect(message).toContain("'wip'")
      expect(message).toContain('ctrl+u')
    })
  })

  describe('formatLogInkBlameEmpty', () => {
    it('leads with the git error when blame failed', () => {
      const message = formatLogInkBlameEmpty({ path: 'logo.png', failureMessage: 'binary file' })
      expect(message).toContain('logo.png')
      expect(message).toContain('binary file')
      expect(message).toContain('esc')
    })

    it('falls back to a neutral hint for a genuinely empty file', () => {
      const message = formatLogInkBlameEmpty({ path: 'src/empty.ts' })
      expect(message).toContain('src/empty.ts')
      expect(message).toContain('esc')
    })
  })

  describe('formatLogInkHistoryEmpty', () => {
    it('reports filter clear when search is active', () => {
      const message = formatLogInkHistoryEmpty({ filter: 'fix:', totalCommits: 100 })
      expect(message).toContain('No commits match')
      expect(message).toContain('ctrl+u')
    })

    it('reports an empty repository when there are no commits at all', () => {
      const message = formatLogInkHistoryEmpty({ filter: '', totalCommits: 0 })
      expect(message).toContain('No commits yet')
    })

    it('reports a generic empty viewport when commits exist but none are visible', () => {
      const message = formatLogInkHistoryEmpty({ filter: '', totalCommits: 5 })
      expect(message).toBe('No commits in view.')
    })
  })

  describe('formatLogInkStatusEmpty', () => {
    it('returns undefined when the worktree has changes (no empty state needed)', () => {
      expect(formatLogInkStatusEmpty({ hasChanges: true })).toBeUndefined()
    })

    it('returns a clean-tree hint with onward navigation when nothing is staged or unstaged', () => {
      const message = formatLogInkStatusEmpty({ hasChanges: false })
      expect(message).toContain('Worktree clean')
      expect(message).toContain('gh') // history
      expect(message).toContain('gb') // branches
      expect(message).toContain('gz') // stash
    })
  })

  describe('formatLogInkComposeEmpty', () => {
    it('returns undefined when there are staged changes (no empty state needed)', () => {
      expect(formatLogInkComposeEmpty({ hasStaged: true })).toBeUndefined()
    })

    it('returns a hint pointing back to status when no staged changes exist', () => {
      const message = formatLogInkComposeEmpty({ hasStaged: false })
      expect(message).toContain('No staged changes')
      expect(message).toContain('gs') // status view
      expect(message).toContain('gc') // round-trip back to compose
    })
  })
})

describe('PR diff loading / error states (#1363)', () => {
  it('leads the error state with the CLI message and points at recovery keys', () => {
    const text = formatLogInkPullRequestDiffError({ message: 'gh: Not Found (HTTP 404)' })
    expect(text).toContain('gh: Not Found (HTTP 404)')
    expect(text).toContain('esc')
    expect(text).toContain('r to refresh')
  })

  it('distinguishes an empty patch from a failed fetch', () => {
    expect(formatLogInkPullRequestDiffEmpty()).toBe('No diff to display for this pull request.')
  })
})
