import {
  createBranchWorktree,
  createWorktree,
  removeWorktree,
  worktreePathAction,
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
  it('creates worktrees and branch worktrees with explicit paths', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue(''),
    }

    await createWorktree(git as never, ' ../repo-feature ', 'main')
    await createBranchWorktree(git as never, '../repo-new', 'feature/new', 'main')

    expect(git.raw).toHaveBeenNthCalledWith(1, ['worktree', 'add', '../repo-feature', 'main'])
    expect(git.raw).toHaveBeenNthCalledWith(2, [
      'worktree',
      'add',
      '-b',
      'feature/new',
      '../repo-new',
      'main',
    ])
  })

  it('removes clean non-current worktrees and reports paths', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue(''),
    }

    await expect(removeWorktree(git as never, worktree)).resolves.toEqual({
      ok: true,
      message: 'Removed worktree /repo-feature',
    })
    expect(worktreePathAction(worktree)).toEqual({
      ok: true,
      message: 'Worktree path: /repo-feature',
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
})
