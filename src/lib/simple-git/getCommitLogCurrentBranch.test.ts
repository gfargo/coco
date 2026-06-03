import {
  addCommit,
  chain,
  checkoutBranch,
  createTempGitRepo,
  detachedHeadScenario,
  midBisectScenario,
  startRebase,
  switchToBranch,
  type TempGitRepo,
} from '@gfargo/git-scenarios'

import { Logger } from '../utils/logger'
import { getCommitLogCurrentBranch } from './getCommitLogCurrentBranch'

function createLogger() {
  return {
    log: jest.fn(),
    verbose: jest.fn(),
    setConfig: jest.fn(),
    startTimer: jest.fn().mockReturnThis(),
    stopTimer: jest.fn().mockReturnThis(),
    startSpinner: jest.fn().mockReturnThis(),
    stopSpinner: jest.fn().mockReturnThis(),
  } as unknown as Logger & { log: jest.Mock; verbose: jest.Mock }
}

function getLogCalls(logger: ReturnType<typeof createLogger>): string[] {
  return (logger.log as jest.Mock).mock.calls.map(([message]) => String(message))
}

describe('getCommitLogCurrentBranch — edge states', () => {
  // The mid-bisect fixture is the heaviest in the suite: it builds 20
  // sequential commits (~40+ git subprocesses, serialized by simple-git's
  // own queue) and runs `git bisect start`. Uncontended that's ~14s; under
  // the full parallel suite (jest spreads workers all forking git at once)
  // CPU/IO contention pushed it past the old 20s budget and jest aborted
  // with a timeout — the one true parallel-only flake in the suite (no
  // assertion ever fails; temp dirs are already unique per test). 60s gives
  // ample headroom under load without serializing anything.
  jest.setTimeout(60000)

  let repo: TempGitRepo

  beforeEach(async () => {
    repo = await createTempGitRepo()
  })

  afterEach(async () => {
    await repo.cleanup()
  })

  // #1 — Detached HEAD. `git rev-parse --abbrev-ref HEAD` returns the
  // literal string 'HEAD', so we have no branch context to compare
  // against. The previous behavior was a yellow "Unable to determine
  // first and last commit" line that read like a failure; the helper
  // should report this as a state, not an error.
  it('detached HEAD — logs a clean status, returns []', async () => {
    await detachedHeadScenario.setup(repo)
    const logger = createLogger()

    const result = await getCommitLogCurrentBranch({ git: repo.git, logger })

    expect(result).toEqual([])
    const lines = getLogCalls(logger)
    expect(lines.join('\n')).toMatch(/HEAD is detached/i)
    expect(lines.join('\n')).not.toMatch(/Encountered an error/i)
    expect(lines.join('\n')).not.toMatch(/Unable to determine/i)
  })

  // #2 — Mid-rebase with unresolved conflicts. During a rebase, git
  // detaches HEAD onto the rewritten commit. Same handling as detached
  // HEAD applies.
  it('mid-rebase with conflicts — logs a clean status, returns []', async () => {
    await chain(
      addCommit({ message: 'chore: initial', files: { 'x.ts': 'base\n' } }),
      switchToBranch('feat/x'),
      addCommit({ message: 'feat: theirs', files: { 'x.ts': 'theirs\n' } }),
      checkoutBranch('main'),
      addCommit({ message: 'feat: ours', files: { 'x.ts': 'ours\n' } }),
      checkoutBranch('feat/x'),
      startRebase('main'),
    )(repo)

    const logger = createLogger()
    const result = await getCommitLogCurrentBranch({ git: repo.git, logger })

    expect(result).toEqual([])
    const joined = getLogCalls(logger).join('\n')
    expect(joined).toMatch(/HEAD is detached|rebase|bisect/i)
    expect(joined).not.toMatch(/Encountered an error/i)
  })

  // #3 — Mid-bisect: HEAD is detached at the midpoint candidate.
  it('mid-bisect — logs a clean status, returns []', async () => {
    await midBisectScenario.setup(repo)
    const logger = createLogger()

    const result = await getCommitLogCurrentBranch({ git: repo.git, logger })

    expect(result).toEqual([])
    const joined = getLogCalls(logger).join('\n')
    expect(joined).toMatch(/HEAD is detached|rebase|bisect/i)
    expect(joined).not.toMatch(/Encountered an error/i)
  })

  // #4 — No origin configured. The same-branch path tries to compare
  // against `origin/main`; if that ref doesn't resolve, the previous
  // catch-all printed a red "Encountered an error" banner.
  it('no origin remote — logs a clean status, returns []', async () => {
    await chain(
      addCommit({ message: 'chore: initial', files: { 'README.md': '# repo\n' } }),
      addCommit({ message: 'feat: a', files: { 'src/a.ts': 'a\n' } }),
    )(repo)

    const logger = createLogger()
    // Default comparisonBranch === 'main' === current branch, and
    // there's no `origin` remote in the temp repo, so `origin/main`
    // does not resolve.
    const result = await getCommitLogCurrentBranch({ git: repo.git, logger })

    expect(result).toEqual([])
    const joined = getLogCalls(logger).join('\n')
    expect(joined).toMatch(/origin\/main/)
    expect(joined).not.toMatch(/Encountered an error/i)
  })

  // Comparison branch missing entirely (different from current). The
  // helper should surface the missing branch cleanly rather than
  // throwing into the red catch block.
  it('comparison branch does not exist — logs a clean status, returns []', async () => {
    await chain(
      addCommit({ message: 'chore: initial', files: { 'README.md': '# repo\n' } }),
      switchToBranch('feat/x'),
      addCommit({ message: 'feat: a', files: { 'src/a.ts': 'a\n' } }),
    )(repo)

    const logger = createLogger()
    const result = await getCommitLogCurrentBranch({
      git: repo.git,
      logger,
      comparisonBranch: 'develop',
    })

    expect(result).toEqual([])
    const joined = getLogCalls(logger).join('\n')
    expect(joined).toMatch(/develop/)
    expect(joined).not.toMatch(/Encountered an error/i)
  })

  // Happy path: feature branch with commits ahead of main. Sanity
  // check that the edge-state probes haven't broken the common case.
  it('happy path — returns commits ahead of comparison branch', async () => {
    await chain(
      addCommit({ message: 'chore: initial', files: { 'README.md': '# repo\n' } }),
      switchToBranch('feat/x'),
      addCommit({ message: 'feat: a', files: { 'src/a.ts': 'a\n' } }),
      addCommit({ message: 'feat: b', files: { 'src/b.ts': 'b\n' } }),
    )(repo)

    const logger = createLogger()
    const result = await getCommitLogCurrentBranch({ git: repo.git, logger })

    expect(result.length).toBe(2)
    // git log default ordering is newest first.
    expect(result.map((c) => c.message)).toEqual(['feat: b', 'feat: a'])
    expect(getLogCalls(logger).join('\n')).not.toMatch(/Encountered an error/i)
  })

  // Same-branch path with a configured remote-tracking ref: should
  // succeed using `origin/main` as the comparison ref. We fake the
  // remote by pointing it at a separate local repo so origin/main
  // resolves.
  it('same-branch path resolves against origin/main when present', async () => {
    // Build a "remote" repo with one commit on main.
    const remote = await createTempGitRepo()
    try {
      await chain(
        addCommit({ message: 'chore: initial', files: { 'README.md': '# remote\n' } }),
      )(remote)

      // Local repo mirrors the remote so origin/main resolves, then
      // pushes ahead by one commit on main.
      await repo.git.addRemote('origin', remote.path)
      await repo.git.fetch('origin')
      await repo.git.checkout(['-B', 'main', 'origin/main'])
      await chain(
        addCommit({ message: 'feat: local-ahead', files: { 'src/a.ts': 'a\n' } }),
      )(repo)

      const logger = createLogger()
      const result = await getCommitLogCurrentBranch({ git: repo.git, logger })

      expect(result.map((c) => c.message)).toEqual(['feat: local-ahead'])
      expect(getLogCalls(logger).join('\n')).not.toMatch(/Encountered an error/i)
    } finally {
      await remote.cleanup()
    }
  })
})
