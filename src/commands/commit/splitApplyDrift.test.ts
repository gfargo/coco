/**
 * Tests for the apply-time drift check (#1396): `applyCommitSplitPlan`
 * must refuse when the staged state changed between plan generation
 * (the snapshot the workstation holds during preview) and `y`-to-apply
 * — `git add` stages what is on disk NOW, so drifted content would be
 * committed under the reviewed message with no guard firing.
 *
 * `createCommit` is mocked; the fake git drives `status()` to simulate
 * the fresh probe.
 */

import type { FileChange } from '../../lib/types'
import { applyCommitSplitPlan, type CommitSplitPlan } from './split'
import { createCommit } from '../../lib/simple-git/createCommit'
import { Logger } from '../../lib/utils/logger'

jest.mock('../../lib/simple-git/createCommit', () => ({
  createCommit: jest.fn(),
  PreCommitHookError: class PreCommitHookError extends Error {},
}))

const mockedCreateCommit = createCommit as jest.MockedFunction<typeof createCommit>

type FreshFile = { path: string; index: string; working_dir: string }

function makeFakeGit(options: { staged: string[]; files?: FreshFile[] }) {
  let head = 0
  const git = {
    raw: jest.fn(async () => ''),
    add: jest.fn(async () => ''),
    status: jest.fn(async () => ({
      staged: options.staged,
      created: [],
      renamed: [],
      modified: [],
      deleted: [],
      not_added: [],
      files: options.files ?? [],
    })),
    revparse: jest.fn(async () => `head-${head}`),
    advanceHead: () => {
      head += 1
    },
  }
  return git
}

function fileChange(filePath: string): FileChange {
  return { filePath, status: 'modified', summary: `${filePath} changed` }
}

const emptyHunkInventory = {
  hunks: [],
  byId: new Map(),
  byFile: new Map(),
} as never

function makePlan(files: string[]): CommitSplitPlan {
  return { groups: [{ title: 'feat: x', body: '', files }] } as CommitSplitPlan
}

describe('applyCommitSplitPlan drift check (#1396)', () => {
  const logger = new Logger({ silent: true })

  afterEach(() => jest.clearAllMocks())

  it('refuses when a planned file is no longer staged at apply time', async () => {
    const git = makeFakeGit({ staged: [] })

    await expect(
      applyCommitSplitPlan({
        plan: makePlan(['a.ts']),
        changes: { staged: [fileChange('a.ts')], unstaged: [], untracked: [] },
        hunkInventory: emptyHunkInventory,
        git: git as never,
        logger,
        noVerify: false,
      })
    ).rejects.toThrow(/no longer staged: a\.ts/)

    // The refusal must land BEFORE the up-front `git reset` wipes the
    // index — nothing destructive may run on a drifted worktree.
    expect(git.raw).not.toHaveBeenCalled()
    expect(mockedCreateCommit).not.toHaveBeenCalled()
  })

  it('refuses when a planned file gained unstaged edits since the plan', async () => {
    const git = makeFakeGit({
      staged: ['a.ts'],
      files: [{ path: 'a.ts', index: 'M', working_dir: 'M' }],
    })

    await expect(
      applyCommitSplitPlan({
        plan: makePlan(['a.ts']),
        changes: { staged: [fileChange('a.ts')], unstaged: [], untracked: [] },
        hunkInventory: emptyHunkInventory,
        git: git as never,
        logger,
        noVerify: false,
      })
    ).rejects.toThrow(/changed on disk since the plan/)

    expect(git.raw).not.toHaveBeenCalled()
  })

  it('applies cleanly when the fresh state matches the snapshot', async () => {
    const git = makeFakeGit({
      staged: ['a.ts'],
      files: [{ path: 'a.ts', index: 'M', working_dir: ' ' }],
    })
    mockedCreateCommit.mockImplementation(async () => {
      git.advanceHead()
      return {} as never
    })

    const result = await applyCommitSplitPlan({
      plan: makePlan(['a.ts']),
      changes: { staged: [fileChange('a.ts')], unstaged: [], untracked: [] },
      hunkInventory: emptyHunkInventory,
      git: git as never,
      logger,
      noVerify: false,
    })

    expect(result.commitHashes).toEqual(['head-1'])
  })
})
