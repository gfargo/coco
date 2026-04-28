import { buildCreatePullRequestArgs, createPullRequest, openPullRequest } from './pullRequestActions'

describe('log pull request actions', () => {
  it('builds ready and draft PR create commands', () => {
    expect(buildCreatePullRequestArgs({
      base: 'main',
      head: 'feature/pr',
      title: 'Add PR workflow',
      body: 'Generated body',
    })).toEqual([
      'pr',
      'create',
      '--base',
      'main',
      '--head',
      'feature/pr',
      '--title',
      'Add PR workflow',
      '--body',
      'Generated body',
    ])

    expect(buildCreatePullRequestArgs({
      base: 'main',
      head: 'feature/pr',
      title: 'Add PR workflow',
      body: 'Generated body',
      draft: true,
    })).toContain('--draft')
  })

  it('creates and opens pull requests through gh', async () => {
    const runner = jest
      .fn()
      .mockResolvedValueOnce('https://github.com/gfargo/coco/pull/123\n')
      .mockResolvedValueOnce('')

    await expect(createPullRequest({
      base: 'main',
      head: 'feature/pr',
      title: 'Add PR workflow',
      body: 'Generated body',
    }, runner)).resolves.toEqual({
      ok: true,
      message: 'Created pull request: https://github.com/gfargo/coco/pull/123',
      url: 'https://github.com/gfargo/coco/pull/123',
    })
    await expect(openPullRequest('https://github.com/gfargo/coco/pull/123', runner)).resolves.toEqual({
      ok: true,
      message: 'Opened pull request: https://github.com/gfargo/coco/pull/123',
      url: 'https://github.com/gfargo/coco/pull/123',
    })
    expect(runner).toHaveBeenLastCalledWith(['pr', 'view', '--web'])
  })
})
