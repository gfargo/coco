import { getBitbucketPullRequestDetail, getBitbucketIssueDetail, __test } from './bitbucketDetailData'

const { mapComments, parseParticipantsAsReviews, normalizeBitbucketBuildStatus } = __test

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
  })

  it('returns ok: false on runner error', async () => {
    const result = await getBitbucketPullRequestDetail('ws/repo', 1, async () => {
      throw new Error('network error')
    })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('network error')
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
  })
})
