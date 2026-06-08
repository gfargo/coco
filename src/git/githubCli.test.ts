import {
  isGhAuthenticated,
  parseGitHubRemoteUrl,
  getGitHubRepository,
  compactGhError,
  resolveGhActionError,
} from './githubCli'

describe('githubCli', () => {
  describe('parseGitHubRemoteUrl', () => {
    it('parses SSH remotes', () => {
      expect(parseGitHubRemoteUrl('git@github.com:gfargo/coco.git')).toEqual({
        owner: 'gfargo',
        name: 'coco',
      })
    })

    it('parses HTTPS remotes', () => {
      expect(parseGitHubRemoteUrl('https://github.com/gfargo/coco.git')).toEqual({
        owner: 'gfargo',
        name: 'coco',
      })
    })

    it('drops the .git suffix and trailing whitespace', () => {
      expect(parseGitHubRemoteUrl('  https://github.com/gfargo/coco  ')).toEqual({
        owner: 'gfargo',
        name: 'coco',
      })
    })

    it('returns undefined for non-GitHub remotes', () => {
      expect(parseGitHubRemoteUrl('git@gitlab.com:gfargo/coco.git')).toBeUndefined()
      expect(parseGitHubRemoteUrl('https://bitbucket.org/gfargo/coco.git')).toBeUndefined()
    })

    it('returns undefined for empty input', () => {
      expect(parseGitHubRemoteUrl('')).toBeUndefined()
    })
  })

  describe('isGhAuthenticated', () => {
    it('returns true when `gh auth status` succeeds', async () => {
      const runner = jest.fn().mockResolvedValue('')
      await expect(isGhAuthenticated(runner)).resolves.toBe(true)
      expect(runner).toHaveBeenCalledWith(['auth', 'status', '--hostname', 'github.com'])
    })

    it('returns false when `gh auth status` throws', async () => {
      const runner = jest.fn().mockRejectedValue(new Error('not installed'))
      await expect(isGhAuthenticated(runner)).resolves.toBe(false)
    })
  })

  describe('getGitHubRepository', () => {
    it('picks the origin remote when present', async () => {
      const git = {
        getRemotes: jest.fn().mockResolvedValue([
          { name: 'upstream', refs: { fetch: 'git@github.com:other/repo.git', push: '' } },
          { name: 'origin', refs: { fetch: 'git@github.com:gfargo/coco.git', push: '' } },
        ]),
      }
      await expect(getGitHubRepository(git as never)).resolves.toEqual({
        owner: 'gfargo',
        name: 'coco',
      })
    })

    it('falls back to the first remote when origin is missing', async () => {
      const git = {
        getRemotes: jest.fn().mockResolvedValue([
          { name: 'upstream', refs: { fetch: 'git@github.com:other/repo.git', push: '' } },
        ]),
      }
      await expect(getGitHubRepository(git as never)).resolves.toEqual({
        owner: 'other',
        name: 'repo',
      })
    })

    it('returns undefined when no remotes exist', async () => {
      const git = { getRemotes: jest.fn().mockResolvedValue([]) }
      await expect(getGitHubRepository(git as never)).resolves.toBeUndefined()
    })
  })

  describe('compactGhError', () => {
    it('keeps the head line and bounds detail lines to 7', () => {
      const message = ['head', ...Array.from({ length: 12 }, (_, i) => `line ${i}`)].join('\n')
      const result = compactGhError(message)
      expect(result.message).toBe('head')
      expect(result.details).toHaveLength(7)
    })

    it('falls back to a generic message for empty input', () => {
      expect(compactGhError('   ')).toEqual({ message: 'GitHub CLI command failed.', details: [] })
    })
  })

  describe('resolveGhActionError', () => {
    it('returns the curated hint when gh is no longer authenticated', async () => {
      const runner = jest
        .fn()
        .mockRejectedValue(new Error('You are not logged into any GitHub hosts.'))
      const result = await resolveGhActionError(new Error('pr create failed'), runner)
      expect(result.message).toContain('gh auth login')
    })

    it('compacts the raw error when gh is still healthy', async () => {
      const runner = jest.fn().mockResolvedValue('Logged in to github.com')
      const result = await resolveGhActionError(
        new Error('Pull request already exists\ntry a different head'),
        runner
      )
      expect(result.message).toBe('Pull request already exists')
      expect(result.details).toEqual(['try a different head'])
    })
  })
})
