import {
  createGiteaPullRequest,
  openGiteaPullRequest,
  mergeGiteaPullRequestByNumber,
  approveGiteaPullRequestByNumber,
  closeGiteaPullRequestByNumber,
  reopenGiteaPullRequestByNumber,
  markGiteaPullRequestReadyByNumber,
  commentGiteaPullRequestByNumber,
  requestChangesGiteaPullRequestByNumber,
  addGiteaPullRequestLabel,
  addGiteaPullRequestReviewer,
  mergeGiteaPullRequest,
  closeGiteaPullRequest,
} from './giteaPullRequestActions'

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

// Save/restore env for auth-status probes on the error path.
function withToken(fn: () => Promise<void>) {
  return async () => {
    const saved = process.env.GITEA_TOKEN
    process.env.GITEA_TOKEN = 'test-token'
    try {
      await fn()
    } finally {
      if (saved === undefined) delete process.env.GITEA_TOKEN
      else process.env.GITEA_TOKEN = saved
    }
  }
}

describe('createGiteaPullRequest (#826)', () => {
  it('POSTs to the pulls endpoint with the correct body', async () => {
    const createdPR = JSON.stringify({ number: 42, html_url: 'https://codeberg.org/owner/repo/pulls/42' })
    const { calls, runner } = capturingRunner({ 'repos/owner/repo/pulls': createdPR })
    const result = await createGiteaPullRequest('owner/repo', { base: 'main', head: 'feature', title: 'T', body: 'B' }, runner)
    expect(result.ok).toBe(true)
    expect(result.url).toBe('https://codeberg.org/owner/repo/pulls/42')
    expect(calls[0].endpoint).toBe('repos/owner/repo/pulls')
    expect(calls[0].method).toBe('POST')
    const parsed = JSON.parse(calls[0].body ?? '{}')
    expect(parsed.head).toBe('feature')
    expect(parsed.base).toBe('main')
    expect(parsed.title).toBe('T')
  })

  it('prefixes the title with [WIP] when draft is requested', async () => {
    const { calls, runner } = capturingRunner({ '*': '{"number":1,"html_url":"u"}' })
    await createGiteaPullRequest('owner/repo', { base: 'main', head: 'f', title: 'T', body: 'B', draft: true }, runner)
    expect(JSON.parse(calls[0].body ?? '{}').title).toBe('[WIP] T')
  })

  it('does not double-prefix an already-WIP title', async () => {
    const { calls, runner } = capturingRunner({ '*': '{"number":1,"html_url":"u"}' })
    await createGiteaPullRequest('owner/repo', { base: 'main', head: 'f', title: '[WIP] T', body: 'B', draft: true }, runner)
    expect(JSON.parse(calls[0].body ?? '{}').title).toBe('[WIP] T')
  })

  it('rejects flag-like branch names', async () => {
    const result = await createGiteaPullRequest('owner/repo', { base: '-main', head: 'f', title: 'T', body: 'B' }, async () => '{}')
    expect(result.ok).toBe(false)
    expect(result.message).toContain("'")
  })
})

describe('openGiteaPullRequest (#826)', () => {
  it('returns the URL to open in the browser', () => {
    const result = openGiteaPullRequest('https://codeberg.org/owner/repo/pulls/1')
    expect(result.ok).toBe(true)
    expect(result.url).toBe('https://codeberg.org/owner/repo/pulls/1')
  })
})

describe('mergeGiteaPullRequestByNumber (#826)', () => {
  it('POSTs to the merge endpoint with the Do field mapped from strategy', async () => {
    const { calls, runner } = capturingRunner()
    await mergeGiteaPullRequestByNumber('owner/repo', 5, 'squash', runner)
    expect(calls[0].endpoint).toBe('repos/owner/repo/pulls/5/merge')
    expect(calls[0].method).toBe('POST')
    expect(JSON.parse(calls[0].body ?? '{}').Do).toBe('squash')
  })

  it('maps merge strategy to merge', async () => {
    const { calls, runner } = capturingRunner()
    await mergeGiteaPullRequestByNumber('owner/repo', 5, 'merge', runner)
    expect(JSON.parse(calls[0].body ?? '{}').Do).toBe('merge')
  })

  it('maps rebase strategy to rebase', async () => {
    const { calls, runner } = capturingRunner()
    await mergeGiteaPullRequestByNumber('owner/repo', 5, 'rebase', runner)
    expect(JSON.parse(calls[0].body ?? '{}').Do).toBe('rebase')
  })
})

