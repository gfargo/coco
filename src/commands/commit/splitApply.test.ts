/**
 * Tests for `applyCommitSplitPlan`'s apply-loop safety properties:
 *
 *   1. A failed group's staged files are RESET before the next group
 *      runs — otherwise the next commit silently absorbs them under
 *      the wrong message.
 *   2. Staged files the plan never saw (filtered out of the planner's
 *      view by ignoredFiles / ignoredExtensions — lockfiles by
 *      default) are re-staged after the loop instead of being
 *      silently dropped from every commit AND from the index.
 *
 * `createCommit` is mocked — these tests drive the loop's git-index
 * choreography, not the commit plumbing (covered by createCommit.test.ts).
 */

import type { FileChange } from '../../lib/types'
import { applyCommitSplitPlan, type CommitSplitPlan } from './split'
import { createCommit, PreCommitHookError } from '../../lib/simple-git/createCommit'
import { Logger } from '../../lib/utils/logger'

jest.mock('../../lib/simple-git/createCommit', () => ({
  createCommit: jest.fn(),
  PreCommitHookError: class PreCommitHookError extends Error {
    hookOutput: string
    constructor(hookOutput: string) {
      super('Pre-commit hook failed')
      this.hookOutput = hookOutput
    }
  },
}))

const mockedCreateCommit = createCommit as jest.MockedFunction<typeof createCommit>

/**
 * Fake `git` recording an ordered op log of the index choreography.
 * HEAD advances only when the `createCommit` mock chose to advance it.
 */
function makeFakeGit(options: { stagedBeforeReset: string[] }) {
  const ops: string[] = []
  let head = 0

  const git = {
    raw: jest.fn(async (args: string[]) => {
      if (args[0] === 'diff' && args.includes('--cached')) {
        ops.push('list-staged')
        return options.stagedBeforeReset.join('\0') + (options.stagedBeforeReset.length ? '\0' : '')
      }
      ops.push(args.join(' '))
      return ''
    }),
    add: jest.fn(async (files: string[]) => {
      ops.push(`stage ${(Array.isArray(files) ? files : [files]).join(',')}`)
      return ''
    }),
    // The staged list must contain the PLANNED files: the apply-time
    // drift check (#1396) verifies every file-mode claim is still
    // staged before the up-front reset, and `files` feeds its per-file
    // worktree-edit probe. A placeholder name here tripped the guard
    // the moment #1381 and #1407 landed together.
    status: jest.fn(async () => ({
      staged: options.stagedBeforeReset,
      created: [],
      renamed: [],
      modified: [],
      deleted: [],
      not_added: [],
      files: [],
    })),
    revparse: jest.fn(async () => `head-${head}`),
    advanceHead: () => {
      head += 1
    },
  }
  return { git, ops }
}

function fileChange(filePath: string): FileChange {
  return { filePath, status: 'modified', summary: `${filePath} changed` }
}

const emptyHunkInventory = {
  hunks: [],
  byId: new Map(),
  byFile: new Map(),
} as never

function makePlan(groups: Array<{ title: string; files: string[] }>): CommitSplitPlan {
  return { groups: groups.map((group) => ({ ...group, body: '' })) } as CommitSplitPlan
}

