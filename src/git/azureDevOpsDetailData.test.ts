import {
  __test,
  getAzureDevOpsIssueDetail,
  getAzureDevOpsPullRequestChecks,
  getAzureDevOpsPullRequestDetail,
  getAzureDevOpsPullRequestDiff,
} from './azureDevOpsDetailData'

const { mapThreadsToComments, parseReviewers, normalizeAzureDevOpsBuildStatus, voteToState } = __test

describe('mapThreadsToComments', () => {
  it('flattens non-system, non-empty comments across threads', () => {
    const comments = mapThreadsToComments([
      {
        comments: [
          { content: 'looks good', author: { uniqueName: 'alice@example.com' }, publishedDate: '2024-01-01' },
          { content: '', author: { uniqueName: 'bob@example.com' } },
          { content: 'branch updated', commentType: 'system' },
        ],
      },
      { isDeleted: true, comments: [{ content: 'deleted thread comment' }] },
    ])

    expect(comments).toEqual([
      { author: 'alice@example.com', body: 'looks good', createdAt: '2024-01-01' },
    ])
  })
})

describe('voteToState', () => {
  it('maps Azure vote values to review states', () => {
    expect(voteToState(10)).toBe('APPROVED')
    expect(voteToState(5)).toBe('APPROVED')
    expect(voteToState(-5)).toBe('CHANGES_REQUESTED')
    expect(voteToState(-10)).toBe('CHANGES_REQUESTED')
    expect(voteToState(0)).toBeUndefined()
    expect(voteToState(undefined)).toBeUndefined()
  })
})

describe('parseReviewers', () => {
  it('only includes reviewers with a resolvable vote state', () => {
    const reviews = parseReviewers([
      { uniqueName: 'alice@example.com', vote: 10 },
      { uniqueName: 'bob@example.com', vote: 0 },
    ])
    expect(reviews).toEqual([{ author: 'alice@example.com', state: 'APPROVED', body: '', submittedAt: '' }])
  })

  it('returns [] for non-array input', () => {
    expect(parseReviewers(undefined)).toEqual([])
  })
})

describe('normalizeAzureDevOpsBuildStatus', () => {
  it('maps Azure status states to the shared conclusion vocabulary', () => {
    expect(normalizeAzureDevOpsBuildStatus('succeeded')).toBe('success')
    expect(normalizeAzureDevOpsBuildStatus('failed')).toBe('failure')
    expect(normalizeAzureDevOpsBuildStatus('error')).toBe('failure')
    expect(normalizeAzureDevOpsBuildStatus('pending')).toBe('in_progress')
    expect(normalizeAzureDevOpsBuildStatus('notApplicable')).toBe('neutral')
  })
})

describe('getAzureDevOpsPullRequestDetail', () => {
  it('assembles body, comments, reviews, and status checks', async () => {
    const runner = async (endpoint: string) => {
      if (endpoint.endsWith('/pullrequests/7')) {
        return JSON.stringify({ description: 'body text', reviewers: [{ uniqueName: 'a@x.com', vote: 10 }] })
      }
      if (endpoint.includes('/threads')) {
        return JSON.stringify({
          value: [{ comments: [{ content: 'hi', author: { uniqueName: 'a@x.com' }, publishedDate: 'now' }] }],
        })
      }
      if (endpoint.includes('/statuses')) {
        return JSON.stringify({ value: [{ state: 'succeeded', context: { name: 'ci/build' } }] })
      }
      throw new Error(`unexpected endpoint ${endpoint}`)
    }

    const result = await getAzureDevOpsPullRequestDetail('myrepo', 7, runner)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.detail.body).toBe('body text')
      expect(result.detail.comments).toEqual([{ author: 'a@x.com', body: 'hi', createdAt: 'now' }])
      expect(result.detail.reviews).toEqual([{ author: 'a@x.com', state: 'APPROVED', body: '', submittedAt: '' }])
      expect(result.detail.statusCheckRollup).toEqual([{ name: 'ci/build', status: 'succeeded', conclusion: 'success' }])
    }
  })

  it('returns a graceful failure when the PR fetch throws', async () => {
    const result = await getAzureDevOpsPullRequestDetail('myrepo', 7, async () => {
      throw new Error('Azure DevOps API error 404: not found')
    })
    expect(result.ok).toBe(false)
  })
})

describe('getAzureDevOpsPullRequestChecks', () => {
  it('returns the mapped status list', async () => {
    const runner = async () => JSON.stringify({ value: [{ state: 'failed', description: 'lint' }] })
    const result = await getAzureDevOpsPullRequestChecks('myrepo', 1, runner)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.checks).toEqual([{ name: 'lint', status: 'failed', conclusion: 'failure' }])
    }
  })
})

describe('graceful unsupported surfaces', () => {
  it('getAzureDevOpsPullRequestDiff is a graceful unsupported', async () => {
    const result = await getAzureDevOpsPullRequestDiff()
    expect(result).toEqual({ ok: false, message: expect.stringContaining('not supported') })
  })

  it('getAzureDevOpsIssueDetail is a graceful unsupported', async () => {
    const result = await getAzureDevOpsIssueDetail()
    expect(result).toEqual({ ok: false, message: expect.stringContaining('Work Items') })
  })
})
