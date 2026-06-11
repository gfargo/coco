import { getIssueList, ISSUE_LIST_JSON_FIELDS } from './issuesListData'

describe('issuesListData', () => {
  const githubRemoteGit = (branch = 'main') =>
    ({
      getRemotes: jest.fn().mockResolvedValue([
        { name: 'origin', refs: { fetch: 'git@github.com:gfargo/coco.git', push: '' } },
      ]),
      raw: jest.fn().mockResolvedValue(`${branch}\n`),
    } as never)

  it('returns unavailable when no GitHub remote exists', async () => {
    const runner = jest.fn()
    const git = {
      getRemotes: jest.fn().mockResolvedValue([]),
    } as never

    await expect(getIssueList(git, {}, runner)).resolves.toEqual({
      available: false,
      authenticated: false,
      filter: {},
      message: 'No GitHub remote detected.',
    })
    expect(runner).not.toHaveBeenCalled()
  })

  it('returns unauthenticated when `gh auth status` throws', async () => {
    // The MEDIUM-7 refactor (#TBD) tags gh failures with a structured
    // status (`not-installed` / `not-authenticated` / `unknown`).
    // ENOENT collapses to `not-installed`; other errors collapse to
    // `unknown`. Either way the overview's `authenticated` flag is
    // false — that's the contract the data layer ships.
    const enoentError = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' })
    const runner = jest.fn().mockRejectedValueOnce(enoentError)
    const overview = await getIssueList(githubRemoteGit(), {}, runner)
    expect(overview.authenticated).toBe(false)
    expect(overview.repository).toEqual({ owner: 'gfargo', name: 'coco' })
    // Match either the ENOENT-specific copy or the generic
    // unauthenticated message — both are valid for "gh isn't usable".
    expect(overview.message).toMatch(/not installed|not authenticated/)
  })

  it('parses a populated issue list', async () => {
    const payload = [
      {
        number: 882,
        title: 'TUI shell · issue / PR triage workflow',
        url: 'https://github.com/gfargo/coco/issues/882',
        state: 'OPEN',
        author: { login: 'gfargo' },
        assignees: [{ login: 'reviewer-a' }],
        labels: [{ name: 'enhancement' }, { name: 'tui' }],
        comments: 3,
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
      },
    ]
    const runner = jest
      .fn()
      .mockResolvedValueOnce('') // auth status
      .mockResolvedValueOnce(JSON.stringify(payload))

    const overview = await getIssueList(githubRemoteGit(), {}, runner)

    expect(overview.authenticated).toBe(true)
    expect(overview.issues).toEqual([
      {
        number: 882,
        title: 'TUI shell · issue / PR triage workflow',
        url: 'https://github.com/gfargo/coco/issues/882',
        state: 'OPEN',
        author: 'gfargo',
        assignees: ['reviewer-a'],
        labels: ['enhancement', 'tui'],
        comments: 3,
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
      },
    ])
  })

  it('degrades to an empty list when the gh body is not an array', async () => {
    const runner = jest
      .fn()
      .mockResolvedValueOnce('') // auth status
      .mockResolvedValueOnce(JSON.stringify({ message: 'Not Found' }))

    const overview = await getIssueList(githubRemoteGit(), {}, runner)
    expect(overview.authenticated).toBe(true)
    expect(overview.issues).toEqual([])
  })

  it('threads filter knobs into the gh args', async () => {
    const runner = jest
      .fn()
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('[]')

    await getIssueList(
      githubRemoteGit(),
      {
        state: 'closed',
        assignee: '@me',
        label: 'bug,critical',
        search: 'auth flow',
        limit: 50,
      },
      runner
    )

    expect(runner).toHaveBeenNthCalledWith(2, [
      'issue',
      'list',
      '--json',
      ISSUE_LIST_JSON_FIELDS,
      '--state',
      'closed',
      '--assignee',
      '@me',
      '--label',
      'bug,critical',
      '--search',
      'auth flow',
      '--limit',
      '50',
    ])
  })

  it('returns an empty issue list rather than crashing on missing fields', async () => {
    const runner = jest
      .fn()
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce(JSON.stringify([{ number: 1, title: 'minimal', url: 'x', state: 'OPEN' }]))

    const overview = await getIssueList(githubRemoteGit(), {}, runner)
    expect(overview.issues).toEqual([
      {
        number: 1,
        title: 'minimal',
        url: 'x',
        state: 'OPEN',
        author: undefined,
        assignees: undefined,
        labels: undefined,
        comments: undefined,
        createdAt: '',
        updatedAt: '',
      },
    ])
  })

  it('surfaces the runner error as the overview message when `gh issue list` fails', async () => {
    const runner = jest
      .fn()
      .mockResolvedValueOnce('')
      .mockRejectedValueOnce(new Error('rate limited'))

    const overview = await getIssueList(githubRemoteGit(), {}, runner)
    expect(overview.issues).toBeUndefined()
    expect(overview.message).toContain('rate limited')
  })
})
