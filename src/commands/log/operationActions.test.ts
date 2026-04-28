import {
  abortOperation,
  continueOperation,
  operationActionTestInternals,
  skipOperation,
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
})
