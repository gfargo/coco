import {
  checkoutBranch,
  createBranch,
  deleteBranch,
  fetchRemotes,
  getBranchActionRefs,
  pullCurrentBranch,
  pushCurrentBranch,
  renameBranch,
  setUpstream,
} from './branchActions'
import { BranchRef } from './branchData'

function localBranch(overrides: Partial<BranchRef> = {}): BranchRef {
  return {
    type: 'local',
    name: 'refs/heads/feature/test',
    shortName: 'feature/test',
    hash: 'abc1234',
    current: false,
    date: '2026-04-27',
    subject: 'feat: test',
    ahead: 0,
    behind: 0,
    ...overrides,
  }
}

function remoteBranch(overrides: Partial<BranchRef> = {}): BranchRef {
  return {
    type: 'remote',
    name: 'refs/remotes/origin/feature/test',
    shortName: 'origin/feature/test',
    hash: 'abc1234',
    current: false,
    remote: 'origin',
    date: '2026-04-27',
    subject: 'feat: test',
    ahead: 0,
    behind: 0,
    ...overrides,
  }
}

describe('log branch actions', () => {
  it('maps local and remote refs to actionable branch names', () => {
    expect(getBranchActionRefs(localBranch({ upstream: 'origin/feature/test' }))).toEqual({
      localBranch: 'feature/test',
      remoteBranch: 'origin/feature/test',
    })
    expect(getBranchActionRefs(remoteBranch())).toEqual({
      localBranch: 'feature/test',
      remoteBranch: 'origin/feature/test',
    })
  })

  it('checks out local branches and creates tracking branches from remotes', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue(''),
    }

    await expect(checkoutBranch(git as never, localBranch())).resolves.toEqual({
      ok: true,
      message: 'Checked out feature/test',
    })
    await expect(checkoutBranch(git as never, remoteBranch())).resolves.toEqual({
      ok: true,
      message: 'Created tracking branch feature/test from origin/feature/test',
    })

    expect(git.raw).toHaveBeenNthCalledWith(1, ['switch', 'feature/test'])
    expect(git.raw).toHaveBeenNthCalledWith(2, [
      'switch',
      '--track',
      '-c',
      'feature/test',
      'origin/feature/test',
    ])
  })

  it('rejects unsafe delete requests before invoking git', async () => {
    const git = {
      raw: jest.fn(),
    }

    await expect(deleteBranch(git as never, remoteBranch())).resolves.toEqual({
      ok: false,
      message: 'Only local branches can be deleted.',
    })
    await expect(deleteBranch(git as never, localBranch({ current: true }))).resolves.toEqual({
      ok: false,
      message: 'Cannot delete the current branch.',
    })
    expect(git.raw).not.toHaveBeenCalled()
  })

  it('uses safe git commands for branch management and remote sync', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue(''),
    }

    await createBranch(git as never, 'feature/new', 'abc1234')
    await renameBranch(git as never, 'feature/old', 'feature/new')
    await deleteBranch(git as never, localBranch())
    await fetchRemotes(git as never)
    await pullCurrentBranch(git as never)
    await pushCurrentBranch(git as never)
    await setUpstream(git as never, 'feature/new', 'origin/feature/new')

    expect(git.raw).toHaveBeenNthCalledWith(1, ['switch', '-c', 'feature/new', 'abc1234'])
    expect(git.raw).toHaveBeenNthCalledWith(2, ['branch', '-m', 'feature/old', 'feature/new'])
    expect(git.raw).toHaveBeenNthCalledWith(3, ['branch', '-d', 'feature/test'])
    expect(git.raw).toHaveBeenNthCalledWith(4, ['fetch', '--all', '--prune'])
    expect(git.raw).toHaveBeenNthCalledWith(5, ['pull', '--ff-only'])
    expect(git.raw).toHaveBeenNthCalledWith(6, ['push'])
    expect(git.raw).toHaveBeenNthCalledWith(7, [
      'branch',
      '--set-upstream-to',
      'origin/feature/new',
      'feature/new',
    ])
  })
})
