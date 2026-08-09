import {
  addAzureDevOpsPullRequestLabel,
  addAzureDevOpsPullRequestReviewer,
  approveAzureDevOpsPullRequestByNumber,
  checkoutAzureDevOpsPullRequestByNumber,
  closeAzureDevOpsPullRequestByNumber,
  commentAzureDevOpsPullRequestByNumber,
  createAzureDevOpsPullRequest,
  enableAzureDevOpsAutoMerge,
  markAzureDevOpsPullRequestReadyByNumber,
  mergeAzureDevOpsPullRequestByNumber,
  mergeAzureDevOpsPullRequest,
  reopenAzureDevOpsPullRequestByNumber,
  rerunFailedAzureDevOpsChecks,
  requestChangesAzureDevOpsPullRequestByNumber,
} from './azureDevOpsPullRequestActions'
import type { AzureDevOpsProject, AzureDevOpsRunner } from './azureDevOpsCli'

const project: AzureDevOpsProject = {
  org: 'myorg',
  project: 'myproject',
  repo: 'myrepo',
  owner: 'myorg/myproject',
  name: 'myrepo',
  path: 'myorg/myproject/myrepo',
  host: 'dev.azure.com',
}

function recordingRunner(
  responses: Record<string, string>
): { runner: AzureDevOpsRunner; calls: Array<{ endpoint: string; method?: string; body?: string }> } {
  const calls: Array<{ endpoint: string; method?: string; body?: string }> = []
  // Longest key first so a more specific match (e.g. `pullrequests/11`) wins
  // over a broader one (`pullrequests`) that would otherwise also match.
  const orderedKeys = Object.keys(responses).sort((a, b) => b.length - a.length)
  const runner: AzureDevOpsRunner = async (endpoint, options) => {
    calls.push({ endpoint, method: options?.method, body: options?.body })
    for (const key of orderedKeys) {
      if (endpoint.includes(key)) return responses[key]
    }
    throw new Error(`No fake response configured for ${endpoint}`)
  }
  return { runner, calls }
}

describe('createAzureDevOpsPullRequest', () => {
  it('POSTs source/target ref names and returns the constructed web URL', async () => {
    const { runner, calls } = recordingRunner({
      pullrequests: JSON.stringify({ pullRequestId: 9 }),
    })
    const result = await createAzureDevOpsPullRequest(
      project,
      { base: 'main', head: 'feature', title: 'T', body: 'B', draft: true },
      runner
    )
    expect(result.ok).toBe(true)
    expect(result.url).toBe('https://dev.azure.com/myorg/myproject/_git/myrepo/pullrequest/9')
    expect(calls[0].method).toBe('POST')
    const body = JSON.parse(calls[0].body || '{}')
    expect(body).toEqual({
      sourceRefName: 'refs/heads/feature',
      targetRefName: 'refs/heads/main',
      title: 'T',
      description: 'B',
      isDraft: true,
    })
  })

  it('rejects a flag-like branch name', async () => {
    const { runner } = recordingRunner({})
    const result = await createAzureDevOpsPullRequest(
      project,
      { base: 'main', head: '--evil', title: 'T', body: 'B' },
      runner
    )
    expect(result.ok).toBe(false)
  })
})

describe('mergeAzureDevOpsPullRequestByNumber', () => {
  it('fetches lastMergeSourceCommit before completing', async () => {
    const { runner, calls } = recordingRunner({
      'pullrequests/5': JSON.stringify({ lastMergeSourceCommit: { commitId: 'abc123' } }),
    })
    const result = await mergeAzureDevOpsPullRequestByNumber(project, 5, 'squash', runner)
    expect(result.ok).toBe(true)
    const completeCall = calls.find((c) => c.method === 'PATCH')
    const body = JSON.parse(completeCall?.body || '{}')
    expect(body).toEqual({
      status: 'completed',
      lastMergeSourceCommit: { commitId: 'abc123' },
      completionOptions: { mergeStrategy: 'squash' },
    })
  })

  it('fails gracefully when the source commit cannot be resolved', async () => {
    const { runner } = recordingRunner({ 'pullrequests/5': JSON.stringify({}) })
    const result = await mergeAzureDevOpsPullRequestByNumber(project, 5, 'merge', runner)
    expect(result.ok).toBe(false)
  })
})

describe('approveAzureDevOpsPullRequestByNumber', () => {
  it('votes 10 as the resolved self identity', async () => {
    const { runner, calls } = recordingRunner({
      'profiles/me': JSON.stringify({ id: 'self-id', emailAddress: 'me@example.com' }),
      'reviewers/self-id': '{}',
    })
    const result = await approveAzureDevOpsPullRequestByNumber(project, 3, runner)
    expect(result.ok).toBe(true)
    const vote = calls.find((c) => c.endpoint.includes('reviewers/self-id'))
    expect(vote?.method).toBe('PUT')
    expect(JSON.parse(vote?.body || '{}')).toEqual({ vote: 10 })
  })
})

describe('requestChangesAzureDevOpsPullRequestByNumber', () => {
  it('votes -5 and posts a comment thread', async () => {
    const { runner, calls } = recordingRunner({
      'profiles/me': JSON.stringify({ id: 'self-id' }),
      'reviewers/self-id': '{}',
      threads: '{}',
    })
    const result = await requestChangesAzureDevOpsPullRequestByNumber(project, 3, 'please fix', runner)
    expect(result.ok).toBe(true)
    const threadCall = calls.find((c) => c.endpoint.includes('/threads'))
    expect(JSON.parse(threadCall?.body || '{}').comments[0].content).toBe('please fix')
  })

  it('requires a non-empty body', async () => {
    const { runner } = recordingRunner({})
    const result = await requestChangesAzureDevOpsPullRequestByNumber(project, 3, '   ', runner)
    expect(result.ok).toBe(false)
  })
})

