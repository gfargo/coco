import {
  createGiteaPullRequest,
  openGiteaPullRequest,
  mergeGiteaPullRequestByNumber,
  approveGiteaPullRequestByNumber,
  closeGiteaPullRequestByNumber,
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
  it('invokes the opener with the URL and returns ok:true on success', async () => {
    const opened: string[] = []
    const runner = async (u: string) => { opened.push(u) }
    const result = await openGiteaPullRequest('https://codeberg.org/owner/repo/pulls/1', runner)
    expect(opened).toEqual(['https://codeberg.org/owner/repo/pulls/1'])
    expect(result).toEqual({
      ok: true,
      message: 'Opened pull request: https://codeberg.org/owner/repo/pulls/1',
      url: 'https://codeberg.org/owner/repo/pulls/1',
    })
  })

  it('returns ok:false when the opener rejects', async () => {
    const runner = async () => { throw new Error('no browser found') }
    const result = await openGiteaPullRequest('https://codeberg.org/owner/repo/pulls/1', runner)
    expect(result.ok).toBe(false)
    expect(result.message).toBe('no browser found')
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
      'repos/owner/repo/labels?limit=50&page=1': JSON.stringify([{ id: 9, name: 'bug' }]),
    })
    const result = await addGiteaPullRequestLabel('owner/repo', 5, 'bug', runner)
    expect(result.ok).toBe(true)
    const labelCall = calls.find((c) => c.endpoint === 'repos/owner/repo/issues/5/labels')
    expect(labelCall).toBeDefined()
    expect(JSON.parse(labelCall?.body ?? '{}').labels).toEqual([9])
  })

  it('returns an explanatory error when the label does not exist', async () => {
    const { runner } = capturingRunner({
      'repos/owner/repo/labels?limit=50&page=1': JSON.stringify([]),
      'orgs/owner/labels?limit=50&page=1': JSON.stringify([]),
    })
    const result = await addGiteaPullRequestLabel('owner/repo', 5, 'missing', runner)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('not found')
    expect(result.message).not.toContain('Could not verify')
  })

  it('resolves a label on page 2 when the first page is full', async () => {
    const page1 = JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ id: i + 1, name: `label-${i + 1}` })))
    const page2 = JSON.stringify([{ id: 77, name: 'rare-label' }])
    const { calls, runner } = capturingRunner({
      'repos/owner/repo/labels?limit=50&page=1': page1,
      'repos/owner/repo/labels?limit=50&page=2': page2,
    })
    const result = await addGiteaPullRequestLabel('owner/repo', 5, 'rare-label', runner)
    expect(result.ok).toBe(true)
    const labelCall = calls.find((c) => c.endpoint === 'repos/owner/repo/issues/5/labels')
    expect(JSON.parse(labelCall?.body ?? '{}').labels).toEqual([77])
  })

  it('resolves a label from org labels when not in repo labels', async () => {
    const { calls, runner } = capturingRunner({
      'repos/owner/repo/labels?limit=50&page=1': '[]',
      'orgs/owner/labels?limit=50&page=1': JSON.stringify([{ id: 42, name: 'org-label' }]),
    })
    const result = await addGiteaPullRequestLabel('owner/repo', 5, 'org-label', runner)
    expect(result.ok).toBe(true)
    const labelCall = calls.find((c) => c.endpoint === 'repos/owner/repo/issues/5/labels')
    expect(JSON.parse(labelCall?.body ?? '{}').labels).toEqual([42])
  })

  it('returns "lookup failed" (not "create it") on API error', async () => {
    const runner = async (endpoint: string): Promise<string> => {
      if (endpoint.startsWith('repos/owner/repo/labels')) {
        throw Object.assign(new Error('Gitea API error 500: internal'), { status: 500 })
      }
      return '{}'
    }
    const result = await addGiteaPullRequestLabel('owner/repo', 5, 'bug', runner)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Could not verify')
    expect(result.message).not.toContain('Create it in Gitea first')
  })

  it('treats org 404 as "no org labels" and returns not-found for personal repos', async () => {
    const runner = async (endpoint: string): Promise<string> => {
      if (endpoint.startsWith('repos/owner/repo/labels')) return '[]'
      if (endpoint.startsWith('orgs/owner/labels')) {
        throw Object.assign(new Error('Gitea API error 404: not found'), { status: 404 })
      }
      return '{}'
    }
    const result = await addGiteaPullRequestLabel('owner/repo', 5, 'missing', runner)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('not found')
    expect(result.message).toContain('Create it in Gitea first')
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
