import { SimpleGit } from 'simple-git'
import {
  buildAzureDevOpsRepoWebUrl,
  compactAzureDevOpsError,
  describeAzureDevOpsStatus,
  getAzureDevOpsProject,
  getAzureDevOpsStatus,
  isAzureDevOpsAuthenticated,
  isAzureDevOpsHost,
  makeAzureDevOpsRunner,
  parseAzureDevOpsRemoteUrl,
  resolveAzureDevOpsActionError,
  resolveAzureDevOpsSelfIdentity,
  runAzureDevOpsAction,
  splitAzureDevOpsPath,
} from './azureDevOpsCli'

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

describe('isAzureDevOpsHost', () => {
  it('matches dev.azure.com, ssh.dev.azure.com, and *.visualstudio.com', () => {
    expect(isAzureDevOpsHost('dev.azure.com')).toBe(true)
    expect(isAzureDevOpsHost('SSH.DEV.AZURE.COM')).toBe(true)
    expect(isAzureDevOpsHost('myorg.visualstudio.com')).toBe(true)
  })

  it('rejects unrelated hosts', () => {
    expect(isAzureDevOpsHost('github.com')).toBe(false)
    expect(isAzureDevOpsHost('azure.com')).toBe(false)
  })
})

describe('parseAzureDevOpsRemoteUrl', () => {
  it('parses the dev.azure.com HTTPS form', () => {
    expect(parseAzureDevOpsRemoteUrl('https://dev.azure.com/myorg/myproject/_git/myrepo')).toEqual({
      org: 'myorg',
      project: 'myproject',
      repo: 'myrepo',
      owner: 'myorg/myproject',
      name: 'myrepo',
      path: 'myorg/myproject/myrepo',
      host: 'dev.azure.com',
    })
  })

  it('strips a trailing .git and a leading user@', () => {
    const parsed = parseAzureDevOpsRemoteUrl('https://user@dev.azure.com/myorg/myproject/_git/myrepo.git')
    expect(parsed?.path).toBe('myorg/myproject/myrepo')
  })

  it('parses the scp-style SSH form with the v3 prefix', () => {
    expect(parseAzureDevOpsRemoteUrl('git@ssh.dev.azure.com:v3/myorg/myproject/myrepo')).toEqual({
      org: 'myorg',
      project: 'myproject',
      repo: 'myrepo',
      owner: 'myorg/myproject',
      name: 'myrepo',
      path: 'myorg/myproject/myrepo',
      host: 'ssh.dev.azure.com',
    })
  })

  it('parses the {org}.visualstudio.com form (org in the subdomain)', () => {
    expect(parseAzureDevOpsRemoteUrl('https://myorg.visualstudio.com/myproject/_git/myrepo')).toEqual({
      org: 'myorg',
      project: 'myproject',
      repo: 'myrepo',
      owner: 'myorg/myproject',
      name: 'myrepo',
      path: 'myorg/myproject/myrepo',
      host: 'myorg.visualstudio.com',
    })
  })

  it('returns undefined for a non-Azure-DevOps host', () => {
    expect(parseAzureDevOpsRemoteUrl('https://github.com/owner/repo.git')).toBeUndefined()
  })

  it('returns undefined when the _git marker is missing', () => {
    expect(parseAzureDevOpsRemoteUrl('https://dev.azure.com/myorg/myproject/myrepo')).toBeUndefined()
  })
})

describe('splitAzureDevOpsPath', () => {
  it('splits the flattened org/project/repo path back into a project', () => {
    expect(splitAzureDevOpsPath('myorg/myproject/myrepo', 'dev.azure.com')).toEqual({
      org: 'myorg',
      project: 'myproject',
      repo: 'myrepo',
      owner: 'myorg/myproject',
      name: 'myrepo',
      path: 'myorg/myproject/myrepo',
      host: 'dev.azure.com',
    })
  })

  it('returns undefined for fewer than 3 segments', () => {
    expect(splitAzureDevOpsPath('myorg/myrepo', 'dev.azure.com')).toBeUndefined()
  })
})

