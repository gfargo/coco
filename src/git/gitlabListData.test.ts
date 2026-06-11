import { SimpleGit } from 'simple-git'
import { getGitLabIssueList, getMergeRequestList, __test } from './gitlabListData'
import { issueFilterForPreset, pullRequestFilterForPreset } from './triageFilterPresets'

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
    // GitLab issues API has no state=all; omit it (returns everything).
    expect(buildIssueEndpoint('g/p', { state: 'all' })).not.toContain('state=')
    expect(buildIssueEndpoint('g/p', {})).not.toContain('state=')
  })
})

describe('@me -> GitLab scope (#0.70 regression)', () => {
  it('maps assignee @me to scope=assigned_to_me (not assignee_username)', () => {
    const e = buildMergeRequestEndpoint('g/p', { assignee: '@me' })
    expect(e).toContain('scope=assigned_to_me')
    expect(e).not.toContain('assignee_username')
  })

  it('maps author @me to scope=created_by_me', () => {
    expect(buildMergeRequestEndpoint('g/p', { author: '@me' })).toContain('scope=created_by_me')
  })

  it('passes concrete usernames through as *_username (no scope)', () => {
    const e = buildMergeRequestEndpoint('g/p', { assignee: 'bob', author: 'alice' })
    expect(e).toContain('assignee_username=bob')
    expect(e).toContain('author_username=alice')
    expect(e).not.toContain('scope=')
  })

  it('applies @me scope to issues too', () => {
    expect(buildIssueEndpoint('g/p', { assignee: '@me' })).toContain('scope=assigned_to_me')
    expect(buildIssueEndpoint('g/p', { author: '@me' })).toContain('scope=created_by_me')
  })
})

describe('TUI filter presets resolve to correct GitLab queries (#0.70)', () => {
  // The workstation `f`-cycle uses these presets; @me must become a scope so the
  // GitLab triage views filter correctly (not silently empty).
  it('PR "mine" preset -> created_by_me + open', () => {
    const e = buildMergeRequestEndpoint('g/p', pullRequestFilterForPreset('mine'))
    expect(e).toContain('scope=created_by_me')
    expect(e).toContain('state=opened')
  })

  it('PR "assigned" preset -> assigned_to_me', () => {
    expect(buildMergeRequestEndpoint('g/p', pullRequestFilterForPreset('assigned'))).toContain(
      'scope=assigned_to_me'
    )
  })

  it('PR "merged" preset -> state=merged', () => {
    expect(buildMergeRequestEndpoint('g/p', pullRequestFilterForPreset('merged'))).toContain('state=merged')
  })

  it('issue "mine" preset -> assigned_to_me + open', () => {
    const e = buildIssueEndpoint('g/p', issueFilterForPreset('mine'))
    expect(e).toContain('scope=assigned_to_me')
    expect(e).toContain('state=opened')
  })
})

describe('GitLab parse edge cases (#0.70)', () => {
  it('handles locked state, work_in_progress draft fallback, object labels, and missing fields', () => {
    const fixture = JSON.stringify([
      {
        iid: 1,
        state: 'locked',
        work_in_progress: true, // older field; coco falls back to it for isDraft
        labels: [{ name: 'bug' }], // tolerate object label form
        title: 'x',
        web_url: 'u',
        source_branch: 's',
        target_branch: 't',
        created_at: '',
        updated_at: '',
      },
      { iid: 2 }, // almost everything missing
    ])
    const parsed = parseMergeRequests(fixture)
    expect(parsed[0]).toMatchObject({ state: 'LOCKED', isDraft: true, labels: ['bug'] })
    expect(parsed[1]).toMatchObject({ number: 2, title: '', isDraft: false })
    expect(parsed[1].labels).toBeUndefined()
  })

  it('issue parser tolerates missing author/assignees/labels', () => {
    const parsed = parseIssues(JSON.stringify([{ iid: 5, state: 'opened', title: 'y' }]))
    expect(parsed[0]).toMatchObject({ number: 5, state: 'OPEN', title: 'y' })
    expect(parsed[0].author).toBeUndefined()
    expect(parsed[0].assignees).toBeUndefined()
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

  it('paginates beyond one page to satisfy a large --limit', async () => {
    const mk = (start: number, count: number) =>
      JSON.stringify(
        Array.from({ length: count }, (_, i) => ({
          iid: start + i,
          title: 't',
          web_url: 'u',
          state: 'opened',
          source_branch: 's',
          target_branch: 't',
          created_at: '',
          updated_at: '',
        }))
      )
    const calls: string[] = []
    let page = 0
    const runner = async (args: string[]) => {
      if (args[0] === 'auth') return ''
      calls.push(args[1])
      page += 1
      // 100 on page 1 (== per_page, keep paging), 30 on page 2 (short, stop).
      return page === 1 ? mk(1, 100) : mk(101, 30)
    }
    const overview = await getMergeRequestList(fakeGit(), { limit: 130 }, runner)
    expect(overview.pullRequests).toHaveLength(130)
    // per_page is clamped to GitLab's 100 max even though limit is 130.
    expect(calls[0]).toContain('per_page=100')
    expect(calls.some((c) => c.includes('&page=1'))).toBe(true)
    expect(calls.some((c) => c.includes('&page=2'))).toBe(true)
  })

  it('surfaces the GitLab error body when the API returns a non-array', async () => {
    const runner = async (args: string[]) => {
      if (args[0] === 'auth') return ''
      return JSON.stringify({ message: '404 Project Not Found' })
    }
    const overview = await getMergeRequestList(fakeGit(), {}, runner)
    expect(overview.message).toContain('404 Project Not Found')
    expect(overview.pullRequests).toBeUndefined()
  })

  it('scopes the glab auth probe to the remote host (self-hosted GitLab)', async () => {
    const calls: string[][] = []
    const runner = async (args: string[]) => {
      calls.push(args)
      return args[0] === 'auth' ? '' : '[]'
    }
    await getMergeRequestList(fakeGit('git@gitlab.example.com:group/proj.git'), {}, runner)
    const authCall = calls.find((a) => a[0] === 'auth')
    expect(authCall).toEqual(['auth', 'status', '--hostname', 'gitlab.example.com'])
  })
})
