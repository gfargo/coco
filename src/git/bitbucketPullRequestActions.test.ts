import {
  createBitbucketPullRequest,
  openBitbucketPullRequest,
  mergeBitbucketPullRequestByNumber,
  approveBitbucketPullRequestByNumber,
  closeBitbucketPullRequestByNumber,
  commentBitbucketPullRequestByNumber,
  requestChangesBitbucketPullRequestByNumber,
  addBitbucketPullRequestLabel,
  addBitbucketPullRequestReviewer,
  mergeBitbucketPullRequest,
  closeBitbucketPullRequest,
} from './bitbucketPullRequestActions'

type RunnerCall = { endpoint: string; method?: string; body?: string }

function capturingRunner(
  responses: Record<string, string> = {}
): { calls: RunnerCall[]; runner: (e: string, o?: { method?: string; body?: string }) => Promise<string> } {
  const calls: RunnerCall[] = []
  const runner = async (endpoint: string, opts?: { method?: string; body?: string }) => {
    calls.push({ endpoint, method: opts?.method, body: opts?.body })
    return responses[endpoint] ?? responses['*'] ?? '{}'
  }
  return { calls, runner }
}

// Save/restore env for auth status probes in error paths.
function withCredentials(fn: () => Promise<void>) {
  return async () => {
    const saved = process.env.BITBUCKET_ACCESS_TOKEN
    process.env.BITBUCKET_ACCESS_TOKEN = 'test-token'
    try {
      await fn()
    } finally {
      if (saved === undefined) delete process.env.BITBUCKET_ACCESS_TOKEN
      else process.env.BITBUCKET_ACCESS_TOKEN = saved
    }
  }
}

describe('createBitbucketPullRequest (1238)', () => {
  it('POSTs to the pullrequests endpoint with the correct body', withCredentials(async () => {
    const createdPR = JSON.stringify({ id: 42, links: { html: { href: 'https://bitbucket.org/ws/repo/pull-requests/42' } } })
    const { calls, runner } = capturingRunner({ 'repositories/ws/repo/pullrequests': createdPR })
    const result = await createBitbucketPullRequest('ws/repo', { base: 'main', head: 'feature', title: 'T', body: 'B' }, runner)
    expect(result.ok).toBe(true)
    expect(result.url).toBe('https://bitbucket.org/ws/repo/pull-requests/42')
    expect(calls[0].endpoint).toBe('repositories/ws/repo/pullrequests')
    expect(calls[0].method).toBe('POST')
    const parsed = JSON.parse(calls[0].body ?? '{}')
    expect(parsed.source.branch.name).toBe('feature')
    expect(parsed.destination.branch.name).toBe('main')
    expect(parsed.title).toBe('T')
  }))

  it('sets draft: true when draft is requested', withCredentials(async () => {
    const { calls, runner } = capturingRunner({ '*': '{"id":1,"links":{"html":{"href":"u"}}}' })
    await createBitbucketPullRequest('ws/repo', { base: 'main', head: 'f', title: 'T', body: 'B', draft: true }, runner)
    expect(JSON.parse(calls[0].body ?? '{}').draft).toBe(true)
  }))

  it('rejects flag-like branch names', async () => {
    const result = await createBitbucketPullRequest('ws/repo', { base: '-main', head: 'f', title: 'T', body: 'B' }, async () => '{}')
    expect(result.ok).toBe(false)
    expect(result.message).toContain("'")
  })
})

describe('openBitbucketPullRequest (1238)', () => {
  it('returns the URL to open in the browser', () => {
    const result = openBitbucketPullRequest('https://bitbucket.org/ws/repo/pull-requests/1')
    expect(result.ok).toBe(true)
    expect(result.url).toBe('https://bitbucket.org/ws/repo/pull-requests/1')
  })
})

describe('mergeBitbucketPullRequestByNumber (1238)', () => {
  it('POSTs to the merge endpoint with the correct strategy', withCredentials(async () => {
    const { calls, runner } = capturingRunner()
    await mergeBitbucketPullRequestByNumber('ws/repo', 5, 'squash', runner)
    expect(calls[0].endpoint).toBe('repositories/ws/repo/pullrequests/5/merge')
    expect(calls[0].method).toBe('POST')
    expect(JSON.parse(calls[0].body ?? '{}').merge_strategy).toBe('squash')
  }))

  it('maps rebase strategy to fast_forward', withCredentials(async () => {
    const { calls, runner } = capturingRunner()
    await mergeBitbucketPullRequestByNumber('ws/repo', 5, 'rebase', runner)
    expect(JSON.parse(calls[0].body ?? '{}').merge_strategy).toBe('fast_forward')
  }))

  it('maps merge strategy to merge_commit', withCredentials(async () => {
    const { calls, runner } = capturingRunner()
    await mergeBitbucketPullRequestByNumber('ws/repo', 5, 'merge', runner)
    expect(JSON.parse(calls[0].body ?? '{}').merge_strategy).toBe('merge_commit')
  }))
})

