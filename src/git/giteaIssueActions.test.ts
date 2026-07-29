import {
  commentGiteaIssue,
  addGiteaIssueLabel,
  addGiteaIssueAssignee,
  closeGiteaIssue,
  createGiteaIssue,
  reopenGiteaIssue,
} from './giteaIssueActions'

type RunnerCall = { endpoint: string; method?: string; body?: string }

function capturingRunner(
  responses: Record<string, string> = {}
): { calls: RunnerCall[]; runner: (e: string, o?: { method?: string; body?: string }) => Promise<string> } {
  const calls: RunnerCall[] = []
  return {
    calls,
    runner: async (endpoint, opts) => {
      calls.push({ endpoint, method: opts?.method, body: opts?.body })
      return responses[endpoint] ?? responses['*'] ?? '{}'
    },
  }
}

describe('commentGiteaIssue (#826)', () => {
  it('POSTs to the issue comments endpoint', async () => {
    const { calls, runner } = capturingRunner()
    const result = await commentGiteaIssue('owner/repo', 5, 'noted', runner)
    expect(result.ok).toBe(true)
    expect(calls[0].endpoint).toBe('repos/owner/repo/issues/5/comments')
    expect(calls[0].method).toBe('POST')
    expect(JSON.parse(calls[0].body ?? '{}').body).toBe('noted')
  })

  it('returns error for empty body', async () => {
    const result = await commentGiteaIssue('owner/repo', 5, '   ', async () => '{}')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Comment body required')
  })
})

describe('addGiteaIssueLabel (#826)', () => {
  it('resolves the label name to an id, then posts it', async () => {
    const { calls, runner } = capturingRunner({
      'repos/owner/repo/labels?limit=50&page=1': JSON.stringify([{ id: 3, name: 'bug' }]),
    })
    const result = await addGiteaIssueLabel('owner/repo', 7, 'bug', runner)
    expect(result.ok).toBe(true)
    const labelCall = calls.find((c) => c.endpoint === 'repos/owner/repo/issues/7/labels')
    expect(JSON.parse(labelCall?.body ?? '{}').labels).toEqual([3])
  })

  it('returns an explanatory error when the label does not exist', async () => {
    const { runner } = capturingRunner({
      'repos/owner/repo/labels?limit=50&page=1': '[]',
      'orgs/owner/labels?limit=50&page=1': '[]',
    })
    const result = await addGiteaIssueLabel('owner/repo', 7, 'missing', runner)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('not found')
    expect(result.message).not.toContain('Could not verify')
  })

  it('resolves a label on page 2 when the first page is full', async () => {
    const page1 = JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ id: i + 1, name: `label-${i + 1}` })))
    const page2 = JSON.stringify([{ id: 99, name: 'rare-label' }])
    const { calls, runner } = capturingRunner({
      'repos/owner/repo/labels?limit=50&page=1': page1,
      'repos/owner/repo/labels?limit=50&page=2': page2,
    })
    const result = await addGiteaIssueLabel('owner/repo', 7, 'rare-label', runner)
    expect(result.ok).toBe(true)
    const labelCall = calls.find((c) => c.endpoint === 'repos/owner/repo/issues/7/labels')
    expect(JSON.parse(labelCall?.body ?? '{}').labels).toEqual([99])
  })

  it('resolves a label from org labels when not in repo labels', async () => {
    const { calls, runner } = capturingRunner({
      'repos/owner/repo/labels?limit=50&page=1': '[]',
      'orgs/owner/labels?limit=50&page=1': JSON.stringify([{ id: 55, name: 'org-label' }]),
    })
    const result = await addGiteaIssueLabel('owner/repo', 7, 'org-label', runner)
    expect(result.ok).toBe(true)
    const labelCall = calls.find((c) => c.endpoint === 'repos/owner/repo/issues/7/labels')
    expect(JSON.parse(labelCall?.body ?? '{}').labels).toEqual([55])
  })

  it('returns "lookup failed" (not "create it") on API error', async () => {
    const runner = async (endpoint: string): Promise<string> => {
      if (endpoint.startsWith('repos/owner/repo/labels')) {
        throw Object.assign(new Error('Gitea API error 500: internal'), { status: 500 })
      }
      return '{}'
    }
    const result = await addGiteaIssueLabel('owner/repo', 7, 'bug', runner)
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
    const result = await addGiteaIssueLabel('owner/repo', 7, 'missing', runner)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('not found')
    expect(result.message).toContain('Create it in Gitea first')
  })
})

describe('addGiteaIssueAssignee (#826)', () => {
  it('PATCHes the assignees array on the issue endpoint', async () => {
    const { calls, runner } = capturingRunner()
    const result = await addGiteaIssueAssignee('owner/repo', 7, 'alice', runner)
    expect(result.ok).toBe(true)
    expect(calls[0].endpoint).toBe('repos/owner/repo/issues/7')
    expect(calls[0].method).toBe('PATCH')
    expect(JSON.parse(calls[0].body ?? '{}').assignees).toEqual(['alice'])
  })

  it('returns error for empty assignee', async () => {
    const result = await addGiteaIssueAssignee('owner/repo', 7, '   ', async () => '{}')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Assignee username required')
  })

  it('rejects unsafe usernames (starting with -)', async () => {
    const result = await addGiteaIssueAssignee('owner/repo', 7, '-hacker', async () => '{}')
    expect(result.ok).toBe(false)
  })
})

describe('closeGiteaIssue (#826)', () => {
  it('PATCHes state=closed', async () => {
    const { calls, runner } = capturingRunner()
    const result = await closeGiteaIssue('owner/repo', 7, runner)
    expect(result.ok).toBe(true)
    expect(calls[0].method).toBe('PATCH')
    expect(JSON.parse(calls[0].body ?? '{}').state).toBe('closed')
  })
})

describe('reopenGiteaIssue (#826)', () => {
  it('PATCHes state=open', async () => {
    const { calls, runner } = capturingRunner()
    const result = await reopenGiteaIssue('owner/repo', 7, runner)
    expect(result.ok).toBe(true)
    expect(calls[0].method).toBe('PATCH')
    expect(JSON.parse(calls[0].body ?? '{}').state).toBe('open')
  })
})

describe('createGiteaIssue', () => {
  it('POSTs to the issues endpoint and parses the URL', async () => {
    const { calls, runner } = capturingRunner({
      'repos/owner/repo/issues': JSON.stringify({ html_url: 'https://gitea.example/owner/repo/issues/9' }),
    })
    const result = await createGiteaIssue('owner/repo', { title: 'Bug', body: 'details' }, runner)
    expect(result).toEqual({
      ok: true,
      message: 'Created issue: https://gitea.example/owner/repo/issues/9',
      url: 'https://gitea.example/owner/repo/issues/9',
    })
    expect(calls[0].endpoint).toBe('repos/owner/repo/issues')
    expect(calls[0].method).toBe('POST')
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ title: 'Bug', body: 'details' })
  })

  it('rejects a blank title without shelling out', async () => {
    const result = await createGiteaIssue('owner/repo', { title: '   ', body: 'b' }, async () => '{}')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Issue title required')
  })
})
