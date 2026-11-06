import { getPullRequestReviewThreads } from './pullRequestReviewThreadsData'

function graphqlResponse(nodes: unknown[]) {
  return JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          reviewThreads: { nodes },
        },
      },
    },
  })
}

describe('getPullRequestReviewThreads', () => {
  it('parses a representative GraphQL payload', async () => {
    const runner = jest.fn().mockResolvedValue(
      graphqlResponse([
        {
          path: 'src/index.ts',
          line: 42,
          originalLine: 40,
          isResolved: false,
          isOutdated: true,
          diffHunk: '@@ -1,3 +1,3 @@',
          comments: {
            nodes: [
              { author: { login: 'alice' }, body: 'nit: rename this', createdAt: '2026-05-15T00:00:00Z' },
            ],
          },
        },
      ])
    )

    const result = await getPullRequestReviewThreads(962, runner)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.threads).toEqual([
      {
        path: 'src/index.ts',
        line: 42,
        originalLine: 40,
        isResolved: false,
        isOutdated: true,
        diffHunk: '@@ -1,3 +1,3 @@',
        comments: [{ author: 'alice', body: 'nit: rename this', createdAt: '2026-05-15T00:00:00Z' }],
      },
    ])
  })

  it('invokes gh api graphql with the pull request number and a reviewThreads query', async () => {
    const runner = jest.fn().mockResolvedValue(graphqlResponse([]))

    await getPullRequestReviewThreads(5, runner)

    expect(runner).toHaveBeenCalledTimes(1)
    const args = runner.mock.calls[0][0] as string[]
    expect(args[0]).toBe('api')
    expect(args[1]).toBe('graphql')
    expect(args).toContain('owner={owner}')
    expect(args).toContain('name={repo}')
    expect(args).toContain('number=5')
    const queryArg = args.find((arg) => arg.startsWith('query='))
    expect(queryArg).toContain('reviewThreads')
  })

  it('sanitizes control bytes out of comment bodies', async () => {
    const runner = jest.fn().mockResolvedValue(
      graphqlResponse([
        {
          path: 'a.ts',
          isResolved: false,
          isOutdated: false,
          comments: {
            nodes: [{ author: { login: 'mallory' }, body: '\x1b[31mdanger\x1b[0m', createdAt: '2026-05-15T00:00:00Z' }],
          },
        },
      ])
    )

    const result = await getPullRequestReviewThreads(1, runner)

    if (!result.ok) throw new Error('expected ok')
    expect(result.threads[0].comments[0].body).toBe('[31mdanger[0m')
  })

  it('returns an empty list when reviewThreads.nodes is empty', async () => {
    const runner = jest.fn().mockResolvedValue(graphqlResponse([]))
    await expect(getPullRequestReviewThreads(1, runner)).resolves.toEqual({ ok: true, threads: [] })
  })

  it('returns an empty list for a blank response', async () => {
    const runner = jest.fn().mockResolvedValue('')
    await expect(getPullRequestReviewThreads(1, runner)).resolves.toEqual({ ok: true, threads: [] })
  })

  it('defaults missing optional fields gracefully', async () => {
    const runner = jest.fn().mockResolvedValue(
      graphqlResponse([{ path: 'a.ts', isResolved: true, isOutdated: false, comments: { nodes: [] } }])
    )

    const result = await getPullRequestReviewThreads(1, runner)

    if (!result.ok) throw new Error('expected ok')
    expect(result.threads).toEqual([
      {
        path: 'a.ts',
        line: undefined,
        originalLine: undefined,
        isResolved: true,
        isOutdated: false,
        diffHunk: undefined,
        comments: [],
      },
    ])
  })

  it('surfaces runner errors as ok: false', async () => {
    const runner = jest.fn().mockRejectedValue(new Error('not authenticated'))
    await expect(getPullRequestReviewThreads(1, runner)).resolves.toEqual({
      ok: false,
      message: 'not authenticated',
    })
  })
})
