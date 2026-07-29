import { SimpleGit } from 'simple-git'
import {
  describeBitbucketServerStatus,
  getBitbucketServerProject,
  getBitbucketServerStatus,
  isBitbucketServerAuthenticated,
  resolveBitbucketServerActionError,
  compactBitbucketServerError,
  splitBitbucketServerPath,
  stripScmSegment,
} from './bitbucketServerCli'

function throwingRunner(error: unknown) {
  return async () => {
    throw error
  }
}

function fakeGit(remotes: Array<{ name: string; refs: { fetch?: string; push?: string } }>): SimpleGit {
  return { getRemotes: async () => remotes } as unknown as SimpleGit
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

describe('stripScmSegment', () => {
  it('strips a leading scm segment from an HTTP(S) clone owner', () => {
    expect(stripScmSegment('scm/TEAM')).toBe('TEAM')
  })

  it('leaves an SSH-style owner (no scm segment) untouched', () => {
    expect(stripScmSegment('TEAM')).toBe('TEAM')
  })
})

describe('splitBitbucketServerPath', () => {
  it('splits projectKey/repoSlug', () => {
    expect(splitBitbucketServerPath('TEAM/repo')).toEqual({ projectKey: 'TEAM', repoSlug: 'repo' })
  })

  it('returns undefined for a path with no slash', () => {
    expect(splitBitbucketServerPath('TEAM')).toBeUndefined()
  })
})

describe('getBitbucketServerStatus', () => {
  it(
    'returns not-authenticated when no credentials are set',
    withEnv(
      { BITBUCKET_SERVER_TOKEN: undefined, BITBUCKET_SERVER_USERNAME: undefined, BITBUCKET_SERVER_PASSWORD: undefined },
      async () => {
        const status = await getBitbucketServerStatus(async () => '')
        expect(status.kind).toBe('not-authenticated')
      }
    )
  )

  it(
    'returns ok when the authenticated probe succeeds with a token',
    withEnv({ BITBUCKET_SERVER_TOKEN: 'tok' }, async () => {
      const status = await getBitbucketServerStatus(async () => '{"values":[]}')
      expect(status.kind).toBe('ok')
    })
  )

  it(
    'returns ok with username + password Basic auth',
    withEnv({ BITBUCKET_SERVER_USERNAME: 'alice', BITBUCKET_SERVER_PASSWORD: 'pw' }, async () => {
      const status = await getBitbucketServerStatus(async () => '{"values":[]}')
      expect(status.kind).toBe('ok')
    })
  )

  it(
    'returns not-authenticated on 401',
    withEnv({ BITBUCKET_SERVER_TOKEN: 'bad' }, async () => {
      const err = Object.assign(new Error('Unauthorized'), { status: 401 })
      const status = await getBitbucketServerStatus(throwingRunner(err))
      expect(status.kind).toBe('not-authenticated')
    })
  )

  it(
    'returns unknown on network error',
    withEnv({ BITBUCKET_SERVER_TOKEN: 'tok' }, async () => {
      const status = await getBitbucketServerStatus(throwingRunner(new Error('ECONNREFUSED')))
      expect(status.kind).toBe('unknown')
    })
  )

  it(
    'isBitbucketServerAuthenticated reflects ok',
    withEnv({ BITBUCKET_SERVER_TOKEN: 'tok' }, async () => {
      expect(await isBitbucketServerAuthenticated(async () => '{}')).toBe(true)
    })
  )
})

describe('describeBitbucketServerStatus', () => {
  it('names both credential options in the not-authenticated hint', () => {
    const message = describeBitbucketServerStatus({ kind: 'not-authenticated' })
    expect(message).toContain('BITBUCKET_SERVER_TOKEN')
    expect(message).toContain('BITBUCKET_SERVER_USERNAME')
  })

  it('confirms ok', () => {
    expect(describeBitbucketServerStatus({ kind: 'ok' })).toContain('authenticated')
  })

  it('includes the error in unknown', () => {
    expect(describeBitbucketServerStatus({ kind: 'unknown', detail: 'boom' })).toContain('boom')
  })
})

describe('compactBitbucketServerError', () => {
  it('uses the first line as the message', () => {
    const result = compactBitbucketServerError('line1\nline2\nline3')
    expect(result.message).toBe('line1')
    expect(result.details).toEqual(['line2', 'line3'])
  })
})

describe('resolveBitbucketServerActionError', () => {
  it(
    'returns the recovery hint when auth is broken',
    withEnv({ BITBUCKET_SERVER_TOKEN: undefined, BITBUCKET_SERVER_USERNAME: undefined, BITBUCKET_SERVER_PASSWORD: undefined }, async () => {
      const result = await resolveBitbucketServerActionError(new Error('failed'), async () => '')
      expect(result.message).toContain('BITBUCKET_SERVER_TOKEN')
    })
  )

  it(
    'compacts the raw error when auth is fine',
    withEnv({ BITBUCKET_SERVER_TOKEN: 'tok' }, async () => {
      const result = await resolveBitbucketServerActionError(new Error('line1\nline2\nline3'), async () => '{}')
      expect(result.message).toBe('line1')
      expect(result.details).toEqual(['line2', 'line3'])
    })
  )
})

describe('getBitbucketServerProject', () => {
  it('parses projectKey/repo from an HTTPS clone URL, stripping the /scm/ segment', async () => {
    const git = fakeGit([{ name: 'origin', refs: { fetch: 'https://bb.acme.com/scm/TEAM/repo.git' } }])
    expect(await getBitbucketServerProject(git)).toEqual({
      owner: 'TEAM',
      name: 'repo',
      path: 'TEAM/repo',
      host: 'bb.acme.com',
    })
  })

  it('parses projectKey/repo from an SSH clone URL (no /scm/ segment)', async () => {
    const git = fakeGit([{ name: 'origin', refs: { fetch: 'ssh://git@bb.acme.com:7999/TEAM/repo.git' } }])
    const project = await getBitbucketServerProject(git)
    expect(project?.owner).toBe('TEAM')
    expect(project?.name).toBe('repo')
    expect(project?.host).toBe('bb.acme.com')
  })

  it('returns undefined when there is no remote', async () => {
    expect(await getBitbucketServerProject(fakeGit([]))).toBeUndefined()
  })
})