describe('applyCommitSplitPlan apply-loop safety', () => {
  const logger = new Logger({ silent: true })

  afterEach(() => jest.clearAllMocks())

  it("resets a failed group's staging before the next group commits", async () => {
    const { git, ops } = makeFakeGit({ stagedBeforeReset: ['a.ts', 'b.ts'] })
    // Group A's commit is rejected (hook); group B succeeds.
    mockedCreateCommit
      .mockImplementationOnce(async () => {
        throw new Error('Pre-commit hook failed')
      })
      .mockImplementationOnce(async () => {
        git.advanceHead()
        return {} as never
      })

    const plan = makePlan([
      { title: 'feat: a', files: ['a.ts'] },
      { title: 'feat: b', files: ['b.ts'] },
    ])

    const result = await applyCommitSplitPlan({
      plan,
      changes: { staged: [fileChange('a.ts'), fileChange('b.ts')], unstaged: [], untracked: [] },
      hunkInventory: emptyHunkInventory,
      git: git as never,
      logger,
      noVerify: false,
    })

    // The recovery reset must land between group A's staging and group
    // B's staging — group A's files were left in the index by the
    // failed commit and used to be absorbed into B's commit.
    expect(ops).toEqual([
      'list-staged',
      'reset',
      'stage a.ts',
      'reset',
      'stage b.ts',
    ])
    expect(result.commitHashes).toEqual(['head-1'])
    expect(result.message).toContain('1 of 2')
  })

  it('re-stages staged files the plan never claimed (config-filtered lockfiles)', async () => {
    const { git, ops } = makeFakeGit({
      stagedBeforeReset: ['a.ts', 'yarn.lock'],
    })
    mockedCreateCommit.mockImplementation(async () => {
      git.advanceHead()
      return {} as never
    })

    const plan = makePlan([{ title: 'feat: a', files: ['a.ts'] }])

    const result = await applyCommitSplitPlan({
      plan,
      changes: { staged: [fileChange('a.ts')], unstaged: [], untracked: [] },
      hunkInventory: emptyHunkInventory,
      git: git as never,
      logger,
      noVerify: false,
    })

    expect(ops).toContain('add -- yarn.lock')
    expect(result.message).toContain('re-staged')
  })

  it('does not add a re-stage note when every staged file was planned', async () => {
    const { git, ops } = makeFakeGit({ stagedBeforeReset: ['a.ts'] })
    mockedCreateCommit.mockImplementation(async () => {
      git.advanceHead()
      return {} as never
    })

    const plan = makePlan([{ title: 'feat: a', files: ['a.ts'] }])

    const result = await applyCommitSplitPlan({
      plan,
      changes: { staged: [fileChange('a.ts')], unstaged: [], untracked: [] },
      hunkInventory: emptyHunkInventory,
      git: git as never,
      logger,
      noVerify: false,
    })

    expect(ops.filter((op) => op.startsWith('add --'))).toEqual([])
    expect(result.message).not.toContain('re-staged')
  })
})

