import { SimpleGit } from 'simple-git'
import {
  describeBitbucketStatus,
  getBitbucketProject,
  getBitbucketStatus,
  isBitbucketAuthenticated,
  resolveBitbucketActionError,
  compactBitbucketError,
} from './bitbucketCli'

function throwingRunner(error: unknown) {
  return async () => {
    throw error
  }
}

function fakeGit(remotes: Array<{ name: string; refs: { fetch?: string; push?: string } }>): SimpleGit {
  return { getRemotes: async () => remotes } as unknown as SimpleGit
}

// Save and restore env vars around tests that set them.
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

describe('getBitbucketStatus (1238)', () => {
  it(
    'returns not-authenticated when no credentials are set',
    withEnv(
      { BITBUCKET_ACCESS_TOKEN: undefined, BITBUCKET_USERNAME: undefined, BITBUCKET_APP_PASSWORD: undefined },
      async () => {
        const status = await getBitbucketStatus(async () => '')
        expect(status.kind).toBe('not-authenticated')
      }
    )
  )

  it(
    'returns ok when the /user probe succeeds',
    withEnv({ BITBUCKET_ACCESS_TOKEN: 'tok' }, async () => {
      const status = await getBitbucketStatus(async () => '{"nickname":"alice"}')
      expect(status.kind).toBe('ok')
    })
  )

  it(
    'returns not-authenticated on 401',
    withEnv({ BITBUCKET_ACCESS_TOKEN: 'bad' }, async () => {
      const err = Object.assign(new Error('Unauthorized'), { status: 401 })
      const status = await getBitbucketStatus(throwingRunner(err))
      expect(status.kind).toBe('not-authenticated')
    })
  )

  it(
    'returns unknown on network error',
    withEnv({ BITBUCKET_ACCESS_TOKEN: 'tok' }, async () => {
      const status = await getBitbucketStatus(throwingRunner(new Error('ECONNREFUSED')))
      expect(status.kind).toBe('unknown')
    })
  )

  it(
    'isBitbucketAuthenticated reflects ok',
    withEnv({ BITBUCKET_ACCESS_TOKEN: 'tok' }, async () => {
      expect(await isBitbucketAuthenticated(async () => '{}')).toBe(true)
    })
  )
})

describe('describeBitbucketStatus (1238)', () => {
  it('names BITBUCKET_ACCESS_TOKEN in the not-authenticated hint', () => {
    expect(describeBitbucketStatus({ kind: 'not-authenticated' })).toContain('BITBUCKET_ACCESS_TOKEN')
  })

  it('confirms ok', () => {
    expect(describeBitbucketStatus({ kind: 'ok' })).toContain('authenticated')
  })

  it('includes the error in unknown', () => {
    expect(describeBitbucketStatus({ kind: 'unknown', detail: 'boom' })).toContain('boom')
  })
})

describe('compactBitbucketError (1238)', () => {
  it('uses the first line as the message', () => {
    const result = compactBitbucketError('line1\nline2\nline3')
    expect(result.message).toBe('line1')
    expect(result.details).toEqual(['line2', 'line3'])
  })

  it('trims blank lines', () => {
    const result = compactBitbucketError('  first  \n\n  second  ')
    expect(result.message).toBe('first')
    expect(result.details).toEqual(['second'])
  })
})

describe('resolveBitbucketActionError (1238)', () => {
  it('returns the recovery hint when auth is broken', withEnv(
    { BITBUCKET_ACCESS_TOKEN: undefined, BITBUCKET_USERNAME: undefined, BITBUCKET_APP_PASSWORD: undefined },
    async () => {
      const result = await resolveBitbucketActionError(new Error('failed'), async () => '')
      expect(result.message).toContain('BITBUCKET_ACCESS_TOKEN')
    }
  ))

  it('compacts the raw error when auth is fine', withEnv(
    { BITBUCKET_ACCESS_TOKEN: 'tok' },
    async () => {
      const result = await resolveBitbucketActionError(
        new Error('line1\nline2\nline3'),
        async () => '{}'
      )
      expect(result.message).toBe('line1')
      expect(result.details).toEqual(['line2', 'line3'])
    }
  ))
})

describe('getBitbucketProject (1238)', () => {
  it('parses workspace/slug from HTTPS remote', async () => {
    const git = fakeGit([{ name: 'origin', refs: { fetch: 'https://bitbucket.org/myworkspace/myrepo.git' } }])
    expect(await getBitbucketProject(git)).toEqual({
      owner: 'myworkspace',
      name: 'myrepo',
      path: 'myworkspace/myrepo',
      host: 'bitbucket.org',
    })
  })

  it('parses workspace/slug from SSH remote', async () => {
    const git = fakeGit([{ name: 'origin', refs: { fetch: 'git@bitbucket.org:workspace/repo.git' } }])
    const project = await getBitbucketProject(git)
    expect(project?.owner).toBe('workspace')
    expect(project?.name).toBe('repo')
    expect(project?.host).toBe('bitbucket.org')
  })

  it('returns undefined when there is no remote', async () => {
    expect(await getBitbucketProject(fakeGit([]))).toBeUndefined()
  })
})