describe('approveGiteaPullRequestByNumber (#826)', () => {
  it('POSTs an APPROVED review', async () => {
    const { calls, runner } = capturingRunner()
    const result = await approveGiteaPullRequestByNumber('owner/repo', 5, runner)
    expect(result.ok).toBe(true)
    expect(calls[0].endpoint).toBe('repos/owner/repo/pulls/5/reviews')
    expect(JSON.parse(calls[0].body ?? '{}').event).toBe('APPROVED')
  })
})

describe('closeGiteaPullRequestByNumber (#826)', () => {
  it('PATCHes state=closed', async () => {
    const { calls, runner } = capturingRunner()
    const result = await closeGiteaPullRequestByNumber('owner/repo', 5, runner)
    expect(result.ok).toBe(true)
    expect(calls[0].endpoint).toBe('repos/owner/repo/pulls/5')
    expect(calls[0].method).toBe('PATCH')
    expect(JSON.parse(calls[0].body ?? '{}').state).toBe('closed')
  })
})

describe('reopenGiteaPullRequestByNumber (#1933)', () => {
  it('PATCHes state=open', async () => {
    const { calls, runner } = capturingRunner()
    const result = await reopenGiteaPullRequestByNumber('owner/repo', 5, runner)
    expect(result.ok).toBe(true)
    expect(calls[0].endpoint).toBe('repos/owner/repo/pulls/5')
    expect(calls[0].method).toBe('PATCH')
    expect(JSON.parse(calls[0].body ?? '{}').state).toBe('open')
  })
})

describe('markGiteaPullRequestReadyByNumber (#1933)', () => {
  it('PATCHes draft: false when the PR has a real draft boolean set', async () => {
    const { calls, runner } = capturingRunner({
      'repos/owner/repo/pulls/5': JSON.stringify({ draft: true, title: 'Add feature' }),
    })
    const result = await markGiteaPullRequestReadyByNumber('owner/repo', 5, runner)
    expect(calls[1].endpoint).toBe('repos/owner/repo/pulls/5')
    expect(calls[1].method).toBe('PATCH')
    expect(JSON.parse(calls[1].body ?? '{}').draft).toBe(false)
    expect(result).toEqual({ ok: true, message: 'Marked pull request #5 as ready for review' })
  })

  it('is a no-op when draft: false is set, even if the title has a [WIP] prefix', async () => {
    const { calls, runner } = capturingRunner({
      'repos/owner/repo/pulls/5': JSON.stringify({ draft: false, title: '[WIP] Add feature' }),
    })
    const result = await markGiteaPullRequestReadyByNumber('owner/repo', 5, runner)
    expect(calls).toHaveLength(1)
    expect(result).toEqual({ ok: true, message: 'Pull request #5 is not a draft' })
  })

  it('falls back to stripping the [WIP] title prefix when there is no draft boolean', async () => {
    const { calls, runner } = capturingRunner({
      'repos/owner/repo/pulls/5': JSON.stringify({ title: '[WIP] Add feature' }),
    })
    const result = await markGiteaPullRequestReadyByNumber('owner/repo', 5, runner)
    expect(calls[0]).toEqual({ endpoint: 'repos/owner/repo/pulls/5', method: undefined, body: undefined })
    expect(calls[1].endpoint).toBe('repos/owner/repo/pulls/5')
    expect(calls[1].method).toBe('PATCH')
    expect(JSON.parse(calls[1].body ?? '{}').title).toBe('Add feature')
    expect(result).toEqual({ ok: true, message: 'Marked pull request #5 as ready for review' })
  })

  it('is a no-op when there is no draft boolean and the title has no [WIP] prefix', async () => {
    const { calls, runner } = capturingRunner({
      'repos/owner/repo/pulls/5': JSON.stringify({ title: 'Add feature' }),
    })
    const result = await markGiteaPullRequestReadyByNumber('owner/repo', 5, runner)
    expect(calls).toHaveLength(1)
    expect(result).toEqual({ ok: true, message: 'Pull request #5 is not a draft' })
  })

  it('refuses to PATCH an empty title when it is only the [WIP] prefix', async () => {
    const { calls, runner } = capturingRunner({
      'repos/owner/repo/pulls/5': JSON.stringify({ title: '[WIP]' }),
    })
    const result = await markGiteaPullRequestReadyByNumber('owner/repo', 5, runner)
    expect(calls).toHaveLength(1)
    expect(result.ok).toBe(false)
  })
})

