import type { SimpleGit } from 'simple-git'
import {
  pullSkipReason,
  summarizeWorkspaceSync,
  syncWorkspaceRepos,
} from './workspaceSync'
import type { WorkspaceRepoSummary } from './workspaceData'

const repo = (name: string, over: Partial<WorkspaceRepoSummary> = {}): WorkspaceRepoSummary => ({
  path: `/w/${name}`,
  name,
  branch: 'main',
  ahead: 0,
  behind: 0,
  dirty: 0,
  upstream: 'origin/main',
  detached: false,
  ...over,
})

const gitFor = (raw: (args: string[], path: string) => Promise<string>) =>
  (path: string) => ({ raw: (args: string[]) => raw(args, path) }) as unknown as SimpleGit

describe('pullSkipReason (#2211)', () => {
  it('only lets a clean, tracked, behind-only repo through', () => {
    expect(pullSkipReason(repo('a', { behind: 2 }))).toBeUndefined()
    expect(pullSkipReason(repo('a', { behind: 2, dirty: 1 }))).toBe('uncommitted changes')
    expect(pullSkipReason(repo('a', { behind: 2, ahead: 1 }))).toBe('diverged')
    expect(pullSkipReason(repo('a', { upstream: null }))).toBe('no upstream')
    expect(pullSkipReason(repo('a', { detached: true, behind: 1 }))).toBe('detached HEAD')
    expect(pullSkipReason(repo('a', { error: 'x' }))).toBe('unreadable repo')
    expect(pullSkipReason(repo('a'))).toBe('not behind (fetch first)')
  })
})

describe('syncWorkspaceRepos (#2211)', () => {
  it('fetches every repo with bounded concurrency and re-summarizes each', async () => {
    let running = 0
    let peak = 0
    const raw = async () => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running -= 1
      return ''
    }
    const repos = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => repo(n))
    const done: string[] = []
    const outcomes = await syncWorkspaceRepos(
      repos, 'fetch',
      { concurrency: 2, onRepoDone: (outcome, summary) => done.push(`${outcome.name}:${summary?.name}`) },
      { makeGit: gitFor(raw), summarize: async (path) => repo(path.slice(3)) }
    )
    expect(peak).toBe(2)
    expect(outcomes.map((o) => o.status)).toEqual(Array(6).fill('ok'))
    expect(done.sort()).toEqual(['a:a', 'b:b', 'c:c', 'd:d', 'e:e', 'f:f'])
  })

  it('records a failure as an outcome instead of throwing, and keeps going', async () => {
    const raw = async (_args: string[], path: string) => {
      if (path.endsWith('bad')) throw new Error('fatal: could not read from remote\nmore detail')
      return ''
    }
    const outcomes = await syncWorkspaceRepos(
      [repo('bad'), repo('good')], 'fetch', {},
      { makeGit: gitFor(raw), summarize: async () => repo('x') }
    )
    expect(outcomes).toEqual([
      expect.objectContaining({ name: 'bad', status: 'failed', message: expect.stringContaining('could not read from remote') }),
      expect.objectContaining({ name: 'good', status: 'ok' }),
    ])
    expect(outcomes[0].message).not.toContain('more detail')
  })

  it('pull skips unsafe repos without touching git, and uses --ff-only for the rest', async () => {
    const calls: string[][] = []
    const raw = async (args: string[]) => { calls.push(args); return '' }
    const outcomes = await syncWorkspaceRepos(
      [repo('dirty', { dirty: 3, behind: 1 }), repo('ok', { behind: 1 })], 'pull', {},
      { makeGit: gitFor(raw), summarize: async () => repo('ok') }
    )
    expect(outcomes.map((o) => o.status)).toEqual(['skipped', 'ok'])
    expect(calls).toEqual([['pull', '--ff-only']])
  })

  it('stops starting new repos once cancelled', async () => {
    let cancelled = false
    const outcomes = await syncWorkspaceRepos(
      ['a', 'b', 'c'].map((n) => repo(n)), 'fetch',
      { concurrency: 1, isCancelled: () => cancelled, onRepoDone: () => { cancelled = true } },
      { makeGit: gitFor(async () => ''), summarize: async () => repo('x') }
    )
    expect(outcomes).toHaveLength(1)
  })
})

describe('summarizeWorkspaceSync', () => {
  it('names the failures and counts the skips', () => {
    expect(summarizeWorkspaceSync('fetch', [
      { path: '/a', name: 'a', status: 'ok' },
      { path: '/b', name: 'b', status: 'skipped', message: 'x' },
      { path: '/c', name: 'c', status: 'failed', message: 'auth failed' },
    ])).toBe('Fetched 1 repo, 1 skipped, 1 failed: c (auth failed).')
  })
})
