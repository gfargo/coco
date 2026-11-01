import { BranchRef } from './branchData'
import {
  addWorktree,
  defaultWorktreePath,
  parseAddWorktreeInput,
  removeWorktree,
  removeWorktreeAndBranch,
} from './worktreeActions'
import { WorktreeEntry } from './worktreeData'

const worktree: WorktreeEntry = {
  path: '/repo-feature',
  head: 'abc123',
  branch: 'feature/log',
  detached: false,
  bare: false,
  current: false,
  dirty: false,
}

describe('log worktree actions', () => {
  it('removes clean non-current worktrees and reports paths', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue(''),
    }

    await expect(removeWorktree(git as never, worktree)).resolves.toEqual({
      ok: true,
      message: 'Removed worktree /repo-feature',
    })
    expect(git.raw).toHaveBeenCalledWith(['worktree', 'remove', '/repo-feature'])
  })

  it('blocks current or dirty worktree removal before invoking git', async () => {
    const git = {
      raw: jest.fn(),
    }

    await expect(removeWorktree(git as never, { ...worktree, current: true })).resolves.toEqual({
      ok: false,
      message: 'Cannot remove the current worktree.',
    })
    await expect(removeWorktree(git as never, { ...worktree, dirty: true })).resolves.toEqual({
      ok: false,
      message: 'Cannot remove dirty worktree /repo-feature. Clean or stash it first.',
    })
    expect(git.raw).not.toHaveBeenCalled()
  })

  // #838 — `D` on a worktree chains the worktree removal AND the
  // branch delete in one action so users don't have to remove the
  // worktree, navigate to the branches view, then delete the branch
  // separately.
  describe('removeWorktreeAndBranch', () => {
    const branchRef: BranchRef = {
      type: 'local',
      name: 'refs/heads/feature/log',
      shortName: 'feature/log',
      hash: 'abc123',
      current: false,
      date: '2026-05-03',
      subject: 'feat: log',
      ahead: 0,
      behind: 0,
    }

    it('removes the worktree then deletes the matching branch', async () => {
      const git = { raw: jest.fn().mockResolvedValue('') }

      await expect(
        removeWorktreeAndBranch(git as never, worktree, [branchRef])
      ).resolves.toEqual({
        ok: true,
        message: 'Removed worktree /repo-feature and deleted branch feature/log',
      })

      expect(git.raw).toHaveBeenNthCalledWith(1, ['worktree', 'remove', '/repo-feature'])
      expect(git.raw).toHaveBeenNthCalledWith(2, ['branch', '-d', 'feature/log'])
    })

    it('aborts before the branch delete when the worktree removal fails', async () => {
      const git = { raw: jest.fn() }

      await expect(
        removeWorktreeAndBranch(git as never, { ...worktree, dirty: true }, [branchRef])
      ).resolves.toEqual({
        ok: false,
        message: 'Cannot remove dirty worktree /repo-feature. Clean or stash it first.',
      })
      // Worktree pre-flight rejected; git.raw was never called for
      // either step.
      expect(git.raw).not.toHaveBeenCalled()
    })

    it('reports a partial failure when the branch delete fails after a successful worktree removal', async () => {
      const git = {
        raw: jest.fn()
          .mockResolvedValueOnce('') // worktree remove ok
          .mockRejectedValueOnce(new Error('branch feature/log not fully merged')),
      }

      await expect(
        removeWorktreeAndBranch(git as never, worktree, [branchRef])
      ).resolves.toEqual({
        ok: false,
        message: 'Removed worktree /repo-feature, but branch delete failed: branch feature/log not fully merged',
      })
    })

    it('skips the branch delete when the worktree had no branch (detached HEAD)', async () => {
      const git = { raw: jest.fn().mockResolvedValue('') }

      await expect(
        removeWorktreeAndBranch(
          git as never,
          { ...worktree, branch: undefined, detached: true },
          [branchRef]
        )
      ).resolves.toEqual({
        ok: true,
        message: 'Removed worktree /repo-feature (no branch to delete)',
      })

      expect(git.raw).toHaveBeenCalledTimes(1)
      expect(git.raw).toHaveBeenCalledWith(['worktree', 'remove', '/repo-feature'])
    })

    it('skips the branch delete when the named branch is not in the local ref list', async () => {
      const git = { raw: jest.fn().mockResolvedValue('') }

      await expect(
        removeWorktreeAndBranch(git as never, worktree, [])
      ).resolves.toEqual({
        ok: true,
        message: 'Removed worktree /repo-feature (branch feature/log not found in local branches)',
      })

      expect(git.raw).toHaveBeenCalledTimes(1)
    })
  })
})

describe('add worktree (#2214)', () => {
  it('puts a default worktree beside the current one, flattening slashes', () => {
    expect(defaultWorktreePath('/work/coco', 'feat/x')).toBe('/work/coco-feat-x')
  })

  it('parses `<branch> [path]`, resolving a relative path against the current worktree', () => {
    expect(parseAddWorktreeInput('feat/x', '/work/coco'))
      .toEqual({ branch: 'feat/x', path: '/work/coco-feat-x' })
    expect(parseAddWorktreeInput('feat/x ../elsewhere', '/work/coco'))
      .toEqual({ branch: 'feat/x', path: '/work/elsewhere' })
    expect(parseAddWorktreeInput('feat/x /abs/dir', '/work/coco'))
      .toEqual({ branch: 'feat/x', path: '/abs/dir' })
    expect(parseAddWorktreeInput('   ', '/work/coco')).toBeUndefined()
  })

  it('checks out an existing local branch', async () => {
    const raw = jest.fn().mockResolvedValue('')
    await expect(addWorktree({ raw } as never, 'feat/x', '/work/x')).resolves.toEqual({
      ok: true,
      message: 'Added worktree /work/x on feat/x',
    })
    expect(raw).toHaveBeenLastCalledWith(['worktree', 'add', '/work/x', 'feat/x'])
  })

  it('creates the branch when it does not exist yet', async () => {
    const raw = jest.fn(async (args: string[]) => {
      if (args[0] === 'rev-parse') throw new Error('exit 1')
      return ''
    })
    await expect(addWorktree({ raw } as never, 'feat/x', '/work/x')).resolves.toEqual({
      ok: true,
      message: 'Added worktree /work/x on new branch feat/x',
    })
    expect(raw).toHaveBeenLastCalledWith(['worktree', 'add', '-b', 'feat/x', '/work/x'])
  })

  it('passes git\'s refusal through (branch already checked out elsewhere)', async () => {
    const raw = jest.fn(async (args: string[]) => {
      if (args[0] === 'worktree') throw new Error("fatal: 'feat/x' is already used by worktree at '/work/y'")
      return ''
    })
    const result = await addWorktree({ raw } as never, 'feat/x', '/work/x')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('already used by worktree')
  })
})
