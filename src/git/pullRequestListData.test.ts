import { getPullRequestList, PULL_REQUEST_LIST_JSON_FIELDS } from './pullRequestListData'

describe('pullRequestListData', () => {
  const githubRemoteGit = () =>
    ({
      getRemotes: jest.fn().mockResolvedValue([
        { name: 'origin', refs: { fetch: 'git@github.com:gfargo/coco.git', push: '' } },
      ]),
      raw: jest.fn().mockResolvedValue('main\n'),
    } as never)

  it('returns unavailable when no GitHub remote exists', async () => {
    const runner = jest.fn()
    const git = { getRemotes: jest.fn().mockResolvedValue([]) } as never

    await expect(getPullRequestList(git, {}, runner)).resolves.toEqual({
      available: false,
      authenticated: false,
      filter: {},
      message: 'No GitHub remote detected.',
    })
    expect(runner).not.toHaveBeenCalled()
  })

  it('parses a populated PR list', async () => {
    const payload = [
      {
        number: 962,
        title: 'feat(commit-split): dedupe rescues',
        url: 'https://github.com/gfargo/coco/pull/962',
        state: 'MERGED',
        isDraft: false,
        headRefName: 'claude/x',
        baseRefName: 'main',
        author: { login: 'gfargo' },
        assignees: [],
        labels: [{ name: 'enhancement' }],
        reviewDecision: 'APPROVED',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        createdAt: '2026-05-14T00:00:00Z',
        updatedAt: '2026-05-14T00:00:00Z',
      },
    ]
    const runner = jest
      .fn()
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce(JSON.stringify(payload))

    const overview = await getPullRequestList(githubRemoteGit(), {}, runner)

    expect(overview.authenticated).toBe(true)
    expect(overview.pullRequests).toEqual([
      {
        number: 962,
        title: 'feat(commit-split): dedupe rescues',
        url: 'https://github.com/gfargo/coco/pull/962',
        state: 'MERGED',
        isDraft: false,
        headRefName: 'claude/x',
        baseRefName: 'main',
        author: 'gfargo',
        assignees: [],
        labels: ['enhancement'],
        reviewDecision: 'APPROVED',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        createdAt: '2026-05-14T00:00:00Z',
        updatedAt: '2026-05-14T00:00:00Z',
      },
    ])
  })

  it('threads filter knobs into the gh args', async () => {
    const runner = jest
      .fn()
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('[]')

    await getPullRequestList(
      githubRemoteGit(),
      {
        state: 'open',
        assignee: '@me',
        draft: true,
        base: 'main',
        head: 'feature/x',
        limit: 25,
      },
      runner
    )

    expect(runner).toHaveBeenNthCalledWith(2, [
      'pr',
      'list',
      '--json',
      PULL_REQUEST_LIST_JSON_FIELDS,
      '--state',
      'open',
      '--assignee',
      '@me',
      '--draft',
      '--base',
      'main',
      '--head',
      'feature/x',
      '--limit',
      '25',
    ])
  })

  it('parses a minimal PR payload without enriched fields', async () => {
    const runner = jest
      .fn()
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce(
        JSON.stringify([
          {
            number: 7,
            title: 'minimal',
            url: 'x',
            state: 'OPEN',
            isDraft: false,
            headRefName: 'wip',
            baseRefName: 'main',
          },
        ])
      )

    const overview = await getPullRequestList(githubRemoteGit(), {}, runner)
    expect(overview.pullRequests).toEqual([
      {
        number: 7,
        title: 'minimal',
        url: 'x',
        state: 'OPEN',
        isDraft: false,
        headRefName: 'wip',
        baseRefName: 'main',
        author: undefined,
        assignees: undefined,
        labels: undefined,
        reviewDecision: undefined,
        mergeable: undefined,
        mergeStateStatus: undefined,
        createdAt: '',
        updatedAt: '',
      },
    ])
  })
})