describe('buildAzureDevOpsRepoWebUrl', () => {
  it('builds the dev.azure.com form', () => {
    expect(
      buildAzureDevOpsRepoWebUrl({
        org: 'myorg',
        project: 'myproject',
        repo: 'myrepo',
        owner: 'myorg/myproject',
        name: 'myrepo',
        path: 'myorg/myproject/myrepo',
        host: 'dev.azure.com',
      })
    ).toBe('https://dev.azure.com/myorg/myproject/_git/myrepo')
  })

  it('normalizes ssh.dev.azure.com to the dev.azure.com web host', () => {
    expect(
      buildAzureDevOpsRepoWebUrl({
        org: 'myorg',
        project: 'myproject',
        repo: 'myrepo',
        owner: 'myorg/myproject',
        name: 'myrepo',
        path: 'myorg/myproject/myrepo',
        host: 'ssh.dev.azure.com',
      })
    ).toBe('https://dev.azure.com/myorg/myproject/_git/myrepo')
  })

  it('builds the visualstudio.com form without an org path segment', () => {
    expect(
      buildAzureDevOpsRepoWebUrl({
        org: 'myorg',
        project: 'myproject',
        repo: 'myrepo',
        owner: 'myorg/myproject',
        name: 'myrepo',
        path: 'myorg/myproject/myrepo',
        host: 'myorg.visualstudio.com',
      })
    ).toBe('https://myorg.visualstudio.com/myproject/_git/myrepo')
  })
})

describe('getAzureDevOpsProject', () => {
  it('parses org/project/repo from an HTTPS remote', async () => {
    const git = fakeGit([
      { name: 'origin', refs: { fetch: 'https://dev.azure.com/myorg/myproject/_git/myrepo' } },
    ])
    expect(await getAzureDevOpsProject(git)).toEqual({
      org: 'myorg',
      project: 'myproject',
      repo: 'myrepo',
      owner: 'myorg/myproject',
      name: 'myrepo',
      path: 'myorg/myproject/myrepo',
      host: 'dev.azure.com',
    })
  })

  it('returns undefined when there is no remote', async () => {
    expect(await getAzureDevOpsProject(fakeGit([]))).toBeUndefined()
  })
})

describe('makeAzureDevOpsRunner auth header (#1617)', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it(
    'sends the PAT as HTTP Basic (base64(":" + token)), not a bearer/token scheme',
    withEnv({ AZURE_DEVOPS_TOKEN: 'my-pat' }, async () => {
      let capturedHeaders: Record<string, string> | undefined
      global.fetch = (async (_url: string, init?: RequestInit) => {
        capturedHeaders = init?.headers as Record<string, string>
        return { ok: true, text: async () => '{}' } as Response
      }) as typeof fetch

      const runner = makeAzureDevOpsRunner('dev.azure.com', 'myorg', 'myproject')
      await runner('git/repositories')

      const expected = `Basic ${Buffer.from(':my-pat').toString('base64')}`
      expect(capturedHeaders?.Authorization).toBe(expected)
    })
  )

  it(
    'builds the org/project-scoped base URL and appends api-version',
    withEnv({ AZURE_DEVOPS_TOKEN: 'tok' }, async () => {
      let capturedUrl: string | undefined
      global.fetch = (async (url: string) => {
        capturedUrl = url
        return { ok: true, text: async () => '{}' } as Response
      }) as typeof fetch

      const runner = makeAzureDevOpsRunner('dev.azure.com', 'myorg', 'myproject')
      await runner('git/repositories')

      expect(capturedUrl).toBe('https://dev.azure.com/myorg/myproject/_apis/git/repositories?api-version=7.1')
    })
  )

  it(
    'omits the org segment for a visualstudio.com host',
    withEnv({ AZURE_DEVOPS_TOKEN: 'tok' }, async () => {
      let capturedUrl: string | undefined
      global.fetch = (async (url: string) => {
        capturedUrl = url
        return { ok: true, text: async () => '{}' } as Response
      }) as typeof fetch

      const runner = makeAzureDevOpsRunner('myorg.visualstudio.com', 'myorg', 'myproject')
      await runner('git/repositories')

      expect(capturedUrl).toBe('https://myorg.visualstudio.com/myproject/_apis/git/repositories?api-version=7.1')
    })
  )

  it(
    'normalizes ssh.dev.azure.com to dev.azure.com for API calls',
    withEnv({ AZURE_DEVOPS_TOKEN: 'tok' }, async () => {
      let capturedUrl: string | undefined
      global.fetch = (async (url: string) => {
        capturedUrl = url
        return { ok: true, text: async () => '{}' } as Response
      }) as typeof fetch

      const runner = makeAzureDevOpsRunner('ssh.dev.azure.com', 'myorg', 'myproject')
      await runner('git/repositories')

      expect(capturedUrl).toBe('https://dev.azure.com/myorg/myproject/_apis/git/repositories?api-version=7.1')
    })
  )
})

