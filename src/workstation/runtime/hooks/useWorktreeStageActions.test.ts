/**
 * Coverage for the four hunk/line-level staging handlers plus the
 * whole-file toggle. Each must refresh the worktree context and clear the
 * cached diff/hunks so the staging pane re-hydrates (#1579) — the actual
 * `worktreeDiffRefreshToken` bump that forces re-hydration even when a
 * file's own `indexStatus`/`worktreeStatus` is left unchanged (reverting
 * one of several unstaged hunks; staging the 2nd+ hunk of an already-`MM`
 * file) now lives centrally inside `refreshWorktreeContext` itself
 * (`useContextRefresh.ts`, covered by `useContextRefresh.test.ts`) rather
 * than at each individual call site here (PR #1646 review) — so every
 * `refreshWorktreeContext` caller, current and future, gets it
 * automatically instead of each handler having to remember to bump it.
 *
 * A minimal fake-React harness (`useCallback` returns the callback
 * directly) drives the hook without a renderer; the git action layer is
 * mocked so each handler resolves without touching a real repo.
 */
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
    ...overrides,
  }
}

describe('useWorktreeStageActions — refresh + diff/hunks clear on every mutation (#1579)', () => {
  it('toggleSelectedHunkStage refreshes the worktree context and clears the cached diff/hunks', async () => {
    const deps = baseDeps()
    const { toggleSelectedHunkStage } = useWorktreeStageActions(fakeReact(), deps)

    await toggleSelectedHunkStage()

    expect(deps.refreshWorktreeContext).toHaveBeenCalledTimes(1)
    expect(deps.setWorktreeDiff).toHaveBeenCalledWith(undefined)
    expect(deps.setWorktreeHunks).toHaveBeenCalledWith(undefined)
  })

  it('revertSelectedHunk refreshes the worktree context and clears the cached diff/hunks', async () => {
    const deps = baseDeps()
    const { revertSelectedHunk } = useWorktreeStageActions(fakeReact(), deps)

    await revertSelectedHunk()

    expect(deps.refreshWorktreeContext).toHaveBeenCalledTimes(1)
    expect(deps.setWorktreeDiff).toHaveBeenCalledWith(undefined)
    expect(deps.setWorktreeHunks).toHaveBeenCalledWith(undefined)
  })

  it('stageSelectedLines refreshes the worktree context and clears the cached diff/hunks', async () => {
    const deps = baseDeps({ diffLineSelectAnchor: 1, worktreeDiffOffset: 2 })
    const { stageSelectedLines } = useWorktreeStageActions(fakeReact(), deps)

    await stageSelectedLines()

    expect(deps.refreshWorktreeContext).toHaveBeenCalledTimes(1)
    expect(deps.setWorktreeDiff).toHaveBeenCalledWith(undefined)
    expect(deps.setWorktreeHunks).toHaveBeenCalledWith(undefined)
  })

  it('revertSelectedLines refreshes the worktree context and clears the cached diff/hunks', async () => {
    const deps = baseDeps({ diffLineSelectAnchor: 1, worktreeDiffOffset: 2 })
    const { revertSelectedLines } = useWorktreeStageActions(fakeReact(), deps)

    await revertSelectedLines()

    expect(deps.refreshWorktreeContext).toHaveBeenCalledTimes(1)
    expect(deps.setWorktreeDiff).toHaveBeenCalledWith(undefined)
    expect(deps.setWorktreeHunks).toHaveBeenCalledWith(undefined)
  })

  it('toggleSelectedFileStage also refreshes the worktree context and clears the cached diff/hunks', async () => {
    const deps = baseDeps()
    const { toggleSelectedFileStage } = useWorktreeStageActions(fakeReact(), deps)

    await toggleSelectedFileStage()

    expect(deps.refreshWorktreeContext).toHaveBeenCalledTimes(1)
    expect(deps.setWorktreeDiff).toHaveBeenCalledWith(undefined)
    expect(deps.setWorktreeHunks).toHaveBeenCalledWith(undefined)
  })
})