describe('commentGiteaPullRequestByNumber (#826)', () => {
  it('POSTs the comment to the issue-comments endpoint', async () => {
    const { calls, runner } = capturingRunner()
    const result = await commentGiteaPullRequestByNumber('owner/repo', 5, 'hello', runner)
    expect(result.ok).toBe(true)
    expect(calls[0].endpoint).toBe('repos/owner/repo/issues/5/comments')
    expect(JSON.parse(calls[0].body ?? '{}').body).toBe('hello')
  })

  it('returns error for empty comment', async () => {
    const result = await commentGiteaPullRequestByNumber('owner/repo', 5, '   ', async () => '{}')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Comment body required')
  })
})

describe('requestChangesGiteaPullRequestByNumber (#826)', () => {
  it('POSTs a REQUEST_CHANGES review', async () => {
    const { calls, runner } = capturingRunner()
    await requestChangesGiteaPullRequestByNumber('owner/repo', 5, 'fix this', runner)
    const body = JSON.parse(calls[0].body ?? '{}')
    expect(body.event).toBe('REQUEST_CHANGES')
    expect(body.body).toBe('fix this')
  })
})

describe('addGiteaPullRequestLabel (#826)', () => {
  it('resolves the label name to an id, then posts it', async () => {
    const { calls, runner } = capturingRunner({
      'repos/owner/repo/labels?limit=50': JSON.stringify([{ id: 9, name: 'bug' }]),
    })
    const result = await addGiteaPullRequestLabel('owner/repo', 5, 'bug', runner)
    expect(result.ok).toBe(true)
    const labelCall = calls.find((c) => c.endpoint === 'repos/owner/repo/issues/5/labels')
    expect(labelCall).toBeDefined()
    expect(JSON.parse(labelCall?.body ?? '{}').labels).toEqual([9])
  })

  it('returns an explanatory error when the label does not exist', async () => {
    const { runner } = capturingRunner({ 'repos/owner/repo/labels?limit=50': JSON.stringify([]) })
    const result = await addGiteaPullRequestLabel('owner/repo', 5, 'missing', runner)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('not found')
  })
})

describe('addGiteaPullRequestReviewer (#826)', () => {
  it('POSTs to the requested_reviewers endpoint', async () => {
    const { calls, runner } = capturingRunner()
    const result = await addGiteaPullRequestReviewer('owner/repo', 5, 'alice', runner)
    expect(result.ok).toBe(true)
    expect(calls[0].endpoint).toBe('repos/owner/repo/pulls/5/requested_reviewers')
    expect(JSON.parse(calls[0].body ?? '{}').reviewers).toEqual(['alice'])
  })

  it('rejects unsafe usernames', async () => {
    const result = await addGiteaPullRequestReviewer('owner/repo', 5, '-hacker', async () => '{}')
    expect(result.ok).toBe(false)
  })
})

describe('mergeGiteaPullRequest current-branch (#826)', () => {
  it('returns error when no current branch is provided', async () => {
    const result = await mergeGiteaPullRequest('owner/repo', undefined, 'merge', async () => '{}')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('No current branch')
  })

  it(
    'returns error when no open PR is found for the branch',
    withToken(async () => {
      const runner = async () => '[]'
      const result = await mergeGiteaPullRequest('owner/repo', 'feature/x', 'merge', runner)
      expect(result.ok).toBe(false)
      expect(result.message).toContain('feature/x')
    })
  )
})

describe('closeGiteaPullRequest current-branch (#826)', () => {
  it('closes the PR matching the current branch', async () => {
    const calls: RunnerCall[] = []
    const runner = async (endpoint: string, opts?: { method?: string; body?: string }) => {
      calls.push({ endpoint, method: opts?.method })
      if (endpoint.startsWith('repos/owner/repo/pulls?state=open')) {
        return JSON.stringify([{ number: 3, head: { ref: 'feature/x' } }])
      }
      return '{}'
    }
    const result = await closeGiteaPullRequest('owner/repo', 'feature/x', runner)
    expect(result.ok).toBe(true)
    const closeCall = calls.find((c) => c.method === 'PATCH')
    expect(closeCall).toBeDefined()
    expect(closeCall?.endpoint).toBe('repos/owner/repo/pulls/3')
  })
})
