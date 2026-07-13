/**
 * Regression coverage for #1603: `getDiff`'s default-path git.diff() calls
 * built pathspecs without a `--` separator, so a tracked file literally
 * named like a ref (a branch, HEAD, a tag) was resolved as a revision
 * instead of a path — silently diffing the wrong thing.
 *
 * Uses a real temp git repo (unlike `getDiff.test.ts`'s mocked-git unit
 * tests) since the defect is specifically about the argv shape git itself
 * receives, not about getDiff's internal branching logic.
 */
import { createTempGitRepo, type TempGitRepo } from '@gfargo/git-scenarios'
import { getDiff } from './getDiff'
import { Logger } from '../utils/logger'
import { FileChange } from '../types'

// `createTempGitRepo()` spawns several real git subprocesses (init +
// 3x addConfig + checkout) per test. The default 5s jest hook timeout can
// be too tight under parallel test-runner load — sibling real-git-repo
// suites (isEmptyRepo.test.ts, logData.test.ts, reflogActions.integration.test.ts)
// already raise this for the same reason.
jest.setTimeout(30_000)

function createLogger(): Logger {
  return {
    log: jest.fn(),
    verbose: jest.fn(),
    setConfig: jest.fn(),
    startTimer: jest.fn().mockReturnThis(),
    stopTimer: jest.fn().mockReturnThis(),
    startSpinner: jest.fn().mockReturnThis(),
    stopSpinner: jest.fn().mockReturnThis(),
  } as unknown as Logger
}

describe('getDiff — pathspec disambiguation (#1603)', () => {
  let repo: TempGitRepo

  beforeEach(async () => {
    repo = await createTempGitRepo()
  })

  afterEach(async () => {
    await repo.cleanup()
  })

  it('diffs a staged file literally named "main" (the default branch), not main-vs-index', async () => {
    await repo.writeFile('main', 'line one\n')
    await repo.commitAll('chore: add file named main')

    await repo.writeFile('main', 'line one\nline two\n')
    await repo.git.add(['main'])

    const nodeFile: FileChange = {
      summary: 'test',
      filePath: 'main',
      status: 'modified',
    }

    const result = await getDiff(nodeFile, '--staged', { git: repo.git, logger: createLogger() })

    expect(result).toContain('+line two')
  })

  it('diffs a staged file literally named "HEAD", not HEAD-vs-index', async () => {
    await repo.writeFile('HEAD', 'line one\n')
    await repo.commitAll('chore: add file named HEAD')

    await repo.writeFile('HEAD', 'line one\nline two\n')
    await repo.git.add(['HEAD'])

    const nodeFile: FileChange = {
      summary: 'test',
      filePath: 'HEAD',
      status: 'modified',
    }

    const result = await getDiff(nodeFile, '--staged', { git: repo.git, logger: createLogger() })

    expect(result).toContain('+line two')
  })

  it('diffs an unstaged file named like a ref', async () => {
    await repo.writeFile('main', 'line one\n')
    await repo.commitAll('chore: add file named main')

    await repo.writeFile('main', 'line one\nunstaged change\n')

    const nodeFile: FileChange = {
      summary: 'test',
      filePath: 'main',
      status: 'modified',
    }

    const result = await getDiff(nodeFile, '--unstaged', { git: repo.git, logger: createLogger() })

    expect(result).toContain('+unstaged change')
  })
})
