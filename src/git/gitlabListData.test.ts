import { SimpleGit } from 'simple-git'
import { getGitLabIssueList, getMergeRequestList, __test } from './gitlabListData'

const { buildMergeRequestEndpoint, buildIssueEndpoint, parseMergeRequests, parseIssues } = __test

function fakeGit(url = 'git@gitlab.com:group/sub/proj.git'): SimpleGit {
  return {
    getRemotes: async () => [{ name: 'origin', refs: { fetch: url } }],
  } as unknown as SimpleGit
}

describe('gitlab endpoint building (#0.70)', () => {
  it('encodes the project path and maps MR filters to REST params', () => {
    const endpoint = buildMergeRequestEndpoint('group/sub/proj', {
      state: 'open',
      author: 'alice',
      assignee: 'bob',
      label: 'bug,urgent',
      base: 'main',
      head: 'feature',
      limit: 10,
    })
    expect(endpoint).toContain('projects/group%2Fsub%2Fproj/merge_requests?')
    expect(endpoint).toContain('state=opened')
    expect(endpoint).toContain('author_username=alice')
    expect(endpoint).toContain('assignee_username=bob')
    expect(endpoint).toContain('labels=bug%2Curgent')
    expect(endpoint).toContain('target_branch=main')
    expect(endpoint).toContain('source_branch=feature')
    expect(endpoint).toContain('per_page=10')
  })

  it('maps issue state open->opened and omits state for all', () => {
    expect(buildIssueEndpoint('g/p', { state: 'open' })).toContain('state=opened')
    expect(buildIssueEndpoint('g/p', { state: 'closed' })).toContain('state=closed')
    expect(buildIssueEndpoint('g/p', { state: 'all' })).toContain('state=all')
    expect(buildIssueEndpoint('g/p', {})).not.toContain('state=')
  })
})

describe('gitlab REST parsing (#0.70)', () => {
  it('maps a merge request to the shared PR view model', () => {
    const fixture = JSON.stringify([
      {
        iid: 42,
        title: 'Add widget',
        web_url: 'https://gitlab.com/group/sub/proj/-/merge_requests/42',
        state: 'opened',
        draft: true,
        source_branch: 'feature/widget',
        target_branch: 'main',
        author: { username: 'alice' },
        assignees: [{ username: 'bob' }, { username: 'carol' }],
        labels: ['bug', 'urgent'],
        merge_status: 'can_be_merged',
        detailed_merge_status: 'mergeable',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
    ])
    expect(parseMergeRequests(fixture)).toEqual([
      {
        number: 42,
        title: 'Add widget',
        url: 'https://gitlab.com/group/sub/proj/-/merge_requests/42',
        state: 'OPEN',
        isDraft: true,
        headRefName: 'feature/widget',
        baseRefName: 'main',
        author: 'alice',
        assignees: ['bob', 'carol'],
        labels: ['bug', 'urgent'],
        reviewDecision: undefined,
        mergeable: 'can_be_merged',
        mergeStateStatus: 'mergeable',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
      },
    ])
  })

  it('maps an issue to the shared issue view model', () => {
    const fixture = JSON.stringify([
      {
        iid: 7,
        title: 'Bug report',
        web_url: 'https://gitlab.com/group/sub/proj/-/issues/7',
        state: 'closed',
        author: { username: 'dave' },
        assignees: [{ username: 'erin' }],
        labels: ['triage'],
        user_notes_count: 3,
        created_at: '2026-03-01T00:00:00Z',
        updated_at: '2026-03-02T00:00:00Z',
      },
    ])
    expect(parseIssues(fixture)).toEqual([
      {
        number: 7,
        title: 'Bug report',
        url: 'https://gitlab.com/group/sub/proj/-/issues/7',
        state: 'CLOSED',
        author: 'dave',
        assignees: ['erin'],
        labels: ['triage'],
        comments: 3,
        createdAt: '2026-03-01T00:00:00Z',
        updatedAt: '2026-03-02T00:00:00Z',
      },
    ])
  })

  it('tolerates empty output', () => {
    expect(parseMergeRequests('')).toEqual([])
    expect(parseIssues('   ')).toEqual([])
  })
})

describe('getMergeRequestList / getGitLabIssueList (#0.70)', () => {
  const okRunnerFor = (payload: string) => {
    return async (args: string[]) => {
      // auth status probe returns empty; api call returns the payload.
      if (args[0] === 'auth') return ''
      return payload
    }
  }

  it('returns a populated MR overview', async () => {
    const payload = JSON.stringify([
      { iid: 1, title: 'x', web_url: 'u', state: 'opened', source_branch: 's', target_branch: 't', created_at: '', updated_at: '' },
    ])
    const overview = await getMergeRequestList(fakeGit(), {}, okRunnerFor(payload))
    expect(overview).toMatchObject({
      available: true,
      authenticated: true,
      repository: { owner: 'group/sub', name: 'proj' },
    })
    expect(overview.pullRequests).toHaveLength(1)
  })

  it('filters to drafts client-side when --draft is set', async () => {
    const payload = JSON.stringify([
      { iid: 1, title: 'draft', web_url: 'u', state: 'opened', draft: true, source_branch: 's', target_branch: 't', created_at: '', updated_at: '' },
      { iid: 2, title: 'ready', web_url: 'u', state: 'opened', draft: false, source_branch: 's', target_branch: 't', created_at: '', updated_at: '' },
    ])
    const overview = await getMergeRequestList(fakeGit(), { draft: true }, okRunnerFor(payload))
    expect(overview.pullRequests?.map((m) => m.number)).toEqual([1])
  })

  it('surfaces a not-authenticated message', async () => {
    const runner = async () => {
      throw Object.assign(new Error('x'), { code: 'ENOENT' })
    }
    const overview = await getGitLabIssueList(fakeGit(), {}, runner)
    expect(overview.authenticated).toBe(false)
    expect(overview.message).toContain('glab')
  })

  it('reports no remote when origin is missing', async () => {
    const git = { getRemotes: async () => [] } as unknown as SimpleGit
    const overview = await getMergeRequestList(git, {}, async () => '')
    expect(overview).toMatchObject({ available: false, message: 'No GitLab remote detected.' })
  })
})
