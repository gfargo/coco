import {
  amendHeadCommit,
  historyActionTestInternals,
  rewordHeadCommit,
} from './historyActions'

describe('log history actions', () => {
  it('matches full and short selected hashes against HEAD', async () => {
    const git = {
      revparse: jest.fn().mockResolvedValue('abcdef1234567890\n'),
    }

    await expect(historyActionTestInternals.isHeadCommit(git as never, 'abcdef1234567890')).resolves.toBe(true)
    await expect(historyActionTestInternals.isHeadCommit(git as never, 'abcdef1')).resolves.toBe(true)
    await expect(historyActionTestInternals.isHeadCommit(git as never, '1234567')).resolves.toBe(false)
  })

  it('amends HEAD with staged changes', async () => {
    const git = {
      revparse: jest.fn().mockResolvedValue('abcdef1234567890'),
      raw: jest.fn().mockResolvedValue(''),
    }

    await expect(amendHeadCommit(git as never, 'abcdef1')).resolves.toEqual({
      ok: true,
      message: 'Amended HEAD with staged changes',
    })

    expect(git.raw).toHaveBeenCalledWith(['commit', '--amend', '--no-edit'])
  })

  it('rewords HEAD with a trimmed message', async () => {
    const git = {
      revparse: jest.fn().mockResolvedValue('abcdef1234567890'),
      raw: jest.fn().mockResolvedValue(''),
    }

    await expect(rewordHeadCommit(git as never, 'abcdef1', '  feat: better title  ')).resolves.toEqual({
      ok: true,
      message: 'Reworded HEAD commit',
    })

    expect(git.raw).toHaveBeenCalledWith(['commit', '--amend', '-m', 'feat: better title'])
  })

  it('guards non-HEAD history edits', async () => {
    const git = {
      revparse: jest.fn().mockResolvedValue('abcdef1234567890'),
      raw: jest.fn(),
    }

    await expect(amendHeadCommit(git as never, '1234567')).resolves.toEqual({
      ok: false,
      message: 'Amend is limited to HEAD. Select the latest commit first.',
    })
    await expect(rewordHeadCommit(git as never, '1234567', 'feat: title')).resolves.toEqual({
      ok: false,
      message: 'Reword is limited to HEAD. Select the latest commit first.',
    })
    expect(git.raw).not.toHaveBeenCalled()
  })

  it('rejects empty reword messages before invoking git', async () => {
    const git = {
      revparse: jest.fn().mockResolvedValue('abcdef1234567890'),
      raw: jest.fn(),
    }

    await expect(rewordHeadCommit(git as never, 'abcdef1', '   ')).resolves.toEqual({
      ok: false,
      message: 'Reword cancelled: empty message.',
    })
    expect(git.raw).not.toHaveBeenCalled()
  })
})
