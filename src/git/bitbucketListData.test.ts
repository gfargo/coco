import { SimpleGit } from 'simple-git'
import { getBitbucketPullRequestList, getBitbucketIssueList, __test } from './bitbucketListData'

const {
  buildPullRequestEndpoint,
  buildIssueEndpoint,
  parsePullRequests,
  parseIssues,
  normalizeState,
  normalizeIssueState,
  resolveBitbucketMeNickname,
} = __test

function fakeGit(url = 'https://bitbucket.org/workspace/repo.git'): SimpleGit {
  return {
    getRemotes: async () => [{ name: 'origin', refs: { fetch: url } }],
  } as unknown as SimpleGit
}

// Save and restore env vars
function withCredentials(fn: () => Promise<void>) {
  return async () => {
    const saved = process.env.BITBUCKET_ACCESS_TOKEN
    process.env.BITBUCKET_ACCESS_TOKEN = 'test-token'
    try {
      await fn()
    } finally {
      if (saved === undefined) delete process.env.BITBUCKET_ACCESS_TOKEN
      else process.env.BITBUCKET_ACCESS_TOKEN = saved
    }
  }
}

function withoutCredentials(fn: () => Promise<void>) {
  return async () => {
    const savedToken = process.env.BITBUCKET_ACCESS_TOKEN
    const savedUser = process.env.BITBUCKET_USERNAME
    const savedPass = process.env.BITBUCKET_APP_PASSWORD
    delete process.env.BITBUCKET_ACCESS_TOKEN
    delete process.env.BITBUCKET_USERNAME
    delete process.env.BITBUCKET_APP_PASSWORD
    try {
      await fn()
    } finally {
      if (savedToken !== undefined) process.env.BITBUCKET_ACCESS_TOKEN = savedToken
      if (savedUser !== undefined) process.env.BITBUCKET_USERNAME = savedUser
      if (savedPass !== undefined) process.env.BITBUCKET_APP_PASSWORD = savedPass
    }
  }
}

// ---------------------------------------------------------------------------
// State normalization
// ---------------------------------------------------------------------------

describe('normalizeState (1238)', () => {
  it('maps OPEN -> OPEN', () => expect(normalizeState('OPEN')).toBe('OPEN'))
  it('maps MERGED -> MERGED', () => expect(normalizeState('MERGED')).toBe('MERGED'))
  it('maps DECLINED -> CLOSED', () => expect(normalizeState('DECLINED')).toBe('CLOSED'))
  it('maps SUPERSEDED -> CLOSED', () => expect(normalizeState('SUPERSEDED')).toBe('CLOSED'))
  it('uppercases unknown states', () => expect(normalizeState('pending')).toBe('PENDING'))
})

describe('normalizeIssueState (1238)', () => {
  it('maps new -> OPEN', () => expect(normalizeIssueState('new')).toBe('OPEN'))
  it('maps open -> OPEN', () => expect(normalizeIssueState('open')).toBe('OPEN'))
  it('maps on hold -> OPEN', () => expect(normalizeIssueState('on hold')).toBe('OPEN'))
  it('maps resolved -> CLOSED', () => expect(normalizeIssueState('resolved')).toBe('CLOSED'))
  it('maps wontfix -> CLOSED', () => expect(normalizeIssueState('wontfix')).toBe('CLOSED'))
  it('maps duplicate -> CLOSED', () => expect(normalizeIssueState('duplicate')).toBe('CLOSED'))
})

// ---------------------------------------------------------------------------
// Endpoint building
// ---------------------------------------------------------------------------

