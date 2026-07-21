import { SimpleGit } from 'simple-git'
import { getGiteaPullRequestList, getGiteaIssueList, getGiteaPullRequestOverview, __test } from './giteaListData'
import type { GiteaRunner } from './giteaCli'

const {
  giteaPullRequestStateParam,
  giteaIssueStateParam,
  mapPullRequestItem,
  mapIssueItem,
  isPullRequestEntry,
  isDraftPR,
  resolveGiteaMeLogin,
} = __test

function fakeGit(url = 'https://codeberg.org/owner/repo.git'): SimpleGit {
  return {
    getRemotes: async () => [{ name: 'origin', refs: { fetch: url } }],
    raw: async (args: string[]) => (args[0] === 'branch' ? 'feat/x\n' : ''),
  } as unknown as SimpleGit
}

type Responder = (endpoint: string) => string | Promise<string>

function makeFactory(respond: Responder, hostsSeen?: string[]) {
  return (host: string) => {
    hostsSeen?.push(host)
    return (async (endpoint: string) => respond(endpoint)) as GiteaRunner
  }
}

// Every loader probes auth via GITEA_TOKEN first; set a token by default so
// each test only has to opt out (the "missing token" test below) rather than
// every other test opting in.
let savedGiteaToken: string | undefined
beforeEach(() => {
  savedGiteaToken = process.env.GITEA_TOKEN
  process.env.GITEA_TOKEN = 'test-token'
})
afterEach(() => {
  if (savedGiteaToken === undefined) delete process.env.GITEA_TOKEN
  else process.env.GITEA_TOKEN = savedGiteaToken
})

// ---------------------------------------------------------------------------
// State param mapping
// ---------------------------------------------------------------------------

describe('giteaPullRequestStateParam (#826)', () => {
  it('maps open -> open', () => expect(giteaPullRequestStateParam('open')).toBe('open'))
  it('maps closed -> closed', () => expect(giteaPullRequestStateParam('closed')).toBe('closed'))
  it('maps merged -> closed (filtered client-side afterward)', () =>
    expect(giteaPullRequestStateParam('merged')).toBe('closed'))
  it('maps all/undefined -> all', () => {
    expect(giteaPullRequestStateParam('all')).toBe('all')
    expect(giteaPullRequestStateParam(undefined)).toBe('all')
  })
})

describe('giteaIssueStateParam (#826)', () => {
  it('maps open -> open', () => expect(giteaIssueStateParam('open')).toBe('open'))
  it('maps closed -> closed', () => expect(giteaIssueStateParam('closed')).toBe('closed'))
  it('maps all/undefined -> all', () => {
    expect(giteaIssueStateParam('all')).toBe('all')
    expect(giteaIssueStateParam(undefined)).toBe('all')
  })
})

// ---------------------------------------------------------------------------
// isDraftPR
// ---------------------------------------------------------------------------

