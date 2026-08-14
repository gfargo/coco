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
import { makeFakeGit } from '../../test/builders/makeFakeGit'

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
    const { git, ops } = makeFakeGit.staged(['a.ts', 'b.ts'])
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
    // failed commit and used to be absorbed into B's commit. Group A's
    // file (a.ts) belonged to the failed group and was originally
    // staged, so it must be re-staged after the loop rather than left
    // unstaged with no warning (#1876).
    expect(ops).toEqual([
      'list-staged',
      'reset',
      'stage a.ts',
      'reset',
      'stage b.ts',
      'add -- a.ts',
    ])
    expect(result.commitHashes).toEqual(['head-1'])
    expect(result.message).toContain('1 of 2')
    expect(result.message).toContain('re-staged')
  })

  it('re-stages staged files the plan never claimed (config-filtered lockfiles)', async () => {
    const { git, ops } = makeFakeGit.staged(['a.ts', 'yarn.lock'])
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
    const { git, ops } = makeFakeGit.staged(['a.ts'])
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

  it('re-stages a rescued "unclaimed" group file instead of dropping it silently (#1878)', async () => {
    // rescueMissingFiles tags files the model failed to place with a
    // synthetic `unclaimed: true` group so validation passes; applicableGroups
    // then filters unclaimed groups out of the apply loop entirely (#1180).
    // Those files are still in plannedFiles (built from every plan.group,
    // unclaimed included) but never reach committedFiles, since they're
    // never attempted — so they fall out of the same #1876 restage path as
    // a failed group, without needing separate handling.
    const { git, ops } = makeFakeGit.staged(['a.ts', 'c.ts'])
    mockedCreateCommit.mockImplementation(async () => {
      git.advanceHead()
      return {} as never
    })

    const plan = {
      groups: [
        { title: 'feat: a', files: ['a.ts'], body: '' },
        { title: 'unclaimed', files: ['c.ts'], body: '', unclaimed: true },
      ],
    } as CommitSplitPlan

    const result = await applyCommitSplitPlan({
      plan,
      changes: { staged: [fileChange('a.ts'), fileChange('c.ts')], unstaged: [], untracked: [] },
      hunkInventory: emptyHunkInventory,
      git: git as never,
      logger,
      noVerify: false,
    })

    expect(ops).toContain('add -- c.ts')
    expect(result.message).toContain('re-staged')
  })

  it('re-stages every planned file before throwing when every group fails (#1876)', async () => {
    // The other half of the bug: "if every group fails, throw — but the
    // index is left empty" (no rollback of the up-front reset at all).
    const { git, ops } = makeFakeGit.staged(['a.ts', 'b.ts'])
    mockedCreateCommit.mockImplementation(async () => {
      throw new Error('Pre-commit hook failed')
    })

    const plan = makePlan([
      { title: 'feat: a', files: ['a.ts'] },
      { title: 'feat: b', files: ['b.ts'] },
    ])

    await expect(
      applyCommitSplitPlan({
        plan,
        changes: { staged: [fileChange('a.ts'), fileChange('b.ts')], unstaged: [], untracked: [] },
        hunkInventory: emptyHunkInventory,
        git: git as never,
        logger,
        noVerify: false,
      })
    ).rejects.toThrow('Split apply created zero commits')

    expect(ops).toContain('add -- a.ts b.ts')
  })
})

