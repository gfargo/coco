import {
  getBitbucketServerPullRequestDetail,
  getBitbucketServerIssueDetail,
  __test,
} from './bitbucketServerDetailData'

const { mapActivitiesToComments, parseReviewers, normalizeBitbucketServerBuildStatus } = __test

describe('mapActivitiesToComments', () => {
  it('keeps only COMMENTED activities with non-empty text', () => {
    const comments = mapActivitiesToComments([
      { action: 'APPROVED' },
      { action: 'COMMENTED', comment: { text: '  ', author: { slug: 'a' } } },
      { action: 'COMMENTED', comment: { text: 'hi', author: { slug: 'alice' }, createdDate: 1700000000000 } },
    ])
    expect(comments).toEqual([
      { author: 'alice', body: 'hi', createdAt: new Date(1700000000000).toISOString() },
    ])
  })
})

describe('parseReviewers', () => {
  it('maps user + status into PullRequestReview shape', () => {
    const reviews = parseReviewers([
      { user: { slug: 'bob' }, status: 'APPROVED' },
      { user: {} },
    ])
    expect(reviews).toEqual([{ author: 'bob', state: 'APPROVED', body: '', submittedAt: '' }])
  })
})

describe('normalizeBitbucketServerBuildStatus', () => {
  it('maps known states', () => {
    expect(normalizeBitbucketServerBuildStatus('SUCCESSFUL')).toBe('success')
    expect(normalizeBitbucketServerBuildStatus('FAILED')).toBe('failure')
    expect(normalizeBitbucketServerBuildStatus('INPROGRESS')).toBe('in_progress')
  })
})

describe('getBitbucketServerPullRequestDetail', () => {
  it('assembles body, comments, reviews, and status checks', async () => {
    const runner = jest.fn(async (endpoint: string) => {
      if (endpoint.endsWith('/pull-requests/5')) {
        return JSON.stringify({
          description: 'body text',
          reviewers: [{ user: { slug: 'bob' }, status: 'APPROVED' }],
          fromRef: { latestCommit: 'sha123' },
        })
      }
      if (endpoint.includes('/activities')) {
        return JSON.stringify({
          isLastPage: true,
          values: [{ action: 'COMMENTED', comment: { text: 'nice', author: { slug: 'alice' } } }],
        })
      }
      if (endpoint.includes('rest/build-status')) {
        return JSON.stringify({ values: [{ name: 'ci', state: 'SUCCESSFUL' }] })
      }
      throw new Error(`unexpected endpoint ${endpoint}`)
    })

    const result = await getBitbucketServerPullRequestDetail('TEAM/repo', 5, runner, 'bb.acme.com')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.detail.body).toBe('body text')
    expect(result.detail.comments).toEqual([{ author: 'alice', body: 'nice', createdAt: '' }])
    expect(result.detail.reviews).toEqual([{ author: 'bob', state: 'APPROVED', body: '', submittedAt: '' }])
    expect(result.detail.statusCheckRollup[0].conclusion).toBe('success')
  })

  it('returns ok:false for a malformed project path', async () => {
    const result = await getBitbucketServerPullRequestDetail('no-slash', 5, jest.fn(), 'bb.acme.com')
    expect(result.ok).toBe(false)
  })
})

describe('getBitbucketServerIssueDetail', () => {
  it('is always unsupported', async () => {
    const result = await getBitbucketServerIssueDetail()
    expect(result.ok).toBe(false)
  })
})