describe('isDraftPR (#826)', () => {
  it('reads the draft boolean when present', () => {
    expect(isDraftPR({ draft: true, title: 'x' })).toBe(true)
    expect(isDraftPR({ draft: false, title: 'x' })).toBe(false)
  })

  it('falls back to a [WIP] title prefix on older Gitea/Forgejo', () => {
    expect(isDraftPR({ title: '[WIP] my feature' })).toBe(true)
    expect(isDraftPR({ title: 'my feature' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// mapPullRequestItem
// ---------------------------------------------------------------------------

function makePR(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 1,
    title: 'My PR',
    body: 'body',
    state: 'open',
    merged: false,
    draft: false,
    head: { ref: 'feat/x' },
    base: { ref: 'main' },
    user: { login: 'alice' },
    assignees: [{ login: 'bob' }],
    labels: [{ name: 'bug' }],
    html_url: 'https://codeberg.org/owner/repo/pulls/1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    ...overrides,
  }
}

describe('mapPullRequestItem (#826)', () => {
  it('maps a Gitea PR to the shared view model', () => {
    expect(mapPullRequestItem(makePR())).toEqual({
      number: 1,
      title: 'My PR',
      url: 'https://codeberg.org/owner/repo/pulls/1',
      state: 'OPEN',
      isDraft: false,
      headRefName: 'feat/x',
      baseRefName: 'main',
      author: 'alice',
      reviewDecision: undefined,
      mergeable: undefined,
      mergeStateStatus: undefined,
      assignees: ['bob'],
      labels: ['bug'],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    })
  })

  it('maps merged: true to state MERGED regardless of the state field', () => {
    expect(mapPullRequestItem(makePR({ state: 'closed', merged: true })).state).toBe('MERGED')
  })

  it('maps mergeable boolean to MERGEABLE/CONFLICTING', () => {
    expect(mapPullRequestItem(makePR({ mergeable: true })).mergeable).toBe('MERGEABLE')
    expect(mapPullRequestItem(makePR({ mergeable: false })).mergeable).toBe('CONFLICTING')
  })

  it('handles missing optional fields gracefully', () => {
    const item = mapPullRequestItem({ number: 5 })
    expect(item.number).toBe(5)
    expect(item.author).toBeUndefined()
    expect(item.assignees).toBeUndefined()
    expect(item.labels).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// mapIssueItem / isPullRequestEntry
// ---------------------------------------------------------------------------

function makeIssue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 7,
    title: 'Bug report',
    body: 'some body',
    state: 'open',
    user: { login: 'dave' },
    assignees: [{ login: 'erin' }],
    labels: [{ name: 'bug' }],
    comments: 3,
    html_url: 'https://codeberg.org/owner/repo/issues/7',
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-02T00:00:00Z',
    ...overrides,
  }
}

describe('isPullRequestEntry (#826)', () => {
  it('treats entries with a non-null pull_request field as PRs', () => {
    expect(isPullRequestEntry(makeIssue({ pull_request: { url: 'x' } }))).toBe(true)
  })

  it('treats entries with no pull_request field as issues', () => {
    expect(isPullRequestEntry(makeIssue())).toBe(false)
    expect(isPullRequestEntry(makeIssue({ pull_request: null }))).toBe(false)
  })
})

describe('mapIssueItem (#826)', () => {
  it('maps a Gitea issue to the shared issue view model', () => {
    expect(mapIssueItem(makeIssue())).toMatchObject({
      number: 7,
      title: 'Bug report',
      url: 'https://codeberg.org/owner/repo/issues/7',
      state: 'OPEN',
      author: 'dave',
      assignees: ['erin'],
      labels: ['bug'],
      comments: 3,
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-02T00:00:00Z',
    })
  })

  it('falls back to the singular assignee field when assignees is absent', () => {
    const item = mapIssueItem(makeIssue({ assignees: undefined, assignee: { login: 'frank' } }))
    expect(item.assignees).toEqual(['frank'])
  })

  it('handles missing optional fields gracefully', () => {
    const item = mapIssueItem({ number: 2, title: 'x', state: 'open' })
    expect(item.assignees).toBeUndefined()
    expect(item.labels).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// resolveGiteaMeLogin
// ---------------------------------------------------------------------------

describe('resolveGiteaMeLogin (#826)', () => {
  it('returns the login from GET /user', async () => {
    const runner: GiteaRunner = async () => JSON.stringify({ login: 'alice' })
    expect(await resolveGiteaMeLogin(runner)).toBe('alice')
  })

  it('returns undefined when the response has no login', async () => {
    const runner: GiteaRunner = async () => '{}'
    expect(await resolveGiteaMeLogin(runner)).toBeUndefined()
  })

  it('returns undefined for an empty response', async () => {
    const runner: GiteaRunner = async () => ''
    expect(await resolveGiteaMeLogin(runner)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// getGiteaPullRequestList / getGiteaIssueList
// ---------------------------------------------------------------------------

describe('getGiteaPullRequestList (#826)', () => {
  it('builds the runner from the detected repository host', async () => {
    const hostsSeen: string[] = []
    const factory = makeFactory((endpoint) => (endpoint === 'user' ? '{}' : JSON.stringify([makePR()])), hostsSeen)
    await getGiteaPullRequestList(fakeGit('https://git.example.com/owner/repo.git'), {}, factory)
    expect(hostsSeen).toContain('git.example.com')
  })

  it('returns a populated PR overview', async () => {
    const factory = makeFactory((endpoint) => (endpoint === 'user' ? '{}' : JSON.stringify([makePR()])))
    const overview = await getGiteaPullRequestList(fakeGit(), {}, factory)
    expect(overview).toMatchObject({
      available: true,
      authenticated: true,
      repository: { owner: 'owner', name: 'repo' },
    })
    expect(overview.pullRequests).toHaveLength(1)
  })

  it('reports no remote when there are no remotes', async () => {
    const git = { getRemotes: async () => [] } as unknown as SimpleGit
    const overview = await getGiteaPullRequestList(git, {}, makeFactory(() => '{}'))
    expect(overview).toMatchObject({ available: false, message: 'No Gitea remote detected.' })
  })

  it('filters out merged PRs when requesting state=closed', async () => {
    const factory = makeFactory((endpoint) =>
      endpoint === 'user'
        ? '{}'
        : JSON.stringify([
            makePR({ number: 1, state: 'closed', merged: false }),
            makePR({ number: 2, state: 'closed', merged: true }),
          ])
    )
    const overview = await getGiteaPullRequestList(fakeGit(), { state: 'closed' }, factory)
    expect(overview.pullRequests).toHaveLength(1)
    expect(overview.pullRequests?.[0]?.number).toBe(1)
  })

  it('filters to only merged PRs when requesting state=merged', async () => {
    const factory = makeFactory((endpoint) =>
      endpoint === 'user'
        ? '{}'
        : JSON.stringify([
            makePR({ number: 1, state: 'closed', merged: false }),
            makePR({ number: 2, state: 'closed', merged: true }),
          ])
    )
    const overview = await getGiteaPullRequestList(fakeGit(), { state: 'merged' }, factory)
    expect(overview.pullRequests).toHaveLength(1)
    expect(overview.pullRequests?.[0]?.number).toBe(2)
  })

  it('resolves author=@me to the authenticated login and filters by it', async () => {
    const factory = makeFactory((endpoint) =>
      endpoint === 'user'
        ? JSON.stringify({ login: 'alice' })
        : JSON.stringify([
            makePR({ number: 1, user: { login: 'alice' } }),
            makePR({ number: 2, user: { login: 'bob' } }),
          ])
    )
    const overview = await getGiteaPullRequestList(fakeGit(), { author: '@me' }, factory)
    expect(overview.pullRequests).toHaveLength(1)
    expect(overview.pullRequests?.[0]?.author).toBe('alice')
  })

  it('surfaces an explicit message when @me cannot be resolved', async () => {
    const factory = makeFactory((endpoint) => (endpoint === 'user' ? '{}' : JSON.stringify([makePR()])))
    const overview = await getGiteaPullRequestList(fakeGit(), { author: '@me' }, factory)
    expect(overview.message).toContain('Could not resolve "@me"')
    expect(overview.pullRequests).toBeUndefined()
  })

  it('filters by label (AND semantics on a comma-separated list)', async () => {
    const factory = makeFactory((endpoint) =>
      endpoint === 'user'
        ? '{}'
        : JSON.stringify([
            makePR({ number: 1, labels: [{ name: 'bug' }, { name: 'urgent' }] }),
            makePR({ number: 2, labels: [{ name: 'bug' }] }),
          ])
    )
    const overview = await getGiteaPullRequestList(fakeGit(), { label: 'bug,urgent' }, factory)
    expect(overview.pullRequests).toHaveLength(1)
    expect(overview.pullRequests?.[0]?.number).toBe(1)
  })
})

describe('getGiteaIssueList (#826)', () => {
  it('excludes pull requests returned by the /issues endpoint', async () => {
    const factory = makeFactory((endpoint) =>
      endpoint === 'user'
        ? '{}'
        : JSON.stringify([makeIssue({ number: 1 }), makeIssue({ number: 2, pull_request: { url: 'x' } })])
    )
    const overview = await getGiteaIssueList(fakeGit(), {}, factory)
    expect(overview.issues).toHaveLength(1)
    expect(overview.issues?.[0]?.number).toBe(1)
  })

  it('returns a populated issue overview', async () => {
    const factory = makeFactory((endpoint) => (endpoint === 'user' ? '{}' : JSON.stringify([makeIssue()])))
    const overview = await getGiteaIssueList(fakeGit(), {}, factory)
    expect(overview).toMatchObject({ available: true, authenticated: true })
    expect(overview.issues).toHaveLength(1)
  })

  it('surfaces not-authenticated when GITEA_TOKEN is missing', async () => {
    delete process.env.GITEA_TOKEN
    const overview = await getGiteaIssueList(fakeGit(), {}, makeFactory(() => '{}'))
    expect(overview.authenticated).toBe(false)
    expect(overview.message).toContain('GITEA_TOKEN')
  })
})

// ---------------------------------------------------------------------------
// getGiteaPullRequestOverview
// ---------------------------------------------------------------------------

describe('getGiteaPullRequestOverview (#826)', () => {
  it('finds the open PR whose head branch matches the current branch', async () => {
    const factory = makeFactory((endpoint) =>
      endpoint === 'user'
        ? '{}'
        : JSON.stringify([makePR({ number: 9, head: { ref: 'feat/x' } })])
    )
    const overview = await getGiteaPullRequestOverview(fakeGit(), factory)
    expect(overview.currentPullRequest).toMatchObject({ number: 9, headRefName: 'feat/x' })
  })

  it('reports no PR when none matches the current branch', async () => {
    const factory = makeFactory((endpoint) => (endpoint === 'user' ? '{}' : '[]'))
    const overview = await getGiteaPullRequestOverview(fakeGit(), factory)
    expect(overview.currentPullRequest).toBeUndefined()
    expect(overview.message).toContain('No pull request found')
  })
})
