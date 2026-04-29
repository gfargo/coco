import {
  buildProviderUrl,
  getProviderOverview,
  getProviderRepository,
  parseGitHubRemoteUrl,
  providerBranchName,
} from './providerData'

describe('log provider data', () => {
  const repository = {
    provider: 'github' as const,
    remote: 'origin',
    owner: 'gfargo',
    name: 'coco',
    webUrl: 'https://github.com/gfargo/coco',
    defaultBranch: 'main',
  }

  it('parses GitHub HTTPS, SSH, and git remote URLs', () => {
    expect(parseGitHubRemoteUrl('https://github.com/gfargo/coco.git')).toEqual({
      owner: 'gfargo',
      name: 'coco',
      webUrl: 'https://github.com/gfargo/coco',
    })
    expect(parseGitHubRemoteUrl('git@github.com:gfargo/coco.git')).toEqual({
      owner: 'gfargo',
      name: 'coco',
      webUrl: 'https://github.com/gfargo/coco',
    })
    expect(parseGitHubRemoteUrl('ssh://git@github.com/gfargo/coco.git')).toEqual({
      owner: 'gfargo',
      name: 'coco',
      webUrl: 'https://github.com/gfargo/coco',
    })
    expect(parseGitHubRemoteUrl('git://github.com/gfargo/coco.git')).toEqual({
      owner: 'gfargo',
      name: 'coco',
      webUrl: 'https://github.com/gfargo/coco',
    })
  })

  it('falls back for unsupported providers', () => {
    expect(getProviderRepository('origin', 'git@gitlab.com:gfargo/coco.git')).toEqual({
      provider: 'unsupported',
      remote: 'origin',
      message: 'Unsupported remote provider for origin.',
    })
  })

  it('builds GitHub provider URLs', () => {
    expect(buildProviderUrl(repository, { type: 'repo' })).toBe('https://github.com/gfargo/coco')
    expect(buildProviderUrl(repository, { type: 'branch', branch: 'feature/log ui' })).toBe(
      'https://github.com/gfargo/coco/tree/feature%2Flog%20ui'
    )
    expect(buildProviderUrl(repository, { type: 'commit', commit: 'abc123' })).toBe(
      'https://github.com/gfargo/coco/commit/abc123'
    )
    expect(buildProviderUrl(repository, { type: 'pull-request', number: 42 })).toBe(
      'https://github.com/gfargo/coco/pull/42'
    )
    expect(buildProviderUrl(repository, { type: 'compare', base: 'main', head: 'feature/log ui' })).toBe(
      'https://github.com/gfargo/coco/compare/main...feature%2Flog%20ui'
    )
  })

  it('loads provider overview with default branch and PR status when authenticated', async () => {
    const git = {
      getRemotes: jest.fn().mockResolvedValue([
        {
          name: 'origin',
          refs: {
            fetch: 'git@github.com:gfargo/coco.git',
            push: 'git@github.com:gfargo/coco.git',
          },
        },
      ]),
      raw: jest.fn().mockResolvedValue('feature/log\n'),
    }
    const runner = jest.fn().mockImplementation(async (args: string[]) => {
      if (args[0] === 'auth') {
        return ''
      }

      if (args[0] === 'repo') {
        return JSON.stringify({
          defaultBranchRef: {
            name: 'main',
          },
        })
      }

      return JSON.stringify({
        number: 12,
        title: 'Add provider panel',
        state: 'OPEN',
        isDraft: false,
        reviewDecision: 'APPROVED',
        statusCheckRollup: [
          {
            name: 'test',
            conclusion: 'SUCCESS',
          },
        ],
      })
    })

    await expect(getProviderOverview(git as never, runner)).resolves.toMatchObject({
      authenticated: true,
      currentBranch: 'feature/log',
      repository: {
        provider: 'github',
        owner: 'gfargo',
        name: 'coco',
        defaultBranch: 'main',
      },
      currentPullRequest: {
        number: 12,
        reviewDecision: 'APPROVED',
      },
    })
  })

  it('has a clear fallback when GitHub auth is unavailable', async () => {
    const git = {
      getRemotes: jest.fn().mockResolvedValue([
        {
          name: 'origin',
          refs: {
            fetch: 'https://github.com/gfargo/coco.git',
          },
        },
      ]),
      raw: jest.fn().mockResolvedValue('main\n'),
    }
    const runner = jest.fn().mockRejectedValue(new Error('not authenticated'))

    await expect(getProviderOverview(git as never, runner)).resolves.toMatchObject({
      authenticated: false,
      message: 'GitHub CLI is missing or not authenticated.',
      repository: {
        provider: 'github',
        owner: 'gfargo',
        name: 'coco',
      },
    })
  })

  it('normalizes local and remote branch refs for provider URLs', () => {
    expect(providerBranchName({
      type: 'remote',
      name: 'refs/remotes/origin/feature/log',
      shortName: 'origin/feature/log',
      hash: 'abc123',
      current: false,
      remote: 'origin',
      date: '2026-04-28',
      subject: 'feat',
      ahead: 0,
      behind: 0,
    })).toBe('feature/log')
    expect(providerBranchName({
      type: 'local',
      name: 'refs/heads/main',
      shortName: 'main',
      hash: 'abc123',
      current: true,
      date: '2026-04-28',
      subject: 'feat',
      ahead: 0,
      behind: 0,
    })).toBe('main')
  })
})

