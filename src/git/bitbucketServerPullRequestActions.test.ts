import type { BitbucketServerRunner, BitbucketServerRunnerOptions } from './bitbucketServerCli'
import {
  createBitbucketServerPullRequest,
  mergeBitbucketServerPullRequestByNumber,
  closeBitbucketServerPullRequestByNumber,
  addBitbucketServerPullRequestLabel,
  addBitbucketServerPullRequestReviewer,
} from './bitbucketServerPullRequestActions'

function mockRunner(
  impl: (endpoint: string, options?: BitbucketServerRunnerOptions) => Promise<string>
): jest.Mock<Promise<string>, [string, BitbucketServerRunnerOptions?]> & BitbucketServerRunner {
  return jest.fn(impl) as unknown as jest.Mock<Promise<string>, [string, BitbucketServerRunnerOptions?]> &
    BitbucketServerRunner
}

describe('createBitbucketServerPullRequest', () => {
  it('POSTs fromRef/toRef and returns the self link as url', async () => {
    const runner = mockRunner(async () =>
      JSON.stringify({ links: { self: [{ href: 'https://bb.acme.com/projects/TEAM/repos/repo/pull-requests/9' }] } })
    )
    const result = await createBitbucketServerPullRequest(
      'TEAM/repo',
      { base: 'main', head: 'feature/x', title: 'T', body: 'B' },
      runner
    )
    expect(result.ok).toBe(true)
    expect(result.url).toBe('https://bb.acme.com/projects/TEAM/repos/repo/pull-requests/9')

    const [endpoint, options] = runner.mock.calls[0]
    expect(endpoint).toBe('projects/TEAM/repos/repo/pull-requests')
    const body = JSON.parse((options as { body: string }).body)
    expect(body.fromRef).toEqual({
      id: 'refs/heads/feature/x',
      repository: { slug: 'repo', project: { key: 'TEAM' } },
    })
    expect(body.toRef).toEqual({
      id: 'refs/heads/main',
      repository: { slug: 'repo', project: { key: 'TEAM' } },
    })
  })

  it('rejects a flag-like branch name', async () => {
    const result = await createBitbucketServerPullRequest(
      'TEAM/repo',
      { base: 'main', head: '-x', title: 'T', body: 'B' },
      jest.fn()
    )
    expect(result.ok).toBe(false)
  })
})

describe('mergeBitbucketServerPullRequestByNumber', () => {
  it('fetches the current version, then merges with it as a query param', async () => {
    const runner = jest.fn(async (endpoint: string) => {
      if (endpoint === 'projects/TEAM/repos/repo/pull-requests/5') {
        return JSON.stringify({ version: 3 })
      }
      expect(endpoint).toBe('projects/TEAM/repos/repo/pull-requests/5/merge?version=3')
      return '{}'
    })
    const result = await mergeBitbucketServerPullRequestByNumber('TEAM/repo', 5, 'squash', runner)
    expect(result.ok).toBe(true)
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it('fails gracefully when the version cannot be resolved', async () => {
    const runner = jest.fn(async () => {
      throw new Error('not found')
    })
    const result = await mergeBitbucketServerPullRequestByNumber('TEAM/repo', 5, 'merge', runner)
    expect(result.ok).toBe(false)
  })
})

describe('closeBitbucketServerPullRequestByNumber', () => {
  it('declines with the current version', async () => {
    const runner = jest.fn(async (endpoint: string) => {
      if (endpoint === 'projects/TEAM/repos/repo/pull-requests/5') return JSON.stringify({ version: 1 })
      expect(endpoint).toBe('projects/TEAM/repos/repo/pull-requests/5/decline?version=1')
      return '{}'
    })
    const result = await closeBitbucketServerPullRequestByNumber('TEAM/repo', 5, runner)
    expect(result.ok).toBe(true)
  })
})

describe('addBitbucketServerPullRequestLabel', () => {
  it('is always unsupported', async () => {
    const result = await addBitbucketServerPullRequestLabel()
    expect(result.ok).toBe(false)
  })
})

describe('addBitbucketServerPullRequestReviewer', () => {
  it('fetches the current PR and PUTs it back with the reviewer appended', async () => {
    const runner = jest.fn(async (endpoint: string, options?: { method?: string; body?: string }) => {
      if (!options || options.method === undefined) {
        return JSON.stringify({ id: 5, version: 2, title: 'T', reviewers: [] })
      }
      expect(options.method).toBe('PUT')
      const body = JSON.parse(options.body as string)
      expect(body.reviewers).toEqual([{ user: { name: 'bob' } }])
      return '{}'
    })
    const result = await addBitbucketServerPullRequestReviewer('TEAM/repo', 5, 'bob', runner)
    expect(result.ok).toBe(true)
  })

  it('short-circuits when the reviewer is already present', async () => {
    const runner = jest.fn(async () =>
      JSON.stringify({ id: 5, version: 2, title: 'T', reviewers: [{ user: { name: 'bob' } }] })
    )
    const result = await addBitbucketServerPullRequestReviewer('TEAM/repo', 5, 'bob', runner)
    expect(result.ok).toBe(true)
    expect(result.message).toContain('already a reviewer')
  })

  it('rejects an unsafe username', async () => {
    const result = await addBitbucketServerPullRequestReviewer('TEAM/repo', 5, '-bad name', jest.fn())
    expect(result.ok).toBe(false)
  })
})
