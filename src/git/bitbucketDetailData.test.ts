import {
  getBitbucketPullRequestDetail,
  getBitbucketIssueDetail,
  getBitbucketPullRequestChecks,
  getBitbucketPullRequestDiff,
  __test,
} from './bitbucketDetailData'

const { mapComments, parseParticipantsAsReviews, normalizeBitbucketBuildStatus } = __test

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  delete process.env.BITBUCKET_ACCESS_TOKEN
  delete process.env.BITBUCKET_USERNAME
  delete process.env.BITBUCKET_APP_PASSWORD
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('mapComments (1238)', () => {
  it('maps non-deleted comments to IssueComment', () => {
    const raw = [
      { content: { raw: 'hello' }, created_on: '2026-01-01', author: { nickname: 'alice' } },
      { content: { raw: '' }, created_on: '2026-01-02', author: { nickname: 'bob' } }, // empty — excluded
      { content: { raw: 'bye' }, created_on: '2026-01-03', author: { nickname: 'carol' }, deleted: true }, // deleted — excluded
    ]
    const mapped = mapComments(raw as Parameters<typeof mapComments>[0])
    expect(mapped).toHaveLength(1)
    expect(mapped[0]).toEqual({ author: 'alice', body: 'hello', createdAt: '2026-01-01' })
  })
})

describe('parseParticipantsAsReviews (1238)', () => {
  it('maps approved participants to APPROVED reviews', () => {
    const participants = [
      { user: { nickname: 'alice' }, role: 'REVIEWER', approved: true },
      { user: { nickname: 'bob' }, role: 'REVIEWER', approved: false },
      { user: { nickname: 'carol' }, role: 'AUTHOR', approved: false }, // AUTHOR excluded
    ]
    const reviews = parseParticipantsAsReviews(participants)
    expect(reviews).toHaveLength(2)
    expect(reviews.find((r) => r.author === 'alice')?.state).toBe('APPROVED')
    expect(reviews.find((r) => r.author === 'bob')?.state).toBe('COMMENTED')
  })

  it('returns empty array for non-array input', () => {
    expect(parseParticipantsAsReviews(undefined)).toEqual([])
    expect(parseParticipantsAsReviews(null)).toEqual([])
  })
})

describe('normalizeBitbucketBuildStatus (1238)', () => {
  it('maps SUCCESSFUL to success', () => expect(normalizeBitbucketBuildStatus('SUCCESSFUL')).toBe('success'))
  it('maps FAILED to failure', () => expect(normalizeBitbucketBuildStatus('FAILED')).toBe('failure'))
  it('maps INPROGRESS to in_progress', () => expect(normalizeBitbucketBuildStatus('INPROGRESS')).toBe('in_progress'))
  it('maps STOPPED to cancelled', () => expect(normalizeBitbucketBuildStatus('STOPPED')).toBe('cancelled'))
  it('lowercases unknown states', () => expect(normalizeBitbucketBuildStatus('PENDING')).toBe('pending'))
})

