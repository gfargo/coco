import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  extractOriginUrl,
  getWorkspacePullRequestCounts,
  parseOpenPullRequestCount,
  readOriginRemoteUrl,
  runGhWithTimeout,
} from './workspacePullRequestData'

describe('workspacePullRequestData parsers', () => {
  it('extracts the origin URL from a git config block', () => {
    const config = `
[core]
	repositoryformatversion = 0
[remote "upstream"]
	url = git@github.com:other/repo.git
[remote "origin"]
	url = git@github.com:gfargo/coco.git
	fetch = +refs/heads/*:refs/remotes/origin/*
`
    expect(extractOriginUrl(config)).toBe('git@github.com:gfargo/coco.git')
  })

  it('returns undefined when no origin remote is configured', () => {
    expect(extractOriginUrl('[core]\nrepositoryformatversion = 0\n')).toBeUndefined()
  })

  it('counts JSON-encoded PR arrays', () => {
    expect(parseOpenPullRequestCount('[]')).toBe(0)
    expect(parseOpenPullRequestCount('[{"number":1},{"number":2}]')).toBe(2)
    expect(parseOpenPullRequestCount('not json')).toBeUndefined()
  })

  it('reads the origin remote from .git/config', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-pr-data-'))
    try {
      fs.mkdirSync(path.join(tmp, '.git'), { recursive: true })
      fs.writeFileSync(
        path.join(tmp, '.git', 'config'),
        '[remote "origin"]\n\turl = https://github.com/gfargo/coco\n'
      )
      expect(readOriginRemoteUrl(tmp)).toBe('https://github.com/gfargo/coco')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('getWorkspacePullRequestCounts', () => {
  it('returns authenticated:false when gh auth status fails', async () => {
    // Provide a GitHub remote so a host probe is issued. The probe throws
    // (gh not authenticated), and the result should be authenticated:false.
    const remoteUrls = new Map<string, string>([
      ['/tmp/a', 'git@github.com:owner/repo-a.git'],
    ])
    const runner = jest.fn(async (args: string[]) => {
      if (args[0] === 'auth') throw new Error('not logged in')
      return ''
    })

    const result = await getWorkspacePullRequestCounts(['/tmp/a'], {
      ghRunner: runner,
      remoteUrls,
    })

    expect(result).toEqual({ authenticated: false, counts: {} })
    // Only the auth probe should have been issued (no pr list calls).
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('drops the badge when gh blows past the per-call timeout', async () => {
    const remoteUrls = new Map<string, string>([
      ['/tmp/repo-slow', 'git@github.com:owner/repo-slow.git'],
    ])
    const runner = jest.fn(async (args: string[], opts?: { signal?: AbortSignal }) => {
      if (args[0] === 'auth') return 'ok'
      if (args[0] === 'pr') {
        // Hang until aborted.
        return new Promise<string>((_, reject) => {
          opts?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
      }
      return ''
    })

    const result = await getWorkspacePullRequestCounts(['/tmp/repo-slow'], {
      ghRunner: runner,
      remoteUrls,
      timeoutMs: 25,
    })

    expect(result.authenticated).toBe(true)
    expect(result.counts).toEqual({})
    // Auth probe + pr list both went out.
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it('runGhWithTimeout aborts the signal and resolves undefined on timeout', async () => {
    const runner = jest.fn(async (_args: string[], opts?: { signal?: AbortSignal }) => {
      return new Promise<string>((_, reject) => {
        opts?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    })

    const result = await runGhWithTimeout(runner, ['pr', 'list'], 20)
    expect(result).toBeUndefined()
    expect(runner).toHaveBeenCalled()
  })

  it('runGhWithTimeout returns the stdout when the call finishes before the deadline', async () => {
    const runner = jest.fn(async () => '[]')
    const result = await runGhWithTimeout(runner, ['pr', 'list'], 5000)
    expect(result).toBe('[]')
  })

  it('runGhWithTimeout swallows a post-abort runner rejection', async () => {
    // After timeout aborts the signal, the runner may still reject
    // with the abort reason. That late rejection must not surface as
    // an unhandled rejection — the helper's `try { … } catch {}`
    // should absorb it and the overall result stays `undefined`.
    let abortReject!: () => void
    const runner = jest.fn(async (_args: string[], opts?: { signal?: AbortSignal }) => {
      return new Promise<string>((_, reject) => {
        abortReject = () => reject(new Error('AbortError'))
        opts?.signal?.addEventListener('abort', abortReject)
      })
    })
    const result = await runGhWithTimeout(runner, ['pr', 'list'], 10)
    expect(result).toBeUndefined()
    // Now imagine the runner's promise was still pending when the
    // timeout fired — give it one more microtask to reject and
    // ensure nothing else throws.
    await new Promise((resolve) => setImmediate(resolve))
  })

  it('issues one gh pr list per repo with a GitHub remote and records the count', async () => {
    const remoteUrls = new Map<string, string>([
      ['/tmp/repo-a', 'git@github.com:owner/repo-a.git'],
      ['/tmp/repo-b', 'https://github.com/owner/repo-b'],
      ['/tmp/repo-c', 'git@gitlab.com:owner/repo-c.git'],
    ])

    const runner = jest.fn(async (args: string[]) => {
      if (args[0] === 'auth') return 'ok'
      if (args[0] === 'pr') {
        const repoArg = args[args.indexOf('-R') + 1]
        if (repoArg === 'owner/repo-a') return '[{"number":1},{"number":2}]'
        if (repoArg === 'owner/repo-b') return '[]'
        throw new Error('repo not found')
      }
      return ''
    })

    const result = await getWorkspacePullRequestCounts(
      ['/tmp/repo-a', '/tmp/repo-b', '/tmp/repo-c'],
      { ghRunner: runner, remoteUrls }
    )

    expect(result.authenticated).toBe(true)
    expect(result.counts).toEqual({
      '/tmp/repo-a': 2,
      '/tmp/repo-b': 0,
    })
  })

  it('fetches PR counts for a GitHub Enterprise repo using the full webUrl as -R arg', async () => {
    const remoteUrls = new Map<string, string>([
      ['/tmp/ghe-repo', 'git@github.acme.com:owner/ghe-repo.git'],
    ])

    const runner = jest.fn(async (args: string[]) => {
      if (args[0] === 'auth') {
        // Only the GHE hostname probe should be issued
        const hostnameIdx = args.indexOf('--hostname')
        if (hostnameIdx !== -1 && args[hostnameIdx + 1] === 'github.acme.com') return 'ok'
        throw new Error('not logged in')
      }
      if (args[0] === 'pr') {
        const repoArg = args[args.indexOf('-R') + 1]
        if (repoArg === 'https://github.acme.com/owner/ghe-repo') {
          return '[{"number":10},{"number":11},{"number":12}]'
        }
        throw new Error('unexpected -R arg: ' + repoArg)
      }
      return ''
    })

    const result = await getWorkspacePullRequestCounts(['/tmp/ghe-repo'], {
      ghRunner: runner,
      remoteUrls,
    })

    expect(result.authenticated).toBe(true)
    expect(result.counts).toEqual({ '/tmp/ghe-repo': 3 })
    // Confirm the -R arg was the full GHE URL, not a bare owner/name slug
    const prCall = runner.mock.calls.find((c) => c[0][0] === 'pr')
    expect(prCall).toBeDefined()
    const repoArg = prCall![0][indexAfterRepoFlag(prCall![0])]
    expect(repoArg).toBe('https://github.acme.com/owner/ghe-repo')
  })

  it('handles a mixed workspace: github.com authenticated, GHE unauthenticated', async () => {
    const remoteUrls = new Map<string, string>([
      ['/tmp/gh-repo', 'git@github.com:owner/gh-repo.git'],
      ['/tmp/ghe-repo', 'git@github.acme.com:owner/ghe-repo.git'],
    ])

    const runner = jest.fn(async (args: string[]) => {
      if (args[0] === 'auth') {
        const hostnameIdx = args.indexOf('--hostname')
        const host = hostnameIdx !== -1 ? args[hostnameIdx + 1] : 'github.com'
        if (host === 'github.com') return 'ok'
        throw new Error('not logged in to ' + host)
      }
      if (args[0] === 'pr') {
        const repoArg = args[args.indexOf('-R') + 1]
        if (repoArg === 'owner/gh-repo') return '[{"number":1}]'
        throw new Error('unexpected call for unauthenticated host')
      }
      return ''
    })

    const result = await getWorkspacePullRequestCounts(
      ['/tmp/gh-repo', '/tmp/ghe-repo'],
      { ghRunner: runner, remoteUrls }
    )

    // Overall authenticated = true because github.com is authenticated
    expect(result.authenticated).toBe(true)
    // github.com count present, GHE count absent
    expect(result.counts).toEqual({ '/tmp/gh-repo': 1 })
    // GHE pr list was not called (host unauthenticated)
    const prCalls = runner.mock.calls.filter((c) => c[0][0] === 'pr')
    expect(prCalls).toHaveLength(1)
    expect(prCalls[0][0][prCalls[0][0].indexOf('-R') + 1]).toBe('owner/gh-repo')
  })

  it('an all-GitLab workspace takes `authenticated` from the forge, not from gh', async () => {
    const remoteUrls = new Map<string, string>([['/tmp/gl', 'git@gitlab.com:owner/repo.git']])
    const runner = jest.fn<Promise<string>, [string[]]>(async () => 'ok')
    const onRepoComplete = jest.fn()

    const signedIn = await getWorkspacePullRequestCounts(['/tmp/gl'], {
      ghRunner: runner,
      remoteUrls,
      onRepoComplete,
      forgeList: async () => ({ available: true, authenticated: true, pullRequests: [] }),
    })
    expect(signedIn).toEqual({ authenticated: true, counts: { '/tmp/gl': 0 } })
    // gh is never consulted: no auth probe and no `pr list`.
    expect(runner).not.toHaveBeenCalled()
    expect(onRepoComplete).toHaveBeenCalledWith('/tmp/gl', 0)

    const signedOut = await getWorkspacePullRequestCounts(['/tmp/gl'], {
      ghRunner: runner,
      remoteUrls,
      forgeList: async () => ({ available: true, authenticated: false }),
    })
    expect(signedOut).toEqual({ authenticated: false, counts: {} })
  })

  it('probes github.com for a workspace whose remotes no forge recognises', async () => {
    const remoteUrls = new Map<string, string>([['/tmp/x', 'git@example.org:owner/repo.git']])
    const authed = jest.fn(async (args: string[]) => (args[0] === 'auth' ? 'ok' : ''))
    const result = await getWorkspacePullRequestCounts(['/tmp/x'], { ghRunner: authed, remoteUrls })
    expect(result).toEqual({ authenticated: true, counts: {} })
  })

  it('reports non-GitHub repos before the GitHub fetch batch settles', async () => {
    // A non-GitHub row's onRepoComplete must not wait on the GitHub
    // fan-out — the UI clears that row's spinner the moment it fires.
    const remoteUrls = new Map<string, string>([
      ['/tmp/gl', 'git@gitlab.com:owner/repo.git'],
      ['/tmp/gh', 'git@github.com:owner/repo.git'],
    ])
    const order: string[] = []
    let releasePrList!: (value: string) => void
    const prListGate = new Promise<string>((resolve) => {
      releasePrList = resolve
    })

    const runner = jest.fn(async (args: string[]) => {
      if (args[0] === 'auth') return 'ok'
      if (args[0] === 'pr') return prListGate
      return ''
    })

    const resultPromise = getWorkspacePullRequestCounts(['/tmp/gl', '/tmp/gh'], {
      ghRunner: runner,
      remoteUrls,
      forgeList: async () => ({ available: true, authenticated: true, pullRequests: [] }),
      onRepoComplete: (repoPath) => order.push(repoPath),
    })

    // Give the classification + non-GitHub callback a chance to run
    // while the GitHub `pr list` call is still hung on the gate.
    await new Promise((resolve) => setImmediate(resolve))
    expect(order).toEqual(['/tmp/gl'])

    releasePrList('[]')
    await resultPromise
    expect(order).toEqual(['/tmp/gl', '/tmp/gh'])
  })
})

describe('non-GitHub forges count through the adapter (#2211)', () => {
  const pr = (number: number) => ({ number }) as never

  it('counts GitLab, Bitbucket and Gitea repos from their provider list, never calling gh pr list', async () => {
    const remoteUrls = new Map<string, string>([
      ['/w/gl', 'git@gitlab.com:team/api.git'],
      ['/w/bb', 'git@bitbucket.org:team/web.git'],
      ['/w/gt', 'https://gitea.example.com/team/tool.git'],
    ])
    const forgeList = jest.fn(async (provider: string) => ({
      available: true,
      authenticated: true,
      pullRequests: provider === 'gitlab' ? [pr(1), pr(2)] : [pr(7)],
    }))
    const runner = jest.fn<Promise<string>, [string[]]>(async () => '')
    const result = await getWorkspacePullRequestCounts(['/w/gl', '/w/bb', '/w/gt'], {
      ghRunner: runner,
      remoteUrls,
      forgeList,
    })
    expect(forgeList.mock.calls.map((call) => call[0]).sort()).toEqual(['bitbucket', 'gitea', 'gitlab'])
    expect(result).toEqual({
      authenticated: true,
      counts: { '/w/gl': 2, '/w/bb': 1, '/w/gt': 1 },
    })
    expect(runner.mock.calls.some((call) => call[0][0] === 'pr')).toBe(false)
  })

  it('leaves a repo without a count when its forge is unavailable, unauthenticated, or throws', async () => {
    const remoteUrls = new Map<string, string>([
      ['/w/a', 'git@gitlab.com:team/a.git'],
      ['/w/b', 'git@gitlab.com:team/b.git'],
      ['/w/c', 'git@gitlab.com:team/c.git'],
    ])
    const forgeList = jest.fn(async (_provider: string, _repo: unknown, repoPath: string) => {
      if (repoPath === '/w/c') throw new Error('boom')
      return repoPath === '/w/a'
        ? { available: true, authenticated: false }
        : { available: false, authenticated: false }
    })
    const onRepoComplete = jest.fn()
    const result = await getWorkspacePullRequestCounts(['/w/a', '/w/b', '/w/c'], {
      ghRunner: async () => '',
      remoteUrls,
      forgeList,
      onRepoComplete,
    })
    expect(result.counts).toEqual({})
    expect(onRepoComplete).toHaveBeenCalledTimes(3)
  })

  it('reports authenticated when only the GitHub side is signed out but a forge answered', async () => {
    const remoteUrls = new Map<string, string>([
      ['/w/gh', 'git@github.com:o/r.git'],
      ['/w/gl', 'git@gitlab.com:team/a.git'],
    ])
    const denied = async (args: string[]) => {
      if (args[0] === 'auth') throw new Error('not logged in')
      return ''
    }
    const result = await getWorkspacePullRequestCounts(['/w/gh', '/w/gl'], {
      ghRunner: denied,
      remoteUrls,
      forgeList: async () => ({ available: true, authenticated: true, pullRequests: [pr(1)] }),
    })
    expect(result).toEqual({ authenticated: true, counts: { '/w/gl': 1 } })
  })
})

/** Helper: find the index after -R in an args array. */
function indexAfterRepoFlag(args: string[]): number {
  return args.indexOf('-R') + 1
}

describe('readOriginRemoteUrl finds remotes behind .git pointer files (#2210)', () => {
  let root: string
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-pr-remote-')) })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })

  it('reads a plain repo, as before', () => {
    const repo = path.join(root, 'plain')
    fs.mkdirSync(repo)
    git(repo, 'init', '-q')
    git(repo, 'remote', 'add', 'origin', 'https://github.com/o/plain.git')
    expect(readOriginRemoteUrl(repo)).toBe('https://github.com/o/plain.git')
  })

  it('reads the main repo\'s origin for a linked worktree', () => {
    const main = path.join(root, 'main')
    fs.mkdirSync(main)
    git(main, 'init', '-q', '-b', 'main')
    git(main, 'config', 'user.email', 't@example.com')
    git(main, 'config', 'user.name', 't')
    fs.writeFileSync(path.join(main, 'a.txt'), 'a\n')
    git(main, 'add', '.')
    git(main, 'commit', '-q', '-m', 'init')
    git(main, 'remote', 'add', 'origin', 'https://github.com/o/main.git')
    const wt = path.join(root, 'wt')
    git(main, 'worktree', 'add', '-q', '-b', 'feature', wt)
    // `.git` in the worktree is a pointer FILE, so the old lookup found nothing.
    expect(fs.statSync(path.join(wt, '.git')).isFile()).toBe(true)
    expect(readOriginRemoteUrl(wt)).toBe('https://github.com/o/main.git')
  })

  it('reads the submodule\'s own config through its gitdir pointer', () => {
    const sub = path.join(root, 'super', 'libs', 'dep')
    const modules = path.join(root, 'super', '.git', 'modules', 'dep')
    fs.mkdirSync(sub, { recursive: true })
    fs.mkdirSync(modules, { recursive: true })
    fs.writeFileSync(path.join(sub, '.git'), 'gitdir: ../../.git/modules/dep\n')
    fs.writeFileSync(path.join(modules, 'config'), '[remote "origin"]\n\turl = https://github.com/o/dep.git\n')
    expect(readOriginRemoteUrl(sub)).toBe('https://github.com/o/dep.git')
  })

  it('returns undefined for a malformed pointer file instead of throwing', () => {
    const repo = path.join(root, 'odd')
    fs.mkdirSync(repo)
    fs.writeFileSync(path.join(repo, '.git'), 'not a pointer\n')
    expect(readOriginRemoteUrl(repo)).toBeUndefined()
  })
})
