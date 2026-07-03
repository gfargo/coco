import {
  checkoutBranch,
  createBranch,
  deleteBranch,
  isBranchCheckedOutElsewhereError,
  isBranchNotFullyMergedError,
  parseCheckedOutWorktreePath,
  fetchBranch,
  fetchRemotes,
  getBranchActionRefs,
  pullBranch,
  pullCurrentBranch,
  pushBranch,
  pushCurrentBranch,
  renameBranch,
  setUpstream,
  forcePushBranch,
  forcePushCurrentBranch,
  isDivergedPullError,
  isNonFastForwardPushError,
  pullCurrentBranchMerge,
  pullCurrentBranchRebase,
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

    expect(git.raw).toHaveBeenNthCalledWith(1, ['switch', '-c', 'feature/new', 'abc1234'])
    expect(git.raw).toHaveBeenNthCalledWith(2, ['branch', '-m', 'feature/old', 'feature/new'])
    expect(git.raw).toHaveBeenNthCalledWith(3, ['branch', '-d', 'feature/test'])
    expect(git.raw).toHaveBeenNthCalledWith(4, ['fetch', '--all', '--prune'])
    expect(git.raw).toHaveBeenNthCalledWith(5, ['pull', '--ff-only'])
  })

  describe('deleteBranch force', () => {
    it('uses -d (safe) by default and -D when forced', async () => {
      const git = { raw: jest.fn().mockResolvedValue('') }

      await expect(deleteBranch(git as never, localBranch())).resolves.toEqual({
        ok: true,
        message: 'Deleted branch feature/test',
      })
      expect(git.raw).toHaveBeenLastCalledWith(['branch', '-d', 'feature/test'])

      await expect(deleteBranch(git as never, localBranch(), true)).resolves.toEqual({
        ok: true,
        message: 'Force-deleted branch feature/test',
      })
      expect(git.raw).toHaveBeenLastCalledWith(['branch', '-D', 'feature/test'])
    })

    it('surfaces the not-fully-merged failure as a recoverable result', async () => {
      const git = {
        raw: jest.fn().mockRejectedValue(
          new Error("error: the branch 'feature/test' is not fully merged.")
        ),
      }
      const result = await deleteBranch(git as never, localBranch())
      expect(result.ok).toBe(false)
      expect(isBranchNotFullyMergedError(result.message)).toBe(true)
    })
  })

  describe('force-push with lease (#1356)', () => {
    it('force-pushes the current branch with lease', async () => {
      const git = { raw: jest.fn().mockResolvedValue('') }
      await expect(forcePushCurrentBranch(git as never)).resolves.toEqual({
        ok: true,
        message: 'Force-pushed current branch (with lease)',
      })
      expect(git.raw).toHaveBeenCalledWith(['push', '--force-with-lease'])
    })

    it('force-pushes the cursored branch to its remote', async () => {
      const git = { raw: jest.fn().mockResolvedValue('') }
      const branch = localBranch({ upstream: 'origin/feature/test', remote: 'origin' })
      await expect(forcePushBranch(git as never, branch)).resolves.toEqual({
        ok: true,
        message: 'Force-pushed feature/test to origin/feature/test (with lease)',
      })
      expect(git.raw).toHaveBeenCalledWith(['push', '--force-with-lease', 'origin', 'feature/test'])
    })

    it('refuses remote branches and upstream-less branches without calling git', async () => {
      const git = { raw: jest.fn() }
      await expect(forcePushBranch(git as never, remoteBranch())).resolves.toMatchObject({ ok: false })
      await expect(forcePushBranch(git as never, localBranch())).resolves.toMatchObject({ ok: false })
      expect(git.raw).not.toHaveBeenCalled()
    })
  })

  describe('diverged pull recovery (#1356)', () => {
    it('pulls with rebase / merge', async () => {
      const git = { raw: jest.fn().mockResolvedValue('') }
      await pullCurrentBranchRebase(git as never)
      expect(git.raw).toHaveBeenCalledWith(['pull', '--rebase'])
      await pullCurrentBranchMerge(git as never)
      expect(git.raw).toHaveBeenCalledWith(['pull', '--no-rebase'])
    })
  })

  describe('isNonFastForwardPushError', () => {
    it('matches the rejection phrasings across git versions', () => {
      expect(isNonFastForwardPushError('! [rejected] main -> main (non-fast-forward)')).toBe(true)
      expect(isNonFastForwardPushError('hint: Updates were rejected... (e.g., git pull ...) fetch first')).toBe(true)
      expect(isNonFastForwardPushError('! [rejected] main -> main (stale info)')).toBe(true)
      expect(isNonFastForwardPushError("error: failed to push some refs to 'origin'")).toBe(true)
      expect(isNonFastForwardPushError('Everything up-to-date')).toBe(false)
      expect(isNonFastForwardPushError(undefined)).toBe(false)
    })
  })

  describe('isDivergedPullError', () => {
    it('matches the ff-only refusal but NOT the fetch-refspec rejection', () => {
      expect(isDivergedPullError('fatal: Not possible to fast-forward, aborting.')).toBe(true)
      expect(isDivergedPullError('hint: You have divergent branches...have diverged')).toBe(true)
      // Non-current-branch pulls fail via fetch refspec — the rebase/merge
      // choice doesn't apply there, so the predicate must not match.
      expect(isDivergedPullError('! [rejected] main -> main (non-fast-forward)')).toBe(false)
      expect(isDivergedPullError(undefined)).toBe(false)
    })
  })

  describe('isBranchNotFullyMergedError', () => {
    it('matches git\'s unmerged wording and nothing unrelated', () => {
      expect(isBranchNotFullyMergedError("error: the branch 'x' is not fully merged.")).toBe(true)
      expect(isBranchNotFullyMergedError('Not Fully Merged')).toBe(true)
      expect(isBranchNotFullyMergedError('Cannot delete the current branch.')).toBe(false)
      expect(isBranchNotFullyMergedError(undefined)).toBe(false)
    })
  })

  describe('isBranchCheckedOutElsewhereError', () => {
    it('matches git\'s worktree-checkout rejection wording', () => {
      expect(
        isBranchCheckedOutElsewhereError("error: Cannot delete branch 'feat/x' checked out at '/repo/.wt/foo'")
      ).toBe(true)
      expect(
        isBranchCheckedOutElsewhereError("fatal: 'feat/x' is already used by worktree at '/repo/wt'")
      ).toBe(true)
      // Distinct from the unmerged case, which has its own force-delete path.
      expect(isBranchCheckedOutElsewhereError("the branch 'x' is not fully merged.")).toBe(false)
      expect(isBranchCheckedOutElsewhereError(undefined)).toBe(false)
    })
  })

  describe('parseCheckedOutWorktreePath', () => {
    it('extracts the worktree path from either git phrasing', () => {
      expect(
        parseCheckedOutWorktreePath("Cannot delete branch 'feat/x' checked out at '/repo/.wt/foo'")
      ).toBe('/repo/.wt/foo')
      expect(
        parseCheckedOutWorktreePath("'feat/x' is already used by worktree at '/repo/wt'")
      ).toBe('/repo/wt')
    })

    it('returns undefined when the message carries no path', () => {
      expect(parseCheckedOutWorktreePath('checked out somewhere')).toBeUndefined()
      expect(parseCheckedOutWorktreePath(undefined)).toBeUndefined()
    })
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

    it('pushes with -u to create+track when the branch has no upstream', async () => {
      const git = {
        raw: jest.fn().mockResolvedValue(''),
        getRemotes: jest.fn().mockResolvedValue([{ name: 'origin' }]),
      }
      const branch = localBranch({ shortName: 'local-only' })

      const result = await pushBranch(git as never, branch)

      expect(result.ok).toBe(true)
      expect(result.message).toContain('set upstream to origin/local-only')
      expect(git.raw).toHaveBeenCalledWith(['push', '-u', 'origin', 'local-only'])
    })

    it('refuses when there is no upstream and no remote configured', async () => {
      const git = { raw: jest.fn(), getRemotes: jest.fn().mockResolvedValue([]) }
      const branch = localBranch({ shortName: 'local-only' })

      const result = await pushBranch(git as never, branch)

      expect(result.ok).toBe(false)
      expect(result.message).toContain('no remote is configured')
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

  describe('pushCurrentBranch', () => {
    it('pushes plainly when the current branch already has an upstream', async () => {
      const git = { raw: jest.fn().mockResolvedValue('') }

      const result = await pushCurrentBranch(git as never)

      expect(result.ok).toBe(true)
      expect(git.raw).toHaveBeenCalledWith(['push'])
    })

    it('pushes with -u when the current branch has no upstream yet', async () => {
      const git = {
        raw: jest
          .fn()
          .mockRejectedValueOnce(new Error('no upstream configured')) // rev-parse @{upstream}
          .mockResolvedValueOnce('feat/new\n') // rev-parse HEAD
          .mockResolvedValue(''), // push -u
        getRemotes: jest.fn().mockResolvedValue([{ name: 'origin' }]),
      }

      const result = await pushCurrentBranch(git as never)

      expect(result.ok).toBe(true)
      expect(result.message).toContain('set upstream to origin/feat/new')
      expect(git.raw).toHaveBeenCalledWith(['push', '-u', 'origin', 'feat/new'])
    })
  })

  describe('setUpstream', () => {
    it('links to an existing remote-tracking branch', async () => {
      const git = {
        raw: jest.fn().mockResolvedValue(''), // show-ref (exists) + set-upstream-to
        getRemotes: jest.fn().mockResolvedValue([{ name: 'origin' }]),
      }

      const result = await setUpstream(git as never, 'feature/x', 'origin/feature/x')

      expect(result.ok).toBe(true)
      expect(git.raw).toHaveBeenCalledWith([
        'branch',
        '--set-upstream-to',
        'origin/feature/x',
        'feature/x',
      ])
    })

    it('pushes -u to create the remote branch when it does not exist yet', async () => {
      const git = {
        raw: jest
          .fn()
          .mockRejectedValueOnce(new Error('not a valid ref')) // show-ref (missing)
          .mockResolvedValue(''), // push -u
        getRemotes: jest.fn().mockResolvedValue([{ name: 'origin' }]),
      }

      // Bare `main` defaults to origin/main; the remote branch is absent
      // so we push -u rather than silently mis-setting the local ref.
      const result = await setUpstream(git as never, 'main', 'main')

      expect(result.ok).toBe(true)
      expect(result.message).toContain('set upstream')
      expect(git.raw).toHaveBeenCalledWith(['push', '-u', 'origin', 'main:main'])
    })

    it('refuses when no remote is configured', async () => {
      const git = { raw: jest.fn(), getRemotes: jest.fn().mockResolvedValue([]) }

      const result = await setUpstream(git as never, 'main', 'main')

      expect(result.ok).toBe(false)
      expect(result.message).toContain('No remote configured')
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
