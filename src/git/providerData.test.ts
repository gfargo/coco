import {
  buildProviderUrl,
  detectLocalDefaultBranch,
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

  it('detects GitLab remotes', () => {
    expect(getProviderRepository('origin', 'git@gitlab.com:gfargo/coco.git')).toEqual({
      provider: 'gitlab',
      remote: 'origin',
      host: 'gitlab.com',
      owner: 'gfargo',
      name: 'coco',
      webUrl: 'https://gitlab.com/gfargo/coco',
    })
  })

  it('preserves GitLab subgroup namespaces', () => {
    expect(getProviderRepository('origin', 'https://gitlab.com/group/subgroup/proj.git')).toEqual({
      provider: 'gitlab',
      remote: 'origin',
      host: 'gitlab.com',
      owner: 'group/subgroup',
      name: 'proj',
      webUrl: 'https://gitlab.com/group/subgroup/proj',
    })
  })

  it('treats GitHub Enterprise hosts as github', () => {
    const repo = getProviderRepository('origin', 'git@github.acme.com:team/app.git')
    expect(repo.provider).toBe('github')
    expect(repo.host).toBe('github.acme.com')
  })

  it('falls back for unsupported hosts', () => {
    expect(getProviderRepository('origin', 'git@bitbucket.org:gfargo/coco.git')).toEqual({
      provider: 'unsupported',
      remote: 'origin',
      host: 'bitbucket.org',
      owner: 'gfargo',
      name: 'coco',
      message: 'Unsupported remote host "bitbucket.org" for origin.',
    })
  })

  it('builds GitLab provider URLs under the /-/ namespace', () => {
    const gitlab = {
      provider: 'gitlab' as const,
      remote: 'origin',
      host: 'gitlab.com',
      owner: 'gfargo',
      name: 'coco',
      webUrl: 'https://gitlab.com/gfargo/coco',
    }
    expect(buildProviderUrl(gitlab, { type: 'branch', branch: 'feat/x' })).toBe(
      'https://gitlab.com/gfargo/coco/-/tree/feat%2Fx'
    )
    expect(buildProviderUrl(gitlab, { type: 'commit', commit: 'abc123' })).toBe(
      'https://gitlab.com/gfargo/coco/-/commit/abc123'
    )
    expect(buildProviderUrl(gitlab, { type: 'pull-request', number: 7 })).toBe(
      'https://gitlab.com/gfargo/coco/-/merge_requests/7'
    )
    expect(buildProviderUrl(gitlab, { type: 'compare', base: 'main', head: 'feat/x' })).toBe(
      'https://gitlab.com/gfargo/coco/-/compare/main...feat%2Fx'
    )
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

  it('encodes the commit hash in provider URLs', () => {
    expect(buildProviderUrl(repository, { type: 'commit', commit: 'refs/tags/v1 rc' })).toBe(
      'https://github.com/gfargo/coco/commit/refs%2Ftags%2Fv1%20rc'
    )
  })

  // git.raw now answers three commands during a single getProviderOverview
  // call: branch --show-current, symbolic-ref origin/HEAD (for local
  // default-branch detection), and possibly rev-parse fallbacks. This
  // helper builds a mock that dispatches on the command rather than
  // returning one value for all of them.
  function buildGitRawMock(answers: {
    currentBranch?: string
    originHead?: string | null
    localBranches?: string[]
  }): jest.Mock {
    const localBranches = new Set(answers.localBranches || [])
    return jest.fn().mockImplementation(async (args: string[]) => {
      if (args[0] === 'branch' && args[1] === '--show-current') {
        return `${answers.currentBranch || ''}\n`
      }
      if (args[0] === 'symbolic-ref' && args[1] === 'refs/remotes/origin/HEAD') {
        if (answers.originHead === null || answers.originHead === undefined) {
          throw new Error('fatal: ref refs/remotes/origin/HEAD is not a symbolic ref')
        }
        return `refs/remotes/origin/${answers.originHead}\n`
      }
      if (args[0] === 'rev-parse' && args[1] === '--verify') {
        const ref = args[3]?.replace('refs/heads/', '')
        if (ref && localBranches.has(ref)) {
          return 'abc123\n'
        }
        throw new Error('fatal: Needed a single revision')
      }
      throw new Error(`unexpected git.raw call: ${args.join(' ')}`)
    })
  }

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
      raw: buildGitRawMock({ currentBranch: 'feature/log', originHead: 'main' }),
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
      raw: buildGitRawMock({ currentBranch: 'main', originHead: 'main' }),
    }
    const runner = jest
      .fn()
      .mockRejectedValue(new Error('You are not logged into any GitHub hosts.'))

    await expect(getProviderOverview(git as never, runner)).resolves.toMatchObject({
      authenticated: false,
      // Now routed through getGhStatus/describeGhStatus, so the message is the
      // tailored recovery hint rather than a flat catch-all.
      message: expect.stringContaining('gh auth login'),
      repository: {
        provider: 'github',
        owner: 'gfargo',
        name: 'coco',
        // Local fallback still populates defaultBranch even though gh
        // auth failed — this is the whole point of the offline path.
        defaultBranch: 'main',
      },
    })
  })

  describe('detectLocalDefaultBranch', () => {
    it('returns the branch tracked by origin/HEAD when set', async () => {
      const git = { raw: buildGitRawMock({ originHead: 'develop' }) }
      await expect(detectLocalDefaultBranch(git as never)).resolves.toBe('develop')
    })

    it('falls back to "main" when origin/HEAD is missing and main exists locally', async () => {
      const git = { raw: buildGitRawMock({ originHead: null, localBranches: ['main', 'feat/x'] }) }
      await expect(detectLocalDefaultBranch(git as never)).resolves.toBe('main')
    })

    it('falls back to "master" when neither origin/HEAD nor main exists', async () => {
      const git = { raw: buildGitRawMock({ originHead: null, localBranches: ['master'] }) }
      await expect(detectLocalDefaultBranch(git as never)).resolves.toBe('master')
    })

    it('tries develop and trunk before giving up', async () => {
      // Only develop is present — main and master miss, develop hits
      // before trunk gets checked.
      const developOnly = { raw: buildGitRawMock({ originHead: null, localBranches: ['develop'] }) }
      await expect(detectLocalDefaultBranch(developOnly as never)).resolves.toBe('develop')

      const trunkOnly = { raw: buildGitRawMock({ originHead: null, localBranches: ['trunk'] }) }
      await expect(detectLocalDefaultBranch(trunkOnly as never)).resolves.toBe('trunk')
    })

    it('returns undefined when nothing matches', async () => {
      const git = {
        raw: buildGitRawMock({ originHead: null, localBranches: ['feat/x', 'feat/y'] }),
      }
      await expect(detectLocalDefaultBranch(git as never)).resolves.toBeUndefined()
    })
  })

  it('populates defaultBranch from local refs when no remote is configured', async () => {
    // Scenario-test shape: `git init` + a couple branches, no `origin`
    // remote at all. Provider can't reach gh; local fallback should
    // still surface a sensible defaultBranch so the workstation's PR /
    // changelog flows can derive a base.
    const git = {
      getRemotes: jest.fn().mockResolvedValue([]),
      raw: buildGitRawMock({
        currentBranch: 'feat/widget-v2',
        originHead: null,
        localBranches: ['main'],
      }),
    }
    const runner = jest.fn()

    await expect(getProviderOverview(git as never, runner)).resolves.toMatchObject({
      authenticated: false,
      repository: {
        provider: 'unsupported',
        defaultBranch: 'main',
      },
      currentBranch: 'feat/widget-v2',
    })
    expect(runner).not.toHaveBeenCalled()
  })

  it('prefers the gh-reported default branch over local fallback when both are available', async () => {
    // Edge case: a fork where the remote's default branch differs from
    // what local refs would suggest. gh's answer wins because it
    // reflects the actual remote-side configuration.
    const git = {
      getRemotes: jest.fn().mockResolvedValue([
        {
          name: 'origin',
          refs: { fetch: 'git@github.com:fork/coco.git', push: 'git@github.com:fork/coco.git' },
        },
      ]),
      raw: buildGitRawMock({ currentBranch: 'main', originHead: 'main', localBranches: ['main'] }),
    }
    const runner = jest.fn().mockImplementation(async (args: string[]) => {
      if (args[0] === 'auth') return ''
      if (args[0] === 'repo') {
        return JSON.stringify({ defaultBranchRef: { name: 'develop' } })
      }
      return ''
    })

    await expect(getProviderOverview(git as never, runner)).resolves.toMatchObject({
      authenticated: true,
      repository: { defaultBranch: 'develop' },
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