describe('getBitbucketPullRequestDetail (1238)', () => {
  it('returns a PR detail with body, comments, and reviews', async () => {
    const prPayload = JSON.stringify({
      description: 'My body',
      participants: [
        { user: { nickname: 'alice' }, role: 'REVIEWER', approved: true },
      ],
      source: { commit: { hash: 'deadbeef' } },
    })
    const commentsPayload = JSON.stringify({
      values: [{ content: { raw: 'LGTM' }, created_on: '2026-01-01', author: { nickname: 'bob' } }],
      pagelen: 50,
      page: 1,
    })
    const statusPayload = JSON.stringify({
      values: [{ key: 'ci', name: 'CI', state: 'SUCCESSFUL' }],
    })

    const runner = async (endpoint: string) => {
      if (endpoint.endsWith('/comments?pagelen=50&page=1')) return commentsPayload
      if (endpoint.includes('/commit/')) return statusPayload
      return prPayload
    }

    const result = await getBitbucketPullRequestDetail('ws/repo', 1, runner)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.detail.body).toBe('My body')
    expect(result.detail.comments).toHaveLength(1)
    expect(result.detail.comments[0].body).toBe('LGTM')
    expect(result.detail.reviews?.[0].state).toBe('APPROVED')
    expect(result.detail.statusCheckRollup?.[0].conclusion).toBe('success')
  })

  it('returns ok: false when the PR is not found', async () => {
    const result = await getBitbucketPullRequestDetail('ws/repo', 999, async () => '')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toBe('Empty response from Bitbucket for pull request #999')
  })

  it('returns ok: false on runner error, resolved via the auth-aware error path', async () => {
    const result = await getBitbucketPullRequestDetail('ws/repo', 1, async () => {
      throw new Error('network error')
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).not.toContain('Empty response')
    expect(result.message).toContain('Not authenticated to Bitbucket')
  })

  it('surfaces the underlying error when credentials are present but the request still fails', async () => {
    process.env.BITBUCKET_ACCESS_TOKEN = 'token'
    const result = await getBitbucketPullRequestDetail('ws/repo', 1, async (endpoint) => {
      if (endpoint === 'user') return '{}'
      throw new Error('pull request 1 not found')
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).not.toContain('Empty response')
    expect(result.message).toContain('pull request 1 not found')
  })

  it('sets commentsTruncated when the comment ceiling is hit while more pages remain', async () => {
    const prPayload = JSON.stringify({
      description: 'body',
      participants: [],
      source: { commit: { hash: 'abc' } },
    })
    // Always return a full page (50 comments) so the 20-page ceiling is hit.
    const fullPage = JSON.stringify({
      values: Array.from({ length: 50 }, (_, i) => ({
        content: { raw: `c${i}` },
        created_on: '2026-01-01',
        author: { nickname: 'a' },
      })),
    })
    const runner = async (endpoint: string) => {
      if (endpoint.includes('/comments')) return fullPage
      if (endpoint.includes('/commit/')) return JSON.stringify({ values: [] })
      return prPayload
    }
    const result = await getBitbucketPullRequestDetail('ws/repo', 1, runner)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 20 pages × 50 comments = 1000.
    expect(result.detail.comments).toHaveLength(1000)
    expect(result.detail.commentsTruncated).toBe(true)
  })

  it('sets commentsTruncated when a comment page fetch fails mid-pagination', async () => {
    const prPayload = JSON.stringify({
      description: 'body',
      participants: [],
      source: { commit: { hash: 'abc' } },
    })
    let page = 0
    const runner = async (endpoint: string) => {
      if (endpoint.includes('/comments')) {
        page++
        if (page === 1) {
          // Return a full page (50 items) so hasMore is true and we proceed to page 2.
          return JSON.stringify({
            values: Array.from({ length: 50 }, (_, i) => ({
              content: { raw: `c${i}` },
              created_on: '2026-01-01',
              author: { nickname: 'a' },
            })),
          })
        }
        // Empty output on page 2 → parsePage returns undefined → truncated.
        return ''
      }
      if (endpoint.includes('/commit/')) return JSON.stringify({ values: [] })
      return prPayload
    }
    const result = await getBitbucketPullRequestDetail('ws/repo', 1, runner)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.detail.comments).toHaveLength(50)
    expect(result.detail.commentsTruncated).toBe(true)
  })

  describe('getBitbucketPullRequestChecks (OSS-1615)', () => {
    it('fetches only the source commit statuses', async () => {
      const prPayload = JSON.stringify({ source: { commit: { hash: 'deadbeef' } } })
      const statusPayload = JSON.stringify({ values: [{ key: 'ci', name: 'CI', state: 'FAILED' }] })
      const runner = async (endpoint: string) => (endpoint.includes('/commit/') ? statusPayload : prPayload)

      const result = await getBitbucketPullRequestChecks('ws/repo', 1, runner)

      expect(result).toEqual({
        ok: true,
        checks: [{ name: 'CI', status: 'FAILED', conclusion: 'failure' }],
      })
    })

    it('returns ok: false when the PR is not found', async () => {
      const result = await getBitbucketPullRequestChecks('ws/repo', 999, async () => '')
      expect(result.ok).toBe(false)
    })
  })
})

describe('getBitbucketIssueDetail (1238)', () => {
  it('returns issue detail with body and comments', async () => {
    const issuePayload = JSON.stringify({ content: { raw: 'Issue description' } })
    const commentsPayload = JSON.stringify({
      values: [{ content: { raw: 'noted' }, created_on: '2026-02-01', author: { nickname: 'dave' } }],
      pagelen: 50,
      page: 1,
    })
    const runner = async (endpoint: string) => {
      if (endpoint.includes('/comments')) return commentsPayload
      return issuePayload
    }

    const result = await getBitbucketIssueDetail('ws/repo', 7, runner)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.detail.body).toBe('Issue description')
    expect(result.detail.comments[0].body).toBe('noted')
  })

  it('returns ok: false when the issue is not found', async () => {
    const result = await getBitbucketIssueDetail('ws/repo', 999, async () => '')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toBe('Empty response from Bitbucket for issue #999')
  })

  it('returns ok: false on runner error, resolved via the auth-aware error path', async () => {
    const result = await getBitbucketIssueDetail('ws/repo', 7, async () => {
      throw new Error('network error')
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).not.toContain('Empty response')
    expect(result.message).toContain('Not authenticated to Bitbucket')
  })
})

describe('getBitbucketPullRequestDiff (#1938)', () => {
  it('splits a raw diff into lines', async () => {
    const runner = async (endpoint: string) => {
      expect(endpoint).toBe('repositories/ws/repo/pullrequests/1/diff')
      return 'diff --git a/x b/x\n+added\n'
    }
    const result = await getBitbucketPullRequestDiff('ws/repo', 1, runner)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lines).toEqual(['diff --git a/x b/x', '+added'])
  })

  it('returns ok: false on runner error', async () => {
    const result = await getBitbucketPullRequestDiff('ws/repo', 1, async () => {
      throw new Error('not found')
    })
    expect(result.ok).toBe(false)
  })
})
