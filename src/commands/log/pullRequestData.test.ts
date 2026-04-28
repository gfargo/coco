import { getPullRequestOverview, parseGitHubRemoteUrl } from './pullRequestData'

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

    await expect(getPullRequestOverview(git as never, runner)).resolves.toEqual({
      available: true,
      authenticated: true,
      repository: {
        owner: 'gfargo',
        name: 'coco',
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
      },
    })
    expect(runner).toHaveBeenNthCalledWith(1, ['auth', 'status', '--hostname', 'github.com'])
    expect(runner).toHaveBeenNthCalledWith(2, [
      'pr',
      'view',
      '--json',
      'number,title,url,state,isDraft,headRefName,baseRefName',
    ])
  })
})