describe('buildPullRequestEndpoint (1238)', () => {
  it('filters open PRs by state=OPEN', () => {
    const e = buildPullRequestEndpoint('ws/repo', { state: 'open' })
    expect(e).toContain('state=OPEN')
  })

  it('filters merged PRs by state=MERGED', () => {
    expect(buildPullRequestEndpoint('ws/repo', { state: 'merged' })).toContain('state=MERGED')
  })

  it('filters closed PRs using a q= filter with DECLINED and SUPERSEDED', () => {
    const e = buildPullRequestEndpoint('ws/repo', { state: 'closed' })
    expect(e).toContain('q=')
    expect(e).toContain('DECLINED')
    expect(e).toContain('SUPERSEDED')
  })

  it('omits state for all (returns all PRs)', () => {
    const e = buildPullRequestEndpoint('ws/repo', { state: 'all' })
    expect(e).not.toContain('state=')
  })

  it('adds source/destination branch filters', () => {
    const e = buildPullRequestEndpoint('ws/repo', { head: 'feat', base: 'main' })
    expect(decodeURIComponent(e)).toContain('source.branch.name = "feat"')
    expect(decodeURIComponent(e)).toContain('destination.branch.name = "main"')
  })

  it('adds a title search filter', () => {
    const e = decodeURIComponent(buildPullRequestEndpoint('ws/repo', { search: 'auth' }))
    expect(e).toContain('title ~ "auth"')
  })

  it('combines search with a state filter', () => {
    const e = decodeURIComponent(buildPullRequestEndpoint('ws/repo', { state: 'open', search: 'auth' }))
    expect(e).toContain('state=OPEN')
    expect(e).toContain('title ~ "auth"')
  })

  it('combines search with a closed-state q clause', () => {
    const e = decodeURIComponent(buildPullRequestEndpoint('ws/repo', { state: 'closed', search: 'auth' }))
    expect(e).toContain('title ~ "auth"')
    expect(e).toContain('AND')
    expect(e).toContain('DECLINED')
  })

  it('escapes a double quote in the head branch name (1709)', () => {
    const e = buildPullRequestEndpoint('ws/repo', { head: 'x" OR state != "' })
    expect(decodeURIComponent(e)).toContain('source.branch.name = "x\\" OR state != \\""')
  })

  it('escapes a double quote in the search string (1709)', () => {
    const e = buildPullRequestEndpoint('ws/repo', { search: 'x" OR state != "' })
    expect(decodeURIComponent(e)).toContain('title ~ "x\\" OR state != \\""')
  })
})

describe('buildIssueEndpoint (1238)', () => {
  it('filters open issues by state query', () => {
    const e = buildIssueEndpoint('ws/repo', { state: 'open' })
    expect(decodeURIComponent(e)).toContain('status = "new"')
    expect(decodeURIComponent(e)).toContain('status = "open"')
  })

  it('filters closed issues by state query', () => {
    const e = buildIssueEndpoint('ws/repo', { state: 'closed' })
    expect(decodeURIComponent(e)).toContain('status = "resolved"')
    expect(decodeURIComponent(e)).toContain('status = "closed"')
  })

  it('filters by assignee username', () => {
    const e = buildIssueEndpoint('ws/repo', { assignee: 'alice' })
    expect(decodeURIComponent(e)).toContain('assignee.nickname = "alice"')
  })

  it('filters by search string', () => {
    const e = buildIssueEndpoint('ws/repo', { search: 'login bug' })
    expect(decodeURIComponent(e)).toContain('title ~ "login bug"')
  })

  it('does not add a raw assignee.nickname clause for a literal @me (resolved to a nickname before this is called)', () => {
    const e = buildIssueEndpoint('ws/repo', { assignee: '@me' })
    expect(e).not.toContain('assignee.nickname')
  })

  it('escapes a double quote in the search string (1709)', () => {
    const e = buildIssueEndpoint('ws/repo', { search: 'fix "login" bug' })
    expect(decodeURIComponent(e)).toContain('title ~ "fix \\"login\\" bug"')
  })
})

// ---------------------------------------------------------------------------
// resolveBitbucketMeNickname
// ---------------------------------------------------------------------------

