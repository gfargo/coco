import {
  commentBitbucketIssue,
  addBitbucketIssueLabel,
  addBitbucketIssueAssignee,
  closeBitbucketIssue,
  reopenBitbucketIssue,
} from './bitbucketIssueActions'

type RunnerCall = { endpoint: string; method?: string; body?: string }

function capturingRunner(): {
  calls: RunnerCall[]
  runner: (e: string, o?: { method?: string; body?: string }) => Promise<string>
} {
  const calls: RunnerCall[] = []
  return {
    calls,
    runner: async (endpoint, opts) => {
      calls.push({ endpoint, method: opts?.method, body: opts?.body })
      return '{}'
    },
  }
}

// Save/restore env for auth-probe in error paths.
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

describe('commentBitbucketIssue (1238)', () => {
  it('POSTs to the issue comments endpoint', withCredentials(async () => {
    const { calls, runner } = capturingRunner()
    const result = await commentBitbucketIssue('ws/repo', 5, 'noted', runner)
    expect(result.ok).toBe(true)
    expect(calls[0].endpoint).toBe('repositories/ws/repo/issues/5/comments')
    expect(calls[0].method).toBe('POST')
    expect(JSON.parse(calls[0].body ?? '{}').content.raw).toBe('noted')
  }))

  it('returns error for empty body', async () => {
    const result = await commentBitbucketIssue('ws/repo', 5, '   ', async () => '{}')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Comment body required')
  })
})

describe('addBitbucketIssueLabel (1238)', () => {
  it('returns ok: false with an explanatory message about Bitbucket Cloud', async () => {
    const result = await addBitbucketIssueLabel()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('not supported on Bitbucket Cloud')
  })
})

describe('addBitbucketIssueAssignee (1238)', () => {
  it('PUTs the assignee nickname to the issue endpoint', withCredentials(async () => {
    const { calls, runner } = capturingRunner()
    const result = await addBitbucketIssueAssignee('ws/repo', 7, 'alice', runner)
    expect(result.ok).toBe(true)
    expect(calls[0].endpoint).toBe('repositories/ws/repo/issues/7')
    expect(calls[0].method).toBe('PUT')
    expect(JSON.parse(calls[0].body ?? '{}').assignee.nickname).toBe('alice')
  }))

  it('returns error for empty assignee', async () => {
    const result = await addBitbucketIssueAssignee('ws/repo', 7, '   ', async () => '{}')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Assignee username required')
  })

  it('rejects unsafe usernames (starting with -)', async () => {
    const result = await addBitbucketIssueAssignee('ws/repo', 7, '-hacker', async () => '{}')
    expect(result.ok).toBe(false)
  })
})

describe('closeBitbucketIssue (1238)', () => {
  it('PUTs status=resolved', withCredentials(async () => {
    const { calls, runner } = capturingRunner()
    const result = await closeBitbucketIssue('ws/repo', 7, runner)
    expect(result.ok).toBe(true)
    expect(calls[0].method).toBe('PUT')
    expect(JSON.parse(calls[0].body ?? '{}').status).toBe('resolved')
  }))
})

describe('reopenBitbucketIssue (1238)', () => {
  it('PUTs status=open', withCredentials(async () => {
    const { calls, runner } = capturingRunner()
    const result = await reopenBitbucketIssue('ws/repo', 7, runner)
    expect(result.ok).toBe(true)
    expect(calls[0].method).toBe('PUT')
    expect(JSON.parse(calls[0].body ?? '{}').status).toBe('open')
  }))
})
