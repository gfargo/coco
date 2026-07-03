import {
    abortOperation,
    continueOperation,
    operationActionTestInternals,
    resolveConflictKeepCurrentBranch,
    resolveConflictKeepIncoming,
    resolveConflictOurs,
    resolveConflictTheirs,
    skipOperation,
    stageConflictResolved,
} from './operationActions'

describe('log operation actions', () => {
  it('constructs continue, abort, and skip commands for rebase operations', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue(''),
    }

    await expect(continueOperation(git as never, 'rebase')).resolves.toEqual({
      ok: true,
      message: 'Continued rebase',
    })
    await expect(abortOperation(git as never, 'rebase')).resolves.toEqual({
      ok: true,
      message: 'Aborted rebase',
    })
    await expect(skipOperation(git as never, 'rebase')).resolves.toEqual({
      ok: true,
      message: 'Skipped rebase',
    })

    expect(git.raw).toHaveBeenNthCalledWith(1, ['rebase', '--continue'])
    expect(git.raw).toHaveBeenNthCalledWith(2, ['rebase', '--abort'])
    expect(git.raw).toHaveBeenNthCalledWith(3, ['rebase', '--skip'])
  })

  it('uses merge-specific continue and abort commands', async () => {
    expect(operationActionTestInternals.getOperationCommand('merge', 'continue')).toEqual({
      args: ['merge', '--continue'],
      successMessage: 'Continued merge',
    })
    expect(operationActionTestInternals.getOperationCommand('merge', 'abort')).toEqual({
      args: ['merge', '--abort'],
      successMessage: 'Aborted merge',
    })
    expect(operationActionTestInternals.getOperationCommand('merge', 'skip')).toBeUndefined()
  })

  it('blocks actions when no operation is active', async () => {
    const git = {
      raw: jest.fn(),
    }

    await expect(continueOperation(git as never, 'none')).resolves.toEqual({
      ok: false,
      message: 'No in-progress Git operation to continue.',
    })
    await expect(abortOperation(git as never, 'none')).resolves.toEqual({
      ok: false,
      message: 'No in-progress Git operation to abort.',
    })
    expect(git.raw).not.toHaveBeenCalled()
  })

  it('returns readable command failures', async () => {
    const git = {
      raw: jest.fn().mockRejectedValue(new Error('conflicts remain\nfix conflict.ts first')),
    }

    await expect(continueOperation(git as never, 'merge')).resolves.toEqual({
      ok: false,
      message: 'conflicts remain',
      details: ['fix conflict.ts first'],
    })
  })

  describe('conflict resolution actions', () => {
    it('resolveConflictOurs checks out ours and stages the file', async () => {
      const git = { raw: jest.fn().mockResolvedValue('') }

      const result = await resolveConflictOurs(git as never, 'src/conflict.ts')

      expect(result).toEqual({ ok: true, message: 'Resolved src/conflict.ts (kept ours)' })
      expect(git.raw).toHaveBeenCalledWith(['checkout', '--ours', '--', 'src/conflict.ts'])
      expect(git.raw).toHaveBeenCalledWith(['add', '--', 'src/conflict.ts'])
    })

    it('resolveConflictTheirs checks out theirs and stages the file', async () => {
      const git = { raw: jest.fn().mockResolvedValue('') }

      const result = await resolveConflictTheirs(git as never, 'src/conflict.ts')

      expect(result).toEqual({ ok: true, message: 'Resolved src/conflict.ts (kept theirs)' })
      expect(git.raw).toHaveBeenCalledWith(['checkout', '--theirs', '--', 'src/conflict.ts'])
      expect(git.raw).toHaveBeenCalledWith(['add', '--', 'src/conflict.ts'])
    })

    // Intent mapping: during merge/cherry-pick/revert HEAD is the user's
    // branch (--ours == "yours"); during a rebase git replays the user's
    // commits onto the upstream, so the sides swap. The keys promise
    // intent ("keep yours" / "keep incoming"), so the resolvers must pick
    // the flag per operation — the old direct wiring wrote and staged the
    // upstream's version when the user asked for their own mid-rebase.
    it('keep-current-branch uses --ours on merge/cherry-pick and --theirs on rebase', async () => {
      const merge = { raw: jest.fn().mockResolvedValue('') }
      await resolveConflictKeepCurrentBranch(merge as never, 'merge', 'src/conflict.ts')
      expect(merge.raw).toHaveBeenCalledWith(['checkout', '--ours', '--', 'src/conflict.ts'])

      const cherryPick = { raw: jest.fn().mockResolvedValue('') }
      await resolveConflictKeepCurrentBranch(cherryPick as never, 'cherry-pick', 'src/conflict.ts')
      expect(cherryPick.raw).toHaveBeenCalledWith(['checkout', '--ours', '--', 'src/conflict.ts'])

      const rebase = { raw: jest.fn().mockResolvedValue('') }
      await resolveConflictKeepCurrentBranch(rebase as never, 'rebase', 'src/conflict.ts')
      expect(rebase.raw).toHaveBeenCalledWith(['checkout', '--theirs', '--', 'src/conflict.ts'])
    })

    it('keep-incoming uses --theirs on merge and --ours on rebase', async () => {
      const merge = { raw: jest.fn().mockResolvedValue('') }
      await resolveConflictKeepIncoming(merge as never, 'merge', 'src/conflict.ts')
      expect(merge.raw).toHaveBeenCalledWith(['checkout', '--theirs', '--', 'src/conflict.ts'])

      const rebase = { raw: jest.fn().mockResolvedValue('') }
      await resolveConflictKeepIncoming(rebase as never, 'rebase', 'src/conflict.ts')
      expect(rebase.raw).toHaveBeenCalledWith(['checkout', '--ours', '--', 'src/conflict.ts'])
    })

    it('stageConflictResolved stages the file to mark it resolved', async () => {
      const git = { raw: jest.fn().mockResolvedValue('') }

      const result = await stageConflictResolved(git as never, 'src/conflict.ts')

      expect(result).toEqual({ ok: true, message: 'Staged src/conflict.ts (marked resolved)' })
      expect(git.raw).toHaveBeenCalledWith(['add', '--', 'src/conflict.ts'])
    })

    it('resolveConflictOurs reports failures from git', async () => {
      const git = { raw: jest.fn().mockRejectedValue(new Error('error: path not found')) }

      const result = await resolveConflictOurs(git as never, 'missing.ts')

      expect(result.ok).toBe(false)
      expect(result.message).toContain('error: path not found')
    })

    it('resolveConflictTheirs reports failures from git', async () => {
      const git = { raw: jest.fn().mockRejectedValue(new Error('error: path not found')) }

      const result = await resolveConflictTheirs(git as never, 'missing.ts')

      expect(result.ok).toBe(false)
      expect(result.message).toContain('error: path not found')
    })
  })
})
