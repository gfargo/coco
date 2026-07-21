import { getGiteaPullRequestDetail, getGiteaIssueDetail, getGiteaPullRequestDiff, __test } from './giteaDetailData'

const { mapComments, parseReviews, normalizeGiteaBuildStatus } = __test

describe('mapComments (#826)', () => {
  it('maps non-empty comments to IssueComment', () => {
    const raw = [
      { body: 'hello', created_at: '2026-01-01', user: { login: 'alice' } },
      { body: '', created_at: '2026-01-02', user: { login: 'bob' } }, // empty — excluded
    ]
    const mapped = mapComments(raw as Parameters<typeof mapComments>[0])
    expect(mapped).toHaveLength(1)
    expect(mapped[0]).toEqual({ author: 'alice', body: 'hello', createdAt: '2026-01-01' })
  })
})

describe('parseReviews (#826)', () => {
  it('maps reviews with a resolvable author', () => {
    const raw = [
      { user: { login: 'alice' }, state: 'APPROVED', body: '', submitted_at: '2026-01-01' },
      { user: { login: 'bob' }, state: 'REQUEST_CHANGES', body: 'fix this', submitted_at: '2026-01-02' },
      { user: undefined, state: 'COMMENT', body: '' }, // no author — excluded
    ]
    const reviews = parseReviews(raw)
    expect(reviews).toHaveLength(2)
    expect(reviews.find((r) => r.author === 'alice')?.state).toBe('APPROVED')
    expect(reviews.find((r) => r.author === 'bob')?.state).toBe('REQUEST_CHANGES')
  })

  it('returns empty array for non-array input', () => {
    expect(parseReviews(undefined)).toEqual([])
    expect(parseReviews(null)).toEqual([])
  })
})

describe('normalizeGiteaBuildStatus (#826)', () => {
  it('maps success to success', () => expect(normalizeGiteaBuildStatus('success')).toBe('success'))
  it('maps failure and error to failure', () => {
    expect(normalizeGiteaBuildStatus('failure')).toBe('failure')
    expect(normalizeGiteaBuildStatus('error')).toBe('failure')
  })
  it('maps pending to in_progress', () => expect(normalizeGiteaBuildStatus('pending')).toBe('in_progress'))
  it('maps warning to neutral', () => expect(normalizeGiteaBuildStatus('warning')).toBe('neutral'))
  it('lowercases unknown states', () => expect(normalizeGiteaBuildStatus('SKIPPED')).toBe('skipped'))
})

describe('getGiteaPullRequestDetail (#826)', () => {
  it('returns a PR detail with body, comments, and reviews', async () => {
    const prPayload = JSON.stringify({ body: 'My body', head: { sha: 'deadbeef' } })
    const commentsPayload = JSON.stringify([
      { body: 'LGTM', created_at: '2026-01-01', user: { login: 'bob' } },
    ])
    const reviewsPayload = JSON.stringify([
      { user: { login: 'alice' }, state: 'APPROVED', body: '', submitted_at: '2026-01-01' },
    ])
    const statusPayload = JSON.stringify([{ context: 'ci', status: 'success' }])

    const runner = async (endpoint: string) => {
      if (endpoint.includes('/comments')) return commentsPayload
      if (endpoint.includes('/reviews')) return reviewsPayload
      if (endpoint.includes('/commits/')) return statusPayload
      return prPayload
    }

    const result = await getGiteaPullRequestDetail('owner/repo', 1, runner)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.detail.body).toBe('My body')
    expect(result.detail.comments).toHaveLength(1)
    expect(result.detail.comments[0].body).toBe('LGTM')
    expect(result.detail.reviews?.[0].state).toBe('APPROVED')
    expect(result.detail.statusCheckRollup?.[0].conclusion).toBe('success')
  })

  it('returns ok: false when the PR is not found', async () => {
    const result = await getGiteaPullRequestDetail('owner/repo', 999, async () => '')
    expect(result.ok).toBe(false)
  })

  it('returns ok: false on runner error', async () => {
    const result = await getGiteaPullRequestDetail('owner/repo', 1, async () => {
      throw new Error('network error')
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('pull request #1')
  })
})

describe('getGiteaIssueDetail (#826)', () => {
  it('returns issue detail with body and comments', async () => {
    const issuePayload = JSON.stringify({ body: 'Issue description' })
    const commentsPayload = JSON.stringify([
      { body: 'noted', created_at: '2026-02-01', user: { login: 'dave' } },
    ])
    const runner = async (endpoint: string) => {
      if (endpoint.includes('/comments')) return commentsPayload
      return issuePayload
    }

    const result = await getGiteaIssueDetail('owner/repo', 7, runner)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.detail.body).toBe('Issue description')
    expect(result.detail.comments[0].body).toBe('noted')
  })

  it('returns ok: false when the issue is not found', async () => {
    const result = await getGiteaIssueDetail('owner/repo', 999, async () => '')
    expect(result.ok).toBe(false)
  })
})

describe('getGiteaPullRequestDiff (#826)', () => {
  it('splits a raw diff into lines', async () => {
    const runner = async (endpoint: string) => {
      expect(endpoint).toBe('repos/owner/repo/pulls/1.diff')
      return 'diff --git a/x b/x\n+added\n'
    }
    const result = await getGiteaPullRequestDiff('owner/repo', 1, runner)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lines).toEqual(['diff --git a/x b/x', '+added'])
  })

  it('returns ok: false on runner error', async () => {
    const result = await getGiteaPullRequestDiff('owner/repo', 1, async () => {
      throw new Error('not found')
    })
    expect(result.ok).toBe(false)
  })
})
