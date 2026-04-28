import { revertFile, stageFile, unstageFile } from './statusActions'
import { WorktreeFile } from './statusData'

const file: WorktreeFile = {
  path: 'src/file.ts',
  indexStatus: ' ',
  worktreeStatus: 'M',
  state: 'unstaged',
}

describe('log status actions', () => {
  it('stages, unstages, and reverts files with explicit path separators', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue(''),
    }

    await stageFile(git as never, file)
    await unstageFile(git as never, file)
    await revertFile(git as never, file)

    expect(git.raw).toHaveBeenNthCalledWith(1, ['add', '--', 'src/file.ts'])
    expect(git.raw).toHaveBeenNthCalledWith(2, ['restore', '--staged', '--', 'src/file.ts'])
    expect(git.raw).toHaveBeenNthCalledWith(3, ['restore', '--', 'src/file.ts'])
  })

  it('does not revert untracked files automatically', async () => {
    const git = {
      raw: jest.fn(),
    }

    await expect(revertFile(git as never, {
      ...file,
      indexStatus: '?',
      worktreeStatus: '?',
      state: 'untracked',
    })).resolves.toEqual({
      ok: false,
      message: 'Untracked files are not reverted automatically.',
    })
    expect(git.raw).not.toHaveBeenCalled()
  })
})