describe('approveBitbucketPullRequestByNumber (1238)', () => {
  it('POSTs to the approve endpoint', withCredentials(async () => {
    const { calls, runner } = capturingRunner()
    const result = await approveBitbucketPullRequestByNumber('ws/repo', 5, runner)
    expect(result.ok).toBe(true)
    expect(calls[0].endpoint).toBe('repositories/ws/repo/pullrequests/5/approve')
    expect(calls[0].method).toBe('POST')
  }))
})

describe('closeBitbucketPullRequestByNumber (1238)', () => {
  it('POSTs to the decline endpoint', withCredentials(async () => {
    const { calls, runner } = capturingRunner()
    const result = await closeBitbucketPullRequestByNumber('ws/repo', 5, runner)
    expect(result.ok).toBe(true)
    expect(calls[0].endpoint).toBe('repositories/ws/repo/pullrequests/5/decline')
  }))
})

describe('commentBitbucketPullRequestByNumber (1238)', () => {
  it('POSTs the comment to the comments endpoint', withCredentials(async () => {
    const { calls, runner } = capturingRunner()
    const result = await commentBitbucketPullRequestByNumber('ws/repo', 5, 'hello', runner)
    expect(result.ok).toBe(true)
    expect(calls[0].endpoint).toBe('repositories/ws/repo/pullrequests/5/comments')
    expect(JSON.parse(calls[0].body ?? '{}').content.raw).toBe('hello')
  }))

  it('returns error for empty comment', async () => {
    const result = await commentBitbucketPullRequestByNumber('ws/repo', 5, '   ', async () => '{}')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Comment body required')
  })
})

describe('requestChangesBitbucketPullRequestByNumber (1238)', () => {
  it('posts a comment with "Requested changes:" prefix', withCredentials(async () => {
    const { calls, runner } = capturingRunner()
    await requestChangesBitbucketPullRequestByNumber('ws/repo', 5, 'fix this', runner)
    const body = JSON.parse(calls[0].body ?? '{}')
    expect(body.content.raw).toBe('Requested changes: fix this')
  }))
})

describe('addBitbucketPullRequestLabel (1238)', () => {
  it('returns ok: false with an explanatory message', async () => {
    const result = await addBitbucketPullRequestLabel()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('not supported on Bitbucket Cloud')
  })
})

describe('mergeBitbucketPullRequest current-branch (1238)', () => {
  it('returns error when no current branch is provided', async () => {
    const result = await mergeBitbucketPullRequest('ws/repo', undefined, 'merge', async () => '{}')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('No current branch')
  })

  it('returns error when no open PR is found for the branch', withCredentials(async () => {
    const runner = async (endpoint: string) => {
      if (endpoint === 'user') return '{}'
      // pullrequests search returns empty
      return JSON.stringify({ values: [] })
    }
    const result = await mergeBitbucketPullRequest('ws/repo', 'feature/x', 'merge', runner)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('feature/x')
  }))
})

describe('closeBitbucketPullRequest current-branch (1238)', () => {
  it('declines the PR for the current branch', withCredentials(async () => {
    const calls: RunnerCall[] = []
    const runner = async (endpoint: string, opts?: { method?: string; body?: string }) => {
      calls.push({ endpoint, method: opts?.method })
      if (endpoint === 'user') return '{}'
      if (endpoint.includes('pullrequests?q=')) return JSON.stringify({ values: [{ id: 3 }] })
      return '{}'
    }
    const result = await closeBitbucketPullRequest('ws/repo', 'feature/x', runner)
    expect(result.ok).toBe(true)
    const declineCall = calls.find((c) => c.endpoint.includes('/decline'))
    expect(declineCall).toBeDefined()
    expect(declineCall?.endpoint).toBe('repositories/ws/repo/pullrequests/3/decline')
  }))
})
