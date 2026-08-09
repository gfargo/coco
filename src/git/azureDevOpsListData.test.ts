import { __test, findOpenAzureDevOpsPullRequestForBranch, getAzureDevOpsIssueList } from './azureDevOpsListData'
import type { AzureDevOpsProject } from './azureDevOpsCli'
import { SimpleGit } from 'simple-git'

const { azureDevOpsStatusParam, mapPullRequestItem, azureDevOpsState, azureDevOpsMergeable } = __test

const project: AzureDevOpsProject = {
  org: 'myorg',
  project: 'myproject',
  repo: 'myrepo',
  owner: 'myorg/myproject',
  name: 'myrepo',
  path: 'myorg/myproject/myrepo',
  host: 'dev.azure.com',
}

function fakeGit(remotes: Array<{ name: string; refs: { fetch?: string; push?: string } }>): SimpleGit {
  return { getRemotes: async () => remotes, raw: async () => '' } as unknown as SimpleGit
}

describe('azureDevOpsState', () => {
  it('maps completed/abandoned/active to MERGED/CLOSED/OPEN', () => {
    expect(azureDevOpsState('completed')).toBe('MERGED')
    expect(azureDevOpsState('abandoned')).toBe('CLOSED')
    expect(azureDevOpsState('active')).toBe('OPEN')
    expect(azureDevOpsState(undefined)).toBe('OPEN')
  })
})

describe('azureDevOpsMergeable', () => {
  it('maps succeeded/conflicts to MERGEABLE/CONFLICTING', () => {
    expect(azureDevOpsMergeable('succeeded')).toBe('MERGEABLE')
    expect(azureDevOpsMergeable('conflicts')).toBe('CONFLICTING')
    expect(azureDevOpsMergeable('rejectedByPolicy')).toBe('CONFLICTING')
    expect(azureDevOpsMergeable(undefined)).toBeUndefined()
  })
})

describe('azureDevOpsStatusParam', () => {
  it('maps open to active and everything else to all', () => {
    expect(azureDevOpsStatusParam('open')).toBe('active')
    expect(azureDevOpsStatusParam('closed')).toBe('all')
    expect(azureDevOpsStatusParam('merged')).toBe('all')
    expect(azureDevOpsStatusParam(undefined)).toBe('all')
  })
})

describe('mapPullRequestItem', () => {
  it('maps a raw Azure DevOps PR into the shared list-item shape', () => {
    const item = mapPullRequestItem(
      {
        pullRequestId: 42,
        title: 'Add feature',
        status: 'active',
        isDraft: true,
        sourceRefName: 'refs/heads/feature',
        targetRefName: 'refs/heads/main',
        createdBy: { uniqueName: 'alice@example.com', displayName: 'Alice' },
        creationDate: '2024-01-01T00:00:00Z',
        mergeStatus: 'succeeded',
        labels: [{ name: 'bug' }],
        reviewers: [{ uniqueName: 'bob@example.com', vote: 0 }],
      },
      project
    )

    expect(item).toEqual({
      number: 42,
      title: 'Add feature',
      url: 'https://dev.azure.com/myorg/myproject/_git/myrepo/pullrequest/42',
      state: 'OPEN',
      isDraft: true,
      headRefName: 'feature',
      baseRefName: 'main',
      author: 'alice@example.com',
      reviewDecision: undefined,
      mergeable: 'MERGEABLE',
      mergeStateStatus: undefined,
      assignees: ['bob@example.com'],
      labels: ['bug'],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    })
  })
})

describe('findOpenAzureDevOpsPullRequestForBranch', () => {
  it('finds the PR whose source branch matches', async () => {
    const runner = async () =>
      JSON.stringify({
        value: [
          { pullRequestId: 1, sourceRefName: 'refs/heads/other' },
          { pullRequestId: 2, sourceRefName: 'refs/heads/feature' },
        ],
      })
    const pr = await findOpenAzureDevOpsPullRequestForBranch(project, 'feature', runner)
    expect(pr?.pullRequestId).toBe(2)
  })

  it('returns undefined when no PR matches', async () => {
    const runner = async () => JSON.stringify({ value: [] })
    expect(await findOpenAzureDevOpsPullRequestForBranch(project, 'feature', runner)).toBeUndefined()
  })
})

describe('getAzureDevOpsIssueList (#1617)', () => {
  it('surfaces an explicit Work-Items-are-not-issues message rather than an empty list', async () => {
    const saved = process.env.AZURE_DEVOPS_TOKEN
    process.env.AZURE_DEVOPS_TOKEN = 'tok'
    try {
      const git = fakeGit([
        { name: 'origin', refs: { fetch: 'https://dev.azure.com/myorg/myproject/_git/myrepo' } },
      ])
      const overview = await getAzureDevOpsIssueList(git, {}, () => async () => '{"value":[]}')
      expect(overview.available).toBe(true)
      expect(overview.authenticated).toBe(true)
      expect(overview.message).toMatch(/Work Items/)
      expect(overview.issues).toBeUndefined()
    } finally {
      if (saved === undefined) delete process.env.AZURE_DEVOPS_TOKEN
      else process.env.AZURE_DEVOPS_TOKEN = saved
    }
  })
})
