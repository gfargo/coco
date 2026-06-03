import { revertFile, stageAll, stageFile, stagePathspec, unstageFile } from './statusActions'
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

  describe('stageAll', () => {
    it('runs git add -A', async () => {
      const git = { raw: jest.fn().mockResolvedValue('') }
      const result = await stageAll(git as never)
      expect(result.ok).toBe(true)
      expect(result.message).toBe('Staged all changes')
      expect(git.raw).toHaveBeenCalledWith(['add', '-A'])
    })
  })

  describe('stagePathspec', () => {
    it('stages a single pathspec', async () => {
      const git = { raw: jest.fn().mockResolvedValue('') }
      const result = await stagePathspec(git as never, 'src/')
      expect(result.ok).toBe(true)
      expect(git.raw).toHaveBeenCalledWith(['add', '--', 'src/'])
    })

    it('splits a space-separated list into multiple pathspecs', async () => {
      const git = { raw: jest.fn().mockResolvedValue('') }
      await stagePathspec(git as never, '  src/  *.ts  ')
      expect(git.raw).toHaveBeenCalledWith(['add', '--', 'src/', '*.ts'])
    })

    it('passes globs through to git unquoted (no shell)', async () => {
      const git = { raw: jest.fn().mockResolvedValue('') }
      await stagePathspec(git as never, '*.json')
      expect(git.raw).toHaveBeenCalledWith(['add', '--', '*.json'])
    })

    it('refuses an empty pathspec', async () => {
      const git = { raw: jest.fn() }
      const result = await stagePathspec(git as never, '   ')
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/Enter a pathspec/)
      expect(git.raw).not.toHaveBeenCalled()
    })
  })
})
