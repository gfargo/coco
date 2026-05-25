import { applyStash, createStash, dropStash, popStash } from './stashActions'
import { StashEntry } from './stashData'

const stash: StashEntry = {
  ref: 'stash@{0}',
  hash: 'abc123',
  baseHash: 'base111',
  date: '2026-04-28',
  branch: 'main',
  message: 'save docs',
  files: ['src/a.ts'],
}

describe('log stash actions', () => {
  it('creates, applies, pops, and drops stashes with explicit refs', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue(''),
    }

    await createStash(git as never, ' save docs ')
    await applyStash(git as never, stash)
    await popStash(git as never, stash)
    await dropStash(git as never, stash)

    expect(git.raw).toHaveBeenNthCalledWith(1, ['stash', 'push', '-u', '-m', 'save docs'])
    expect(git.raw).toHaveBeenNthCalledWith(2, ['stash', 'apply', 'stash@{0}'])
    expect(git.raw).toHaveBeenNthCalledWith(3, ['stash', 'pop', 'stash@{0}'])
    expect(git.raw).toHaveBeenNthCalledWith(4, ['stash', 'drop', 'stash@{0}'])
  })

  it('rejects empty stash messages before invoking git', async () => {
    const git = {
      raw: jest.fn(),
    }

    await expect(createStash(git as never, '   ')).resolves.toEqual({
      ok: false,
      message: 'Stash cancelled: empty message.',
    })
    expect(git.raw).not.toHaveBeenCalled()
  })
})