describe('resolveBitbucketMeNickname (981)', () => {
  it('returns the nickname from GET /user', async () => {
    const runner = async () => JSON.stringify({ nickname: 'alice' })
    expect(await resolveBitbucketMeNickname(runner)).toBe('alice')
  })

  it('returns undefined when the response has no nickname', async () => {
    const runner = async () => '{}'
    expect(await resolveBitbucketMeNickname(runner)).toBeUndefined()
  })

  it('returns undefined for an empty response', async () => {
    const runner = async () => ''
    expect(await resolveBitbucketMeNickname(runner)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// parsePullRequests
// ---------------------------------------------------------------------------

function makePR(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    title: 'My PR',
    description: 'body',
    state: 'OPEN',
    draft: false,
    source: { branch: { name: 'feat/x' }, commit: { hash: 'abc' } },
    destination: { branch: { name: 'main' } },
    author: { nickname: 'alice' },
    reviewers: [{ nickname: 'bob' }],
    links: { html: { href: 'https://bitbucket.org/ws/repo/pull-requests/1' } },
    created_on: '2026-01-01T00:00:00Z',
    updated_on: '2026-01-02T00:00:00Z',
    ...overrides,
  }
}

describe('parsePullRequests (1238)', () => {
  it('maps a Bitbucket PR to the shared view model', () => {
    const fixture = JSON.stringify({ values: [makePR()], pagelen: 50, page: 1 })
    const parsed = parsePullRequests(fixture)
    expect(parsed).toEqual([
      {
        number: 1,
        title: 'My PR',
        url: 'https://bitbucket.org/ws/repo/pull-requests/1',
        state: 'OPEN',
        isDraft: false,
        headRefName: 'feat/x',
        baseRefName: 'main',
        author: 'alice',
        assignees: ['bob'],
        labels: undefined,
        reviewDecision: undefined,
        mergeable: undefined,
        mergeStateStatus: undefined,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
      },
    ])
  })

  it('normalizes DECLINED state to CLOSED', () => {
    const fixture = JSON.stringify({ values: [makePR({ state: 'DECLINED' })], pagelen: 50, page: 1 })
    expect(parsePullRequests(fixture)[0].state).toBe('CLOSED')
  })

  it('maps draft: true', () => {
    const fixture = JSON.stringify({ values: [makePR({ draft: true })], pagelen: 50, page: 1 })
    expect(parsePullRequests(fixture)[0].isDraft).toBe(true)
  })

  it('handles missing optional fields gracefully', () => {
    const minimal = JSON.stringify({
      values: [{ id: 5 }],
      pagelen: 50,
      page: 1,
    })
    const parsed = parsePullRequests(minimal)
    expect(parsed[0].number).toBe(5)
    expect(parsed[0].author).toBeUndefined()
    expect(parsed[0].assignees).toBeUndefined()
  })

  it('returns empty array for empty output', () => {
    const empty = JSON.stringify({ values: [], pagelen: 50, page: 1 })
    expect(parsePullRequests(empty)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// parseIssues
// ---------------------------------------------------------------------------

function makeIssue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 7,
    title: 'Bug report',
    content: { raw: 'some body' },
    status: 'new',
    kind: 'bug',
    reporter: { nickname: 'dave' },
    assignee: { nickname: 'erin' },
    comment_count: 3,
    links: { html: { href: 'https://bitbucket.org/ws/repo/issues/7' } },
    created_on: '2026-03-01T00:00:00Z',
    updated_on: '2026-03-02T00:00:00Z',
    ...overrides,
  }
}

describe('parseIssues (1238)', () => {
  it('maps a Bitbucket issue to the shared issue view model', () => {
    const fixture = JSON.stringify({ values: [makeIssue()], pagelen: 50, page: 1 })
    const parsed = parseIssues(fixture)
    expect(parsed[0]).toMatchObject({
      number: 7,
      title: 'Bug report',
      url: 'https://bitbucket.org/ws/repo/issues/7',
      state: 'OPEN',
      author: 'dave',
      assignees: ['erin'],
      labels: ['bug'],
      comments: 3,
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-02T00:00:00Z',
    })
  })

  it('maps resolved status to CLOSED', () => {
    const fixture = JSON.stringify({ values: [makeIssue({ status: 'resolved' })], pagelen: 50, page: 1 })
    expect(parseIssues(fixture)[0].state).toBe('CLOSED')
  })

  it('handles missing assignee and kind gracefully', () => {
    const fixture = JSON.stringify({
      values: [{ id: 2, title: 'x', status: 'new', created_on: '', updated_on: '', links: { html: { href: '' } } }],
      pagelen: 50,
      page: 1,
    })
    const parsed = parseIssues(fixture)
    expect(parsed[0].assignees).toBeUndefined()
    expect(parsed[0].labels).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// getBitbucketPullRequestList / getBitbucketIssueList integration stubs
// ---------------------------------------------------------------------------

describe('getBitbucketPullRequestList (1238)', () => {
  it('returns a populated PR overview', withCredentials(async () => {
    const payload = JSON.stringify({ values: [makePR()], pagelen: 50, page: 1 })
    const runner = async (endpoint: string) => {
      if (endpoint === 'user') return '{}'
      return payload
    }
    const overview = await getBitbucketPullRequestList(fakeGit(), {}, runner)
    expect(overview).toMatchObject({ available: true, authenticated: true, repository: { owner: 'workspace', name: 'repo' } })
    expect(overview.pullRequests).toHaveLength(1)
  }))

  it('reports no remote when there are no remotes', async () => {
    const git = { getRemotes: async () => [] } as unknown as SimpleGit
    const runner = async () => '{}'
    const overview = await getBitbucketPullRequestList(git, {}, runner)
    expect(overview).toMatchObject({ available: false, message: 'No Bitbucket remote detected.' })
  })

  it('surfaces a not-supported message instead of silently ignoring --label', withCredentials(async () => {
    const payload = JSON.stringify({ values: [makePR()], pagelen: 50, page: 1 })
    const runner = async (endpoint: string) => {
      if (endpoint === 'user') return '{}'
      return payload
    }
    const overview = await getBitbucketPullRequestList(fakeGit(), { label: 'bug' }, runner)
    expect(overview.message).toContain('not supported on Bitbucket Cloud')
    expect(overview.pullRequests).toBeUndefined()
  }))

  it('resolves author=@me to the authenticated nickname and filters by it', withCredentials(async () => {
    const payload = JSON.stringify({
      values: [makePR({ id: 1, author: { nickname: 'alice' } }), makePR({ id: 2, author: { nickname: 'bob' } })],
      pagelen: 50,
      page: 1,
    })
    const runner = async (endpoint: string) => {
      if (endpoint === 'user') return JSON.stringify({ nickname: 'alice' })
      return payload
    }
    const overview = await getBitbucketPullRequestList(fakeGit(), { author: '@me' }, runner)
    expect(overview.pullRequests).toHaveLength(1)
    expect(overview.pullRequests?.[0]?.author).toBe('alice')
  }))

  it('resolves assignee=@me to the authenticated nickname and filters by reviewer', withCredentials(async () => {
    const payload = JSON.stringify({
      values: [
        makePR({ id: 1, reviewers: [{ nickname: 'bob' }] }),
        makePR({ id: 2, reviewers: [{ nickname: 'carol' }] }),
      ],
      pagelen: 50,
      page: 1,
    })
    const runner = async (endpoint: string) => {
      if (endpoint === 'user') return JSON.stringify({ nickname: 'bob' })
      return payload
    }
    const overview = await getBitbucketPullRequestList(fakeGit(), { assignee: '@me' }, runner)
    expect(overview.pullRequests).toHaveLength(1)
    expect(overview.pullRequests?.[0]?.number).toBe(1)
  }))

  it('still filters literal author values by exact match', withCredentials(async () => {
    const payload = JSON.stringify({
      values: [makePR({ id: 1, author: { nickname: 'alice' } }), makePR({ id: 2, author: { nickname: 'bob' } })],
      pagelen: 50,
      page: 1,
    })
    const runner = async (endpoint: string) => {
      if (endpoint === 'user') return '{}'
      return payload
    }
    const overview = await getBitbucketPullRequestList(fakeGit(), { author: 'alice' }, runner)
    expect(overview.pullRequests).toHaveLength(1)
    expect(overview.pullRequests?.[0]?.author).toBe('alice')
  }))

  it('surfaces an explicit message when @me cannot be resolved', withCredentials(async () => {
    const payload = JSON.stringify({ values: [makePR()], pagelen: 50, page: 1 })
    const runner = async (endpoint: string) => {
      if (endpoint === 'user') return '{}'
      return payload
    }
    const overview = await getBitbucketPullRequestList(fakeGit(), { author: '@me' }, runner)
    expect(overview.message).toContain('Could not resolve "@me"')
    expect(overview.pullRequests).toBeUndefined()
  }))
})

describe('getBitbucketIssueList (1238)', () => {
  it('returns a populated issue overview', withCredentials(async () => {
    const payload = JSON.stringify({ values: [makeIssue()], pagelen: 50, page: 1 })
    const runner = async (endpoint: string) => {
      if (endpoint === 'user') return '{}'
      return payload
    }
    const overview = await getBitbucketIssueList(fakeGit(), {}, runner)
    expect(overview).toMatchObject({ available: true, authenticated: true })
    expect(overview.issues).toHaveLength(1)
  }))

  it('surfaces not-authenticated when credentials are missing', withoutCredentials(async () => {
    const overview = await getBitbucketIssueList(fakeGit(), {}, async () => '{}')
    expect(overview.authenticated).toBe(false)
    expect(overview.message).toContain('BITBUCKET_ACCESS_TOKEN')
  }))

  it('resolves @me assignee to the current user nickname and scopes the query server-side', withCredentials(async () => {
    const payload = JSON.stringify({ values: [makeIssue()], pagelen: 50, page: 1 })
    const seenEndpoints: string[] = []
    const runner = async (endpoint: string) => {
      seenEndpoints.push(endpoint)
      if (endpoint === 'user') return JSON.stringify({ nickname: 'erin' })
      return payload
    }
    const overview = await getBitbucketIssueList(fakeGit(), { assignee: '@me' }, runner)
    expect(overview).toMatchObject({ available: true, authenticated: true })
    expect(overview.issues).toHaveLength(1)
    const issuesEndpoint = seenEndpoints.find((e) => e.startsWith('repositories/'))
    expect(issuesEndpoint).toBeDefined()
    expect(decodeURIComponent(issuesEndpoint as string)).toContain('assignee.nickname = "erin"')
  }))

  it('resolves @me author to the current user nickname via reporter.nickname', withCredentials(async () => {
    const payload = JSON.stringify({ values: [makeIssue()], pagelen: 50, page: 1 })
    const seenEndpoints: string[] = []
    const runner = async (endpoint: string) => {
      seenEndpoints.push(endpoint)
      if (endpoint === 'user') return JSON.stringify({ nickname: 'erin' })
      return payload
    }
    const overview = await getBitbucketIssueList(fakeGit(), { author: '@me' }, runner)
    expect(overview).toMatchObject({ available: true, authenticated: true })
    const issuesEndpoint = seenEndpoints.find((e) => e.startsWith('repositories/'))
    expect(issuesEndpoint).toBeDefined()
    expect(decodeURIComponent(issuesEndpoint as string)).toContain('reporter.nickname = "erin"')
  }))

  it('surfaces an error when @me cannot be resolved, matching the PR-list path', withCredentials(async () => {
    const runner = async (endpoint: string) => {
      if (endpoint === 'user') return '{}'
      return JSON.stringify({ values: [makeIssue()], pagelen: 50, page: 1 })
    }
    const overview = await getBitbucketIssueList(fakeGit(), { assignee: '@me' }, runner)
    expect(overview.message).toContain('Could not resolve "@me"')
    expect(overview.issues).toBeUndefined()
  }))

  it('does not resolve @me for a named assignee (only the auth probe hits /user)', withCredentials(async () => {
    const payload = JSON.stringify({ values: [makeIssue()], pagelen: 50, page: 1 })
    const seenEndpoints: string[] = []
    const runner = async (endpoint: string) => {
      seenEndpoints.push(endpoint)
      if (endpoint === 'user') return JSON.stringify({ nickname: 'erin' })
      return payload
    }
    const overview = await getBitbucketIssueList(fakeGit(), { assignee: 'alice' }, runner)
    expect(overview.issues).toHaveLength(1)
    const issuesEndpoint = seenEndpoints.find((e) => e.startsWith('repositories/'))
    expect(decodeURIComponent(issuesEndpoint as string)).toContain('assignee.nickname = "alice"')
    // 'user' is hit once for the loadForgeList auth probe, never again for a named (non-@me) filter.
    expect(seenEndpoints.filter((e) => e === 'user')).toHaveLength(1)
  }))
})
