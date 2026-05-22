import {
  checkoutBranch,
  createBranch,
  deleteBranch,
  fetchBranch,
  fetchRemotes,
  getBranchActionRefs,
  pullBranch,
  pullCurrentBranch,
  pushBranch,
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

  describe('pushBranch', () => {
    it('pushes the cursored branch to its upstream remote without checkout', async () => {
      const git = { raw: jest.fn().mockResolvedValue('') }
      const branch = localBranch({
        shortName: 'feat/widgets',
        upstream: 'origin/feat/widgets',
        remote: 'origin',
      })

      const result = await pushBranch(git as never, branch)

      expect(result.ok).toBe(true)
      expect(result.message).toContain('Pushed feat/widgets')
      expect(git.raw).toHaveBeenCalledWith(['push', 'origin', 'feat/widgets'])
    })

    it('refuses when the branch has no upstream', async () => {
      const git = { raw: jest.fn() }
      const branch = localBranch({ shortName: 'local-only' })

      const result = await pushBranch(git as never, branch)

      expect(result.ok).toBe(false)
      expect(result.message).toContain('no upstream')
      expect(git.raw).not.toHaveBeenCalled()
    })

    it('refuses for remote-type branch refs', async () => {
      const git = { raw: jest.fn() }
      const result = await pushBranch(git as never, remoteBranch())

      expect(result.ok).toBe(false)
      expect(result.message).toContain('Only local branches')
      expect(git.raw).not.toHaveBeenCalled()
    })
  })

  describe('fetchBranch', () => {
    it('fetches just the cursored branch\'s upstream ref', async () => {
      const git = { raw: jest.fn().mockResolvedValue('') }
      const branch = localBranch({
        shortName: 'feat/widgets',
        upstream: 'origin/feat/widgets',
        remote: 'origin',
      })

      const result = await fetchBranch(git as never, branch)

      expect(result.ok).toBe(true)
      expect(result.message).toContain('Fetched origin/feat/widgets')
      // The upstream prefix `origin/` is stripped so fetch gets the
      // bare ref name as its refspec source.
      expect(git.raw).toHaveBeenCalledWith(['fetch', 'origin', 'feat/widgets'])
    })

    it('falls back to the bare upstream when the prefix is unusual', async () => {
      const git = { raw: jest.fn().mockResolvedValue('') }
      // An upstream that doesn't start with `<remote>/` (rare but
      // theoretically possible via setUpstream targeting a weird ref).
      const branch = localBranch({
        shortName: 'feat/widgets',
        upstream: 'odd-ref-name',
        remote: 'origin',
      })

      await fetchBranch(git as never, branch)
      expect(git.raw).toHaveBeenCalledWith(['fetch', 'origin', 'odd-ref-name'])
    })

    it('refuses when the branch has no upstream', async () => {
      const git = { raw: jest.fn() }
      const branch = localBranch({ shortName: 'local-only' })

      const result = await fetchBranch(git as never, branch)
      expect(result.ok).toBe(false)
      expect(result.message).toContain('no upstream')
      expect(git.raw).not.toHaveBeenCalled()
    })
  })

  describe('pullBranch', () => {
    it('defers to pullCurrentBranch when the cursored branch IS the current branch', async () => {
      const git = { raw: jest.fn().mockResolvedValue('') }
      const branch = localBranch({
        shortName: 'main',
        upstream: 'origin/main',
        remote: 'origin',
        current: true,
      })

      const result = await pullBranch(git as never, branch, 'main')

      expect(result.ok).toBe(true)
      // Should hit the standard pull --ff-only path.
      expect(git.raw).toHaveBeenCalledWith(['pull', '--ff-only'])
    })

    it('uses fetch <remote> <ref>:<branch> refspec for non-current branches', async () => {
      const git = { raw: jest.fn().mockResolvedValue('') }
      const branch = localBranch({
        shortName: 'feat/widgets',
        upstream: 'origin/feat/widgets',
        remote: 'origin',
        current: false,
      })

      const result = await pullBranch(git as never, branch, 'main')

      expect(result.ok).toBe(true)
      expect(result.message).toContain('Fast-forwarded feat/widgets')
      // Refspec form: source ref colon dest ref. Git refuses non-FF
      // updates with this form, which is what we want.
      expect(git.raw).toHaveBeenCalledWith([
        'fetch',
        'origin',
        'feat/widgets:feat/widgets',
      ])
    })

    it('refuses when the branch has no upstream', async () => {
      const git = { raw: jest.fn() }
      const branch = localBranch({ shortName: 'local-only' })

      const result = await pullBranch(git as never, branch, 'main')
      expect(result.ok).toBe(false)
      expect(result.message).toContain('no upstream')
      expect(git.raw).not.toHaveBeenCalled()
    })

    it('refuses for remote-type branch refs', async () => {
      const git = { raw: jest.fn() }
      const result = await pullBranch(git as never, remoteBranch(), 'main')
      expect(result.ok).toBe(false)
      expect(result.message).toContain('Only local branches')
      expect(git.raw).not.toHaveBeenCalled()
    })
  })
})