describe('addAzureDevOpsPullRequestLabel', () => {
  it('POSTs the label name directly (no id lookup)', async () => {
    const { runner, calls } = recordingRunner({ labels: '{}' })
    const result = await addAzureDevOpsPullRequestLabel(project, 4, 'bug', runner)
    expect(result.ok).toBe(true)
    expect(JSON.parse(calls[0].body || '{}')).toEqual({ name: 'bug' })
  })
})

describe('addAzureDevOpsPullRequestReviewer', () => {
  it('resolves the identity id before adding the reviewer', async () => {
    const { runner, calls } = recordingRunner({
      identities: JSON.stringify({ value: [{ id: 'reviewer-id' }] }),
      'reviewers/reviewer-id': '{}',
    })
    const result = await addAzureDevOpsPullRequestReviewer(project, 4, 'bob@example.com', runner)
    expect(result.ok).toBe(true)
    const reviewerCall = calls.find((c) => c.endpoint.includes('reviewers/reviewer-id'))
    expect(reviewerCall?.method).toBe('PUT')
  })

  it('fails gracefully when the identity cannot be resolved', async () => {
    const { runner } = recordingRunner({ identities: JSON.stringify({ value: [] }) })
    const result = await addAzureDevOpsPullRequestReviewer(project, 4, 'nobody@example.com', runner)
    expect(result.ok).toBe(false)
  })
})

describe('markAzureDevOpsPullRequestReadyByNumber', () => {
  it('flips isDraft to false when the PR is a draft', async () => {
    let call = 0
    const runner: AzureDevOpsRunner = async (_endpoint, options) => {
      call += 1
      if (call === 1) return JSON.stringify({ isDraft: true })
      expect(JSON.parse(options?.body || '{}')).toEqual({ isDraft: false })
      return '{}'
    }
    const result = await markAzureDevOpsPullRequestReadyByNumber(project, 2, runner)
    expect(result.ok).toBe(true)
  })

  it('is a no-op when the PR is already ready', async () => {
    const runner: AzureDevOpsRunner = async () => JSON.stringify({ isDraft: false })
    const result = await markAzureDevOpsPullRequestReadyByNumber(project, 2, runner)
    expect(result.ok).toBe(true)
    expect(result.message).toContain('is not a draft')
  })
})

describe('close / reopen / comment', () => {
  it('closeAzureDevOpsPullRequestByNumber sets status to abandoned', async () => {
    const { runner, calls } = recordingRunner({ 'pullrequests/1': '{}' })
    await closeAzureDevOpsPullRequestByNumber(project, 1, runner)
    expect(JSON.parse(calls[0].body || '{}')).toEqual({ status: 'abandoned' })
  })

  it('reopenAzureDevOpsPullRequestByNumber sets status to active', async () => {
    const { runner, calls } = recordingRunner({ 'pullrequests/1': '{}' })
    await reopenAzureDevOpsPullRequestByNumber(project, 1, runner)
    expect(JSON.parse(calls[0].body || '{}')).toEqual({ status: 'active' })
  })

  it('commentAzureDevOpsPullRequestByNumber posts a thread with commentType text', async () => {
    const { runner, calls } = recordingRunner({ threads: '{}' })
    const result = await commentAzureDevOpsPullRequestByNumber(project, 1, 'hello', runner)
    expect(result.ok).toBe(true)
    expect(JSON.parse(calls[0].body || '{}')).toEqual({
      comments: [{ parentCommentId: 0, content: 'hello', commentType: 1 }],
      status: 1,
    })
  })
})

describe('graceful unsupported surfaces (#1617)', () => {
  it('checkoutAzureDevOpsPullRequestByNumber', async () => {
    expect((await checkoutAzureDevOpsPullRequestByNumber()).ok).toBe(false)
  })
  it('enableAzureDevOpsAutoMerge', async () => {
    expect((await enableAzureDevOpsAutoMerge()).ok).toBe(false)
  })
  it('rerunFailedAzureDevOpsChecks', async () => {
    expect((await rerunFailedAzureDevOpsChecks()).ok).toBe(false)
  })
})

describe('mergeAzureDevOpsPullRequest (current-branch variant)', () => {
  it('fails gracefully with no project resolved', async () => {
    const { runner } = recordingRunner({})
    const result = await mergeAzureDevOpsPullRequest(undefined, 'feature', 'merge', runner)
    expect(result.ok).toBe(false)
  })

  it('fails gracefully with no current branch', async () => {
    const { runner } = recordingRunner({})
    const result = await mergeAzureDevOpsPullRequest(project, undefined, 'merge', runner)
    expect(result.ok).toBe(false)
  })

  it('finds the open PR for the branch and merges it', async () => {
    const { runner } = recordingRunner({
      pullrequests: JSON.stringify({
        value: [{ pullRequestId: 11, sourceRefName: 'refs/heads/feature' }],
      }),
      'pullrequests/11': JSON.stringify({ lastMergeSourceCommit: { commitId: 'c1' } }),
    })
    const result = await mergeAzureDevOpsPullRequest(project, 'feature', 'merge', runner)
    expect(result.ok).toBe(true)
    expect(result.message).toContain('#11')
  })
})
