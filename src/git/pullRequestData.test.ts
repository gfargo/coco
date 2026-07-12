import {
  PULL_REQUEST_VIEW_JSON_FIELDS,
  getPullRequestOverview,
  parseGitHubRemoteUrl,
} from './pullRequestData'

describe('log pull request data', () => {
  it('parses GitHub SSH and HTTPS remotes', () => {
    expect(parseGitHubRemoteUrl('git@github.com:gfargo/coco.git')).toEqual({
      owner: 'gfargo',
      name: 'coco',
    })
    expect(parseGitHubRemoteUrl('https://github.com/gfargo/coco.git')).toEqual({
      owner: 'gfargo',
      name: 'coco',
    })
    expect(parseGitHubRemoteUrl('git@gitlab.com:gfargo/coco.git')).toBeUndefined()
  })

  it('reports missing GitHub remotes without invoking gh', async () => {
    const runner = jest.fn()
    const git = {
      getRemotes: jest.fn().mockResolvedValue([]),
      raw: jest.fn().mockResolvedValue('feature/test\n'),
    }

    await expect(getPullRequestOverview(git as never, runner)).resolves.toEqual({
      available: false,
      authenticated: false,
      currentBranch: 'feature/test',
      message: 'No GitHub remote detected.',
    })
    expect(runner).not.toHaveBeenCalled()
  })

  it('loads the current branch pull request when gh is authenticated', async () => {
    const runner = jest
      .fn()
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce(JSON.stringify({
        number: 123,
        title: 'Add PR workflow',
        url: 'https://github.com/gfargo/coco/pull/123',
        state: 'OPEN',
        isDraft: false,
        headRefName: 'feature/pr',
        baseRefName: 'main',
        // Enriched fields for the dedicated PR action panel (#783) —
        // body / author / mergeable / reviews / statusCheckRollup all
        // come back from the same `gh pr view --json` call so the
        // panel renders without a second round-trip.
        body: 'Adds the PR action panel.',
        author: { login: 'gfargo' },
        reviewDecision: 'APPROVED',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        statusCheckRollup: [
          { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
          { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
          { name: 'build', status: 'IN_PROGRESS' },
        ],
        reviews: [
          { author: { login: 'reviewer-a' }, state: 'APPROVED' },
          { author: { login: 'reviewer-b' }, state: 'COMMENTED' },
        ],
      }))
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
      raw: jest.fn().mockResolvedValue('feature/pr\n'),
    }

    const overview = await getPullRequestOverview(git as never, runner)
    expect(overview).toEqual({
      available: true,
      authenticated: true,
      repository: {
        owner: 'gfargo',
        name: 'coco',
        host: 'github.com',
      },
      currentBranch: 'feature/pr',
      currentPullRequest: {
        number: 123,
        title: 'Add PR workflow',
        url: 'https://github.com/gfargo/coco/pull/123',
        state: 'OPEN',
        isDraft: false,
        headRefName: 'feature/pr',
        baseRefName: 'main',
        body: 'Adds the PR action panel.',
        author: 'gfargo',
        reviewDecision: 'APPROVED',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        statusCheckRollup: [
          { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
          { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
          { name: 'build', status: 'IN_PROGRESS', conclusion: undefined },
        ],
        reviews: [
          { author: 'reviewer-a', state: 'APPROVED' },
          { author: 'reviewer-b', state: 'COMMENTED' },
        ],
      },
    })
    expect(runner).toHaveBeenNthCalledWith(1, ['auth', 'status', '--hostname', 'github.com'])
    expect(runner).toHaveBeenNthCalledWith(2, ['pr', 'view', '--json', PULL_REQUEST_VIEW_JSON_FIELDS])
  })

  it('parses a minimal pull request payload without the enriched fields', () => {
    // Falls back gracefully when gh returns the legacy minimum shape —
    // older gh versions, restricted-token environments, or partial
    // JSON. The panel renders the basics without crashing on missing
    // statusCheckRollup / reviews.
    const runner = jest
      .fn()
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce(JSON.stringify({
        number: 7,
        title: 'minimal',
        url: 'https://github.com/gfargo/coco/pull/7',
        state: 'OPEN',
        isDraft: true,
        headRefName: 'wip',
        baseRefName: 'main',
      }))
    const git = {
      getRemotes: jest.fn().mockResolvedValue([
        { name: 'origin', refs: { fetch: 'git@github.com:gfargo/coco.git', push: '' } },
      ]),
      raw: jest.fn().mockResolvedValue('wip\n'),
    }

    return expect(getPullRequestOverview(git as never, runner)).resolves.toMatchObject({
      currentPullRequest: {
        number: 7,
        title: 'minimal',
        isDraft: true,
        body: undefined,
        author: undefined,
        statusCheckRollup: undefined,
        reviews: undefined,
      },
    })
  })

  it('exports the centralized JSON field list', () => {
    expect(PULL_REQUEST_VIEW_JSON_FIELDS).toContain('statusCheckRollup')
    expect(PULL_REQUEST_VIEW_JSON_FIELDS).toContain('reviews')
    expect(PULL_REQUEST_VIEW_JSON_FIELDS).toContain('mergeable')
    expect(PULL_REQUEST_VIEW_JSON_FIELDS).toContain('mergeStateStatus')
    expect(PULL_REQUEST_VIEW_JSON_FIELDS).toContain('author')
  })
})
