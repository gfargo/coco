import { SimpleGit } from 'simple-git'
import {
  describeGiteaStatus,
  getGiteaProject,
  getGiteaStatus,
  isGiteaAuthenticated,
  resolveGiteaActionError,
  compactGiteaError,
} from './giteaCli'

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

describe('getGiteaStatus (#826)', () => {
  it(
    'returns not-authenticated when GITEA_TOKEN is unset',
    withEnv({ GITEA_TOKEN: undefined }, async () => {
      const status = await getGiteaStatus(async () => '')
      expect(status.kind).toBe('not-authenticated')
    })
  )

  it(
    'returns ok when the /user probe succeeds',
    withEnv({ GITEA_TOKEN: 'tok' }, async () => {
      const status = await getGiteaStatus(async () => '{"login":"alice"}')
      expect(status.kind).toBe('ok')
    })
  )

  it(
    'returns not-authenticated on 401',
    withEnv({ GITEA_TOKEN: 'bad' }, async () => {
      const err = Object.assign(new Error('Unauthorized'), { status: 401 })
      const status = await getGiteaStatus(throwingRunner(err))
      expect(status.kind).toBe('not-authenticated')
    })
  )

  it(
    'returns unknown on network error',
    withEnv({ GITEA_TOKEN: 'tok' }, async () => {
      const status = await getGiteaStatus(throwingRunner(new Error('ECONNREFUSED')))
      expect(status.kind).toBe('unknown')
    })
  )

  it(
    'isGiteaAuthenticated reflects ok',
    withEnv({ GITEA_TOKEN: 'tok' }, async () => {
      expect(await isGiteaAuthenticated(async () => '{}')).toBe(true)
    })
  )
})

describe('describeGiteaStatus (#826)', () => {
  it('names GITEA_TOKEN in the not-authenticated hint', () => {
    expect(describeGiteaStatus({ kind: 'not-authenticated' })).toContain('GITEA_TOKEN')
  })

  it('confirms ok', () => {
    expect(describeGiteaStatus({ kind: 'ok' })).toContain('authenticated')
  })

  it('includes the error in unknown', () => {
    expect(describeGiteaStatus({ kind: 'unknown', detail: 'boom' })).toContain('boom')
  })
})

describe('compactGiteaError (#826)', () => {
  it('uses the first line as the message', () => {
    const result = compactGiteaError('line1\nline2\nline3')
    expect(result.message).toBe('line1')
    expect(result.details).toEqual(['line2', 'line3'])
  })

  it('trims blank lines', () => {
    const result = compactGiteaError('  first  \n\n  second  ')
    expect(result.message).toBe('first')
    expect(result.details).toEqual(['second'])
  })
})

describe('resolveGiteaActionError (#826)', () => {
  it(
    'returns the recovery hint when auth is broken',
    withEnv({ GITEA_TOKEN: undefined }, async () => {
      const result = await resolveGiteaActionError(new Error('failed'), async () => '')
      expect(result.message).toContain('GITEA_TOKEN')
    })
  )

  it(
    'compacts the raw error when auth is fine',
    withEnv({ GITEA_TOKEN: 'tok' }, async () => {
      const result = await resolveGiteaActionError(new Error('line1\nline2\nline3'), async () => '{}')
      expect(result.message).toBe('line1')
      expect(result.details).toEqual(['line2', 'line3'])
    })
  )
})

describe('getGiteaProject (#826)', () => {
  it('parses owner/repo from HTTPS remote', async () => {
    const git = fakeGit([{ name: 'origin', refs: { fetch: 'https://codeberg.org/myorg/myrepo.git' } }])
    expect(await getGiteaProject(git)).toEqual({
      owner: 'myorg',
      name: 'myrepo',
      path: 'myorg/myrepo',
      host: 'codeberg.org',
    })
  })

  it('parses owner/repo from SSH remote on a self-hosted host', async () => {
    const git = fakeGit([{ name: 'origin', refs: { fetch: 'git@git.example.com:team/repo.git' } }])
    const project = await getGiteaProject(git)
    expect(project?.owner).toBe('team')
    expect(project?.name).toBe('repo')
    expect(project?.host).toBe('git.example.com')
  })

  it('returns undefined when there is no remote', async () => {
    expect(await getGiteaProject(fakeGit([]))).toBeUndefined()
  })
})