describe('getAzureDevOpsStatus (#1617)', () => {
  it(
    'returns not-authenticated when AZURE_DEVOPS_TOKEN is unset',
    withEnv({ AZURE_DEVOPS_TOKEN: undefined }, async () => {
      const status = await getAzureDevOpsStatus(async () => '')
      expect(status.kind).toBe('not-authenticated')
    })
  )

  it(
    'returns ok when the probe succeeds',
    withEnv({ AZURE_DEVOPS_TOKEN: 'tok' }, async () => {
      const status = await getAzureDevOpsStatus(async () => '{"value":[]}')
      expect(status.kind).toBe('ok')
    })
  )

  it(
    'returns not-authenticated on 401',
    withEnv({ AZURE_DEVOPS_TOKEN: 'bad' }, async () => {
      const err = Object.assign(new Error('Unauthorized'), { status: 401 })
      const status = await getAzureDevOpsStatus(throwingRunner(err))
      expect(status.kind).toBe('not-authenticated')
    })
  )

  it(
    'returns unknown on network error',
    withEnv({ AZURE_DEVOPS_TOKEN: 'tok' }, async () => {
      const status = await getAzureDevOpsStatus(throwingRunner(new Error('ECONNREFUSED')))
      expect(status.kind).toBe('unknown')
    })
  )

  it(
    'isAzureDevOpsAuthenticated reflects ok',
    withEnv({ AZURE_DEVOPS_TOKEN: 'tok' }, async () => {
      expect(await isAzureDevOpsAuthenticated(async () => '{}')).toBe(true)
    })
  )
})

describe('describeAzureDevOpsStatus', () => {
  it('names AZURE_DEVOPS_TOKEN in the not-authenticated hint', () => {
    expect(describeAzureDevOpsStatus({ kind: 'not-authenticated' })).toContain('AZURE_DEVOPS_TOKEN')
  })

  it('confirms ok', () => {
    expect(describeAzureDevOpsStatus({ kind: 'ok' })).toContain('authenticated')
  })
})

describe('compactAzureDevOpsError', () => {
  it('uses the first line as the message', () => {
    const result = compactAzureDevOpsError('line1\nline2\nline3')
    expect(result.message).toBe('line1')
    expect(result.details).toEqual(['line2', 'line3'])
  })
})

describe('resolveAzureDevOpsActionError', () => {
  it(
    'returns the recovery hint when auth is broken',
    withEnv({ AZURE_DEVOPS_TOKEN: undefined }, async () => {
      const result = await resolveAzureDevOpsActionError(new Error('failed'), async () => '')
      expect(result.message).toContain('AZURE_DEVOPS_TOKEN')
    })
  )
})

describe('runAzureDevOpsAction', () => {
  it('returns the success result on a clean call', async () => {
    const result = await runAzureDevOpsAction(async () => '{"id":1}', 'endpoint', 'POST', { a: 1 }, (out) => ({
      ok: true,
      message: `got ${out}`,
    }))
    expect(result).toEqual({ ok: true, message: 'got {"id":1}' })
  })

  it(
    'compacts a thrown error into a graceful failure, re-probing auth on the error path',
    withEnv({ AZURE_DEVOPS_TOKEN: 'tok' }, async () => {
      // First call is the mutating action itself (fails); the second is the
      // error-path auth re-probe `runAzureDevOpsAction` issues via
      // `resolveAzureDevOpsActionError` — succeeding there means the raw
      // error gets compacted rather than replaced with an auth hint.
      let call = 0
      const runner = async () => {
        call += 1
        if (call === 1) throw new Error('boom')
        return '{"value":[]}'
      }
      const result = await runAzureDevOpsAction(runner, 'endpoint', 'POST', undefined, () => ({
        ok: true,
        message: 'unreachable',
      }))
      expect(result.ok).toBe(false)
      expect(result.message).toBe('boom')
    })
  )
})

describe('resolveAzureDevOpsSelfIdentity', () => {
  it('resolves id + uniqueName from vssps profiles/me', async () => {
    const identity = await resolveAzureDevOpsSelfIdentity('myorg', async (endpoint) => {
      expect(endpoint).toBe('https://vssps.dev.azure.com/myorg/_apis/profile/profiles/me')
      return JSON.stringify({ id: 'guid-123', emailAddress: 'me@example.com' })
    })
    expect(identity).toEqual({ id: 'guid-123', uniqueName: 'me@example.com' })
  })

  it('returns undefined on failure', async () => {
    expect(await resolveAzureDevOpsSelfIdentity('myorg', throwingRunner(new Error('boom')))).toBeUndefined()
  })
})
