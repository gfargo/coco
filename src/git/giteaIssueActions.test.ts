import {
  commentGiteaIssue,
  addGiteaIssueLabel,
  addGiteaIssueAssignee,
  closeGiteaIssue,
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
      'repos/owner/repo/labels?limit=50': JSON.stringify([{ id: 3, name: 'bug' }]),
    })
    const result = await addGiteaIssueLabel('owner/repo', 7, 'bug', runner)
    expect(result.ok).toBe(true)
    const labelCall = calls.find((c) => c.endpoint === 'repos/owner/repo/issues/7/labels')
    expect(JSON.parse(labelCall?.body ?? '{}').labels).toEqual([3])
  })

  it('returns an explanatory error when the label does not exist', async () => {
    const { runner } = capturingRunner({ 'repos/owner/repo/labels?limit=50': '[]' })
    const result = await addGiteaIssueLabel('owner/repo', 7, 'missing', runner)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('not found')
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
