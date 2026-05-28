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
    const runner = jest.fn(async (args: string[]) => {
      if (args[0] === 'auth') throw new Error('not logged in')
      return ''
    })

    const result = await getWorkspacePullRequestCounts(['/tmp/a'], { ghRunner: runner })

    expect(result).toEqual({ authenticated: false, counts: {} })
    // Only the auth probe should have been issued.
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
})