describe('applyCommitSplitPlan onHookFailure recovery (OSS-662)', () => {
  const logger = new Logger({ silent: true })

  afterEach(() => jest.clearAllMocks())

  it('retries the same group when onHookFailure resolves "retry"', async () => {
    const { git } = makeFakeGit({ stagedBeforeReset: ['a.ts'] })
    mockedCreateCommit
      .mockImplementationOnce(async () => {
        throw new PreCommitHookError('lint failed on a.ts')
      })
      .mockImplementationOnce(async (_msg, _git, _cb, options) => {
        expect(options).toMatchObject({ noVerify: false })
        git.advanceHead()
        return {} as never
      })

    const onHookFailure = jest.fn().mockResolvedValue('retry')
    const plan = makePlan([{ title: 'feat: a', files: ['a.ts'] }])

    const result = await applyCommitSplitPlan({
      plan,
      changes: { staged: [fileChange('a.ts')], unstaged: [], untracked: [] },
      hunkInventory: emptyHunkInventory,
      git: git as never,
      logger,
      noVerify: false,
      onHookFailure,
    })

    expect(onHookFailure).toHaveBeenCalledTimes(1)
    expect(onHookFailure).toHaveBeenCalledWith({ title: 'feat: a', hookOutput: 'lint failed on a.ts' })
    expect(mockedCreateCommit).toHaveBeenCalledTimes(2)
    expect(result.commitHashes).toEqual(['head-1'])
    expect(result.message).toContain('Created 1 split commit')
  })

  it('retries with --no-verify for only the stuck group when onHookFailure resolves "skip"', async () => {
    const { git } = makeFakeGit({ stagedBeforeReset: ['a.ts', 'b.ts'] })
    mockedCreateCommit
      .mockImplementationOnce(async () => {
        throw new PreCommitHookError('lint failed on a.ts')
      })
      .mockImplementationOnce(async (_msg, _git, _cb, options) => {
        expect(options).toMatchObject({ noVerify: true })
        git.advanceHead()
        return {} as never
      })
      .mockImplementationOnce(async (_msg, _git, _cb, options) => {
        // Group B must NOT inherit group A's --no-verify skip.
        expect(options).toMatchObject({ noVerify: false })
        git.advanceHead()
        return {} as never
      })

    const onHookFailure = jest.fn().mockResolvedValue('skip')
    const plan = makePlan([
      { title: 'feat: a', files: ['a.ts'] },
      { title: 'feat: b', files: ['b.ts'] },
    ])

    const result = await applyCommitSplitPlan({
      plan,
      changes: { staged: [fileChange('a.ts'), fileChange('b.ts')], unstaged: [], untracked: [] },
      hunkInventory: emptyHunkInventory,
      git: git as never,
      logger,
      noVerify: false,
      onHookFailure,
    })

    expect(mockedCreateCommit).toHaveBeenCalledTimes(3)
    expect(result.commitHashes).toEqual(['head-1', 'head-2'])
  })

  it('stops processing remaining groups and reports partial success when onHookFailure resolves "abort"', async () => {
    const { git } = makeFakeGit({ stagedBeforeReset: ['a.ts', 'b.ts', 'c.ts'] })
    mockedCreateCommit
      .mockImplementationOnce(async () => {
        git.advanceHead()
        return {} as never
      })
      .mockImplementationOnce(async () => {
        throw new PreCommitHookError('lint failed on b.ts')
      })

    const onHookFailure = jest.fn().mockResolvedValue('abort')
    const plan = makePlan([
      { title: 'feat: a', files: ['a.ts'] },
      { title: 'feat: b', files: ['b.ts'] },
      { title: 'feat: c', files: ['c.ts'] },
    ])

    const result = await applyCommitSplitPlan({
      plan,
      changes: {
        staged: [fileChange('a.ts'), fileChange('b.ts'), fileChange('c.ts')],
        unstaged: [],
        untracked: [],
      },
      hunkInventory: emptyHunkInventory,
      git: git as never,
      logger,
      noVerify: false,
      onHookFailure,
    })

    // Only groups A and B were attempted — C (after the abort) is untouched.
    expect(mockedCreateCommit).toHaveBeenCalledTimes(2)
    expect(onHookFailure).toHaveBeenCalledTimes(1)
    expect(result.commitHashes).toEqual(['head-1'])
    expect(result.message).toContain('1 of 3')
    expect(result.message).toContain('aborted')
  })

  it('records the failure and continues to the next group when no onHookFailure callback is supplied', async () => {
    const { git } = makeFakeGit({ stagedBeforeReset: ['a.ts', 'b.ts'] })
    mockedCreateCommit
      .mockImplementationOnce(async () => {
        throw new PreCommitHookError('lint failed on a.ts')
      })
      .mockImplementationOnce(async () => {
        git.advanceHead()
        return {} as never
      })

    const plan = makePlan([
      { title: 'feat: a', files: ['a.ts'] },
      { title: 'feat: b', files: ['b.ts'] },
    ])

    const result = await applyCommitSplitPlan({
      plan,
      changes: { staged: [fileChange('a.ts'), fileChange('b.ts')], unstaged: [], untracked: [] },
      hunkInventory: emptyHunkInventory,
      git: git as never,
      logger,
      noVerify: false,
    })

    expect(mockedCreateCommit).toHaveBeenCalledTimes(2)
    expect(result.commitHashes).toEqual(['head-1'])
    expect(result.message).toContain('1 of 2')
    expect(result.message).not.toContain('aborted')
  })
})