describe('applyCommitSplitPlan onHookFailure recovery (OSS-662)', () => {
  const logger = new Logger({ silent: true })

  afterEach(() => jest.clearAllMocks())

  it('retries the same group when onHookFailure resolves "retry"', async () => {
    const { git } = makeFakeGit.staged(['a.ts'])
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
    const { git } = makeFakeGit.staged(['a.ts', 'b.ts'])
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
    const { git, ops } = makeFakeGit.staged(['a.ts', 'b.ts', 'c.ts'])
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

    // b.ts (failed group) and c.ts (never attempted after the abort)
    // must both come back staged rather than left in the unstaged pile
    // with no warning (#1876).
    expect(ops).toContain('add -- b.ts c.ts')
    expect(result.message).toContain('re-staged')
  })

  it('records the failure and continues to the next group when no onHookFailure callback is supplied', async () => {
    const { git } = makeFakeGit.staged(['a.ts', 'b.ts'])
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

/**
 * CMD-12: the split path committed every group's `${title}\n\n${body}`
 * verbatim with no commitlint check anywhere — in a commitlint-configured
 * repo this could (and did) produce commits that violated the project's
 * own rules. `applyCommitSplitPlan` now re-validates each group right
 * before any index mutation, using the SAME validator the plan was
 * generated against: pass through unchanged, mechanically repair and
 * commit the repaired message, or refuse to touch the index at all.
 */
describe('applyCommitSplitPlan — commitlint hard gate (CMD-12)', () => {
  const logger = new Logger({ silent: true })

  afterEach(() => jest.clearAllMocks())

  it('does nothing when no validator is supplied (bound-mode-off / repo has no commitlint config)', async () => {
    const { git } = makeFakeGit.staged(['a.ts'])
    mockedCreateCommit.mockImplementation(async () => {
      git.advanceHead()
      return {} as never
    })
    const plan = makePlan([{ title: 'not-conventional at all', files: ['a.ts'] }])

    const result = await applyCommitSplitPlan({
      plan,
      changes: { staged: [fileChange('a.ts')], unstaged: [], untracked: [] },
      hunkInventory: emptyHunkInventory,
      git: git as never,
      logger,
      noVerify: false,
    })

    expect(mockedCreateCommit).toHaveBeenCalledWith(
      'not-conventional at all',
      expect.anything(),
      undefined,
      expect.anything()
    )
    expect(result.commitHashes).toEqual(['head-1'])
  })

  it('commits unchanged when every group already passes validation', async () => {
    const { git } = makeFakeGit.staged(['a.ts'])
    mockedCreateCommit.mockImplementation(async () => {
      git.advanceHead()
      return {} as never
    })
    const plan = makePlan([{ title: 'feat: add thing', files: ['a.ts'] }])
    const validateGroupMessage = jest.fn(async () => ({ valid: true, errors: [] }))

    const result = await applyCommitSplitPlan({
      plan,
      changes: { staged: [fileChange('a.ts')], unstaged: [], untracked: [] },
      hunkInventory: emptyHunkInventory,
      git: git as never,
      logger,
      noVerify: false,
      validateGroupMessage,
    })

    expect(validateGroupMessage).toHaveBeenCalledWith('feat: add thing')
    expect(mockedCreateCommit).toHaveBeenCalledWith(
      'feat: add thing',
      expect.anything(),
      undefined,
      expect.anything()
    )
    expect(result.commitHashes).toEqual(['head-1'])
  })

  it('commits the mechanically-repaired message when repair fixes the violation', async () => {
    const { git } = makeFakeGit.staged(['a.ts'])
    mockedCreateCommit.mockImplementation(async () => {
      git.advanceHead()
      return {} as never
    })
    // Uppercase-subject violation (lowercase `feat:` prefix, capitalized
    // subject) — repairDraftAgainstValidationErrors lower-cases the
    // subject's first letter, same repair plain `coco commit` applies.
    const plan = makePlan([{ title: 'feat: Add Thing', files: ['a.ts'] }])
    const validateGroupMessage = jest.fn(async (message: string) =>
      message === 'feat: Add Thing'
        ? { valid: false, errors: ['subject-case must be lower-case'] }
        : { valid: true, errors: [] }
    )

    const result = await applyCommitSplitPlan({
      plan,
      changes: { staged: [fileChange('a.ts')], unstaged: [], untracked: [] },
      hunkInventory: emptyHunkInventory,
      git: git as never,
      logger,
      noVerify: false,
      validateGroupMessage,
    })

    expect(mockedCreateCommit).toHaveBeenCalledWith(
      'feat: add Thing',
      expect.anything(),
      undefined,
      expect.anything()
    )
    expect(result.commitHashes).toEqual(['head-1'])
  })

  it('refuses to touch the index when a group still fails validation after repair', async () => {
    const { git, ops } = makeFakeGit.staged(['a.ts'])
    const plan = makePlan([{ title: 'Bad Title', files: ['a.ts'] }])
    const validateGroupMessage = jest.fn(async () => ({
      valid: false,
      errors: ['type-empty may not be empty'],
    }))

    await expect(
      applyCommitSplitPlan({
        plan,
        changes: { staged: [fileChange('a.ts')], unstaged: [], untracked: [] },
        hunkInventory: emptyHunkInventory,
        git: git as never,
        logger,
        noVerify: false,
        validateGroupMessage,
      })
    ).rejects.toThrow(/commitlint validation/)

    // Nothing was staged, reset, or committed — the check runs before any
    // index mutation begins.
    expect(ops).toEqual([])
    expect(mockedCreateCommit).not.toHaveBeenCalled()
  })

  it('skips unclaimed groups (never committed) when validating', async () => {
    const { git } = makeFakeGit.staged(['a.ts', 'c.ts'])
    mockedCreateCommit.mockImplementation(async () => {
      git.advanceHead()
      return {} as never
    })
    const plan = {
      groups: [
        { title: 'feat: a', files: ['a.ts'], body: '' },
        { title: '', files: ['c.ts'], body: '', unclaimed: true },
      ],
    } as CommitSplitPlan
    const validateGroupMessage = jest.fn(async () => ({ valid: true, errors: [] }))

    await applyCommitSplitPlan({
      plan,
      changes: { staged: [fileChange('a.ts'), fileChange('c.ts')], unstaged: [], untracked: [] },
      hunkInventory: emptyHunkInventory,
      git: git as never,
      logger,
      noVerify: false,
      validateGroupMessage,
    })

    expect(validateGroupMessage).toHaveBeenCalledTimes(1)
    expect(validateGroupMessage).toHaveBeenCalledWith('feat: a')
  })
})
