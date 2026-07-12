/**
 * Regression coverage for #1579: the hunk/line-level staging handlers must
 * bump `setWorktreeDiffRefreshToken` alongside their existing
 * `setWorktreeDiff(undefined)` / `setWorktreeHunks(undefined)` clears. A
 * hunk-level mutation can leave the cursored file's own
 * `indexStatus`/`worktreeStatus` unchanged (reverting one of several
 * unstaged hunks; staging the 2nd+ hunk of an already-`MM` file) — those
 * scalar fields are `useDiffHydration`'s only other reload signal, so
 * without the token bump the cleared diff/hunks never reload.
 *
 * A minimal fake-React harness (`useCallback` returns the callback
 * directly) drives the hook without a renderer; the git action layer is
 * mocked so each handler resolves without touching a real repo.
 */
import type * as ReactTypes from 'react'
import {
  useWorktreeStageActions,
  type UseWorktreeStageActionsDeps,
} from './useWorktreeStageActions'
import type { WorktreeFile } from '../../../git/statusData'
import type { WorktreeHunkOverview } from '../../../git/statusHunks'
import type { WorktreeFileDiff } from '../../../git/worktreeDiffData'

jest.mock('../../../git/statusActions', () => ({
  stageFile: jest.fn().mockResolvedValue({ ok: true, message: 'staged file' }),
  unstageFile: jest.fn().mockResolvedValue({ ok: true, message: 'unstaged file' }),
  revertFile: jest.fn().mockResolvedValue({ ok: true, message: 'reverted file' }),
}))
jest.mock('../../../git/statusHunks', () => ({
  ...jest.requireActual('../../../git/statusHunks'),
  stageHunk: jest.fn().mockResolvedValue(undefined),
  unstageHunk: jest.fn().mockResolvedValue(undefined),
  revertHunk: jest.fn().mockResolvedValue(undefined),
  stageHunkLines: jest.fn().mockResolvedValue(undefined),
  revertHunkLines: jest.fn().mockResolvedValue(undefined),
}))

/** Fake React whose `useCallback` returns the callback itself, ignoring deps. */
function fakeReact(): typeof import('react') {
  return {
    useCallback: (fn: unknown) => fn,
  } as unknown as typeof import('react')
}

const selectedWorktreeFile: WorktreeFile = {
  path: 'src/app.ts',
  indexStatus: 'M',
  worktreeStatus: 'M',
  state: 'unstaged',
}

const unstagedHunk = {
  id: 'h1',
  filePath: 'src/app.ts',
  state: 'unstaged' as const,
  patch: {} as never,
  hunk: { lines: ['-old', '+new'] } as never,
  header: '@@ -1,1 +1,1 @@',
  preview: '-old\n+new',
}

const worktreeHunks: WorktreeHunkOverview = {
  filePath: 'src/app.ts',
  hunks: [unstagedHunk],
}

const worktreeDiff: WorktreeFileDiff = {
  filePath: 'src/app.ts',
  hunkOffsets: [0],
  lines: ['@@ -1,1 +1,1 @@', '-old', '+new'],
  staged: false,
  unstaged: true,
  untracked: false,
}

function baseDeps(
  overrides: Partial<UseWorktreeStageActionsDeps> = {}
): UseWorktreeStageActionsDeps {
  return {
    git: {} as never,
    dispatch: jest.fn(),
    selectedWorktreeFile,
    worktreeDiff,
    worktreeHunks,
    worktreeDiffOffset: 0,
    diffLineSelectAnchor: undefined,
    refreshWorktreeContext: jest.fn().mockResolvedValue(undefined),
    mutateWorktreeOverview: jest.fn(),
    visibleWorktreeFilesGrouped: [selectedWorktreeFile],
    selectedWorktreeFileIndex: 0,
    statusFilterMask: 'all' as never,
    setWorktreeDiff: jest.fn(),
    setWorktreeHunks: jest.fn(),
    setWorktreeDiffRefreshToken: jest.fn(),
    ...overrides,
  }
}

describe('useWorktreeStageActions — worktreeDiffRefreshToken bump (#1579)', () => {
  it('toggleSelectedHunkStage bumps the refresh token alongside the diff/hunks clear', async () => {
    const deps = baseDeps()
    const { toggleSelectedHunkStage } = useWorktreeStageActions(fakeReact(), deps)

    await toggleSelectedHunkStage()

    expect(deps.setWorktreeDiff).toHaveBeenCalledWith(undefined)
    expect(deps.setWorktreeHunks).toHaveBeenCalledWith(undefined)
    expect(deps.setWorktreeDiffRefreshToken).toHaveBeenCalledTimes(1)
    expect(deps.setWorktreeDiffRefreshToken).toHaveBeenCalledWith(expect.any(Function))
    // The updater must increment, not just re-set — a same-status hunk
    // mutation with no other changed dep relies on this to actually differ.
    expect((deps.setWorktreeDiffRefreshToken as jest.Mock).mock.calls[0][0](0)).toBe(1)
  })

  it('revertSelectedHunk bumps the refresh token alongside the diff/hunks clear', async () => {
    const deps = baseDeps()
    const { revertSelectedHunk } = useWorktreeStageActions(fakeReact(), deps)

    await revertSelectedHunk()

    expect(deps.setWorktreeDiffRefreshToken).toHaveBeenCalledTimes(1)
    expect((deps.setWorktreeDiffRefreshToken as jest.Mock).mock.calls[0][0](5)).toBe(6)
  })

  it('stageSelectedLines bumps the refresh token alongside the diff/hunks clear', async () => {
    const deps = baseDeps({ diffLineSelectAnchor: 1, worktreeDiffOffset: 2 })
    const { stageSelectedLines } = useWorktreeStageActions(fakeReact(), deps)

    await stageSelectedLines()

    expect(deps.setWorktreeDiffRefreshToken).toHaveBeenCalledTimes(1)
  })

  it('revertSelectedLines bumps the refresh token alongside the diff/hunks clear', async () => {
    const deps = baseDeps({ diffLineSelectAnchor: 1, worktreeDiffOffset: 2 })
    const { revertSelectedLines } = useWorktreeStageActions(fakeReact(), deps)

    await revertSelectedLines()

    expect(deps.setWorktreeDiffRefreshToken).toHaveBeenCalledTimes(1)
  })

  it('toggleSelectedFileStage does not need to bump the token (status always changes on file-level ops)', async () => {
    const deps = baseDeps()
    const { toggleSelectedFileStage } = useWorktreeStageActions(fakeReact(), deps)

    await toggleSelectedFileStage()

    expect(deps.setWorktreeDiff).toHaveBeenCalledWith(undefined)
    expect(deps.setWorktreeHunks).toHaveBeenCalledWith(undefined)
    expect(deps.setWorktreeDiffRefreshToken).not.toHaveBeenCalled()
  })
})
