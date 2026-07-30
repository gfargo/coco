import { SimpleGit } from 'simple-git'
import {
  getBitbucketServerPullRequestList,
  getBitbucketServerIssueList,
  findOpenBitbucketServerPullRequestForBranch,
  __test,
} from './bitbucketServerListData'

const { bitbucketServerStateParam, buildPullRequestEndpoint, mapPullRequestItem, normalizeState, resolveBitbucketServerMeSlug } = __test

function fakeGit(url = 'https://bb.acme.com/scm/TEAM/repo.git'): SimpleGit {
  return { getRemotes: async () => [{ name: 'origin', refs: { fetch: url } }] } as unknown as SimpleGit
}

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  return async () => {
    const saved: Record<string, string | undefined> = {}
    for (const key of Object.keys(vars)) {
      saved[key] = process.env[key]
      if (vars[key] === undefined) delete process.env[key]
      else process.env[key] = vars[key]
    }
    try {
      await fn()
    } finally {
      for (const key of Object.keys(saved)) {
        if (saved[key] === undefined) delete process.env[key]
        else process.env[key] = saved[key]
      }
    }
  }
}

describe('bitbucketServerStateParam', () => {
  it('maps coco filter states to Bitbucket Server query states', () => {
    expect(bitbucketServerStateParam('open')).toBe('OPEN')
    expect(bitbucketServerStateParam('merged')).toBe('MERGED')
    expect(bitbucketServerStateParam('closed')).toBe('DECLINED')
    expect(bitbucketServerStateParam(undefined)).toBe('ALL')
  })
})

describe('normalizeState', () => {
  it('maps DECLINED to CLOSED and passes through everything else', () => {
    expect(normalizeState('DECLINED')).toBe('CLOSED')
    expect(normalizeState('OPEN')).toBe('OPEN')
    expect(normalizeState('MERGED')).toBe('MERGED')
  })
})

describe('buildPullRequestEndpoint', () => {
  it('builds a project/repo endpoint with state + filterText params', () => {
    const endpoint = buildPullRequestEndpoint('TEAM/repo', { state: 'open', search: 'fix bug' })
    expect(endpoint).toContain('projects/TEAM/repos/repo/pull-requests?')
    expect(endpoint).toContain('state=OPEN')
    expect(endpoint).toContain('filterText=fix%20bug')
  })

  it('returns undefined for a malformed path', () => {
    expect(buildPullRequestEndpoint('no-slash', {})).toBeUndefined()
  })
})

describe('mapPullRequestItem', () => {
  it('maps the Bitbucket Server PR DTO to PullRequestListItem', () => {
    const item = mapPullRequestItem({
      id: 5,
      title: 'Fix bug',
      state: 'DECLINED',
      fromRef: { displayId: 'feature/x' },
      toRef: { displayId: 'main' },
      author: { user: { slug: 'alice' } },
      reviewers: [{ user: { slug: 'bob' } }],
      links: { self: [{ href: 'https://bb.acme.com/projects/TEAM/repos/repo/pull-requests/5' }] },
      createdDate: 1700000000000,
      updatedDate: 1700000001000,
    })
    expect(item).toMatchObject({
      number: 5,
      title: 'Fix bug',
      state: 'CLOSED',
      headRefName: 'feature/x',
      baseRefName: 'main',
      author: 'alice',
      assignees: ['bob'],
      url: 'https://bb.acme.com/projects/TEAM/repos/repo/pull-requests/5',
    })
    expect(item.createdAt).toBe(new Date(1700000000000).toISOString())
  })
})

describe('resolveBitbucketServerMeSlug', () => {
  it(
    'resolves to BITBUCKET_SERVER_USERNAME when set',
    withEnv({ BITBUCKET_SERVER_USERNAME: 'alice' }, async () => {
      expect(resolveBitbucketServerMeSlug()).toBe('alice')
    })
  )

  it(
    'is undefined under token auth (no username to resolve @me against)',
    withEnv({ BITBUCKET_SERVER_USERNAME: undefined }, async () => {
      expect(resolveBitbucketServerMeSlug()).toBeUndefined()
    })
  )
})

describe('getBitbucketServerPullRequestList', () => {
  it(
    'fetches, maps, and reports availability/auth',
    withEnv({ BITBUCKET_SERVER_TOKEN: 'tok' }, async () => {
      const runner = jest.fn(async (endpoint: string) => {
        if (endpoint.includes('profile/recent/repos')) return '{"values":[]}'
        return JSON.stringify({
          isLastPage: true,
          values: [
            {
              id: 1,
              title: 'PR one',
              state: 'OPEN',
              fromRef: { displayId: 'f' },
              toRef: { displayId: 'main' },
              links: { self: [{ href: 'https://bb.acme.com/x' }] },
            },
          ],
        })
      })
      const overview = await getBitbucketServerPullRequestList(fakeGit(), {}, () => runner)
      expect(overview.available).toBe(true)
      expect(overview.authenticated).toBe(true)
      expect(overview.pullRequests).toHaveLength(1)
      expect(overview.pullRequests?.[0].number).toBe(1)
    })
  )

  it(
    'reports unavailable when no remote is detected',
    withEnv({ BITBUCKET_SERVER_TOKEN: 'tok' }, async () => {
      const overview = await getBitbucketServerPullRequestList(
        { getRemotes: async () => [] } as unknown as SimpleGit,
        {}
      )
      expect(overview.available).toBe(false)
    })
  )
})

describe('getBitbucketServerIssueList', () => {
  it(
    'reports the missing-issue-tracker gap explicitly once authenticated',
    withEnv({ BITBUCKET_SERVER_TOKEN: 'tok' }, async () => {
      const runner = jest.fn(async () => '{"values":[]}')
      const overview = await getBitbucketServerIssueList(fakeGit(), {}, () => runner)
      expect(overview.available).toBe(true)
      expect(overview.authenticated).toBe(true)
      expect(overview.message).toContain('no built-in issue tracker')
    })
  )
})

describe('findOpenBitbucketServerPullRequestForBranch', () => {
  it('filters via direction=OUTGOING&at=refs/heads/<branch>', async () => {
    const runner = jest.fn(async (endpoint: string) => {
      expect(endpoint).toContain('direction=OUTGOING')
      expect(endpoint).toContain(encodeURIComponent('refs/heads/feature/x'))
      return JSON.stringify({ values: [{ id: 3 }] })
    })
    const pr = await findOpenBitbucketServerPullRequestForBranch('TEAM/repo', 'feature/x', runner)
    expect(pr?.id).toBe(3)
  })
})
