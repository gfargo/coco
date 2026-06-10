import { SimpleGit } from 'simple-git'
import {
  describeGlabStatus,
  getGitLabProject,
  getGlabStatus,
  isGlabAuthenticated,
  resolveGlabActionError,
} from './glabCli'

function throwingRunner(error: unknown) {
  return async () => {
    throw error
  }
}

describe('getGlabStatus (#0.70)', () => {
  it('reports ok when `glab auth status` succeeds', async () => {
    const calls: string[][] = []
    const runner = async (args: string[]) => {
      calls.push(args)
      return ''
    }
    expect(await getGlabStatus(runner)).toEqual({ kind: 'ok' })
    expect(calls[0]).toEqual(['auth', 'status'])
  })

  it('scopes the probe to a hostname when given', async () => {
    const calls: string[][] = []
    const runner = async (args: string[]) => {
      calls.push(args)
      return ''
    }
    await getGlabStatus(runner, 'gitlab.acme.com')
    expect(calls[0]).toEqual(['auth', 'status', '--hostname', 'gitlab.acme.com'])
  })

  it('classifies a missing binary as not-installed', async () => {
    const err = Object.assign(new Error('spawn glab ENOENT'), { code: 'ENOENT' })
    expect(await getGlabStatus(throwingRunner(err))).toEqual({ kind: 'not-installed' })
  })

  it('classifies a missing token as not-authenticated', async () => {
    const err = Object.assign(new Error('x'), { stderr: 'not logged in to gitlab.com' })
    const status = await getGlabStatus(throwingRunner(err))
    expect(status.kind).toBe('not-authenticated')
  })

  it('classifies other failures as unknown', async () => {
    const status = await getGlabStatus(throwingRunner(new Error('boom')))
    expect(status.kind).toBe('unknown')
  })

  it('isGlabAuthenticated reflects ok', async () => {
    expect(await isGlabAuthenticated(async () => '')).toBe(true)
    const err = Object.assign(new Error('x'), { code: 'ENOENT' })
    expect(await isGlabAuthenticated(throwingRunner(err))).toBe(false)
  })
})

describe('describeGlabStatus (#0.70)', () => {
  it('names glab and its install/login path', () => {
    expect(describeGlabStatus({ kind: 'not-installed' })).toContain('glab')
    expect(describeGlabStatus({ kind: 'not-authenticated' })).toContain('glab auth login')
    expect(describeGlabStatus({ kind: 'ok' })).toContain('authenticated')
  })
})

describe('resolveGlabActionError (#0.70)', () => {
  it('returns the recovery hint when auth is broken', async () => {
    const authErr = Object.assign(new Error('x'), { code: 'ENOENT' })
    const result = await resolveGlabActionError(new Error('failed'), throwingRunner(authErr))
    expect(result.message).toContain('glab')
  })

  it('compacts the raw error when auth is fine', async () => {
    const result = await resolveGlabActionError(new Error('line1\nline2\nline3'), async () => '')
    expect(result.message).toBe('line1')
    expect(result.details).toEqual(['line2', 'line3'])
  })
})

function fakeGit(remotes: Array<{ name: string; refs: { fetch?: string; push?: string } }>): SimpleGit {
  return { getRemotes: async () => remotes } as unknown as SimpleGit
}

describe('getGitLabProject (#0.70)', () => {
  it('parses owner/name/path from the origin remote', async () => {
    const git = fakeGit([{ name: 'origin', refs: { fetch: 'git@gitlab.com:group/sub/proj.git' } }])
    expect(await getGitLabProject(git)).toEqual({
      owner: 'group/sub',
      name: 'proj',
      path: 'group/sub/proj',
    })
  })

  it('returns undefined when there is no remote', async () => {
    expect(await getGitLabProject(fakeGit([]))).toBeUndefined()
  })
})
