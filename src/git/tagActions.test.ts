import {
  createAnnotatedTag,
  createLightweightTag,
  deleteLocalTag,
  deleteRemoteTag,
  pushTag,
} from './tagActions'

describe('log tag actions', () => {
  it('uses explicit git commands for tag creation and deletion', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue(''),
    }

    await createLightweightTag(git as never, '0.34.0', 'abc1234')
    await createAnnotatedTag(git as never, '0.34.0', 'abc1234', 'release v0.34.0')
    await deleteLocalTag(git as never, '0.34.0')
    await pushTag(git as never, '0.34.0')
    await deleteRemoteTag(git as never, '0.34.0')

    expect(git.raw).toHaveBeenNthCalledWith(1, ['tag', '0.34.0', 'abc1234'])
    expect(git.raw).toHaveBeenNthCalledWith(2, [
      'tag',
      '-a',
      '0.34.0',
      'abc1234',
      '-m',
      'release v0.34.0',
    ])
    expect(git.raw).toHaveBeenNthCalledWith(3, ['tag', '-d', '0.34.0'])
    // Remote-side refspecs stay fully qualified. The bare forms are
    // ambiguous against a same-named remote branch: push errors with
    // "matches more than one", and delete resolves against ANY matching
    // ref — `:0.34.0` deleted a remote BRANCH named 0.34.0 when the tag
    // itself had never been pushed.
    expect(git.raw).toHaveBeenNthCalledWith(4, ['push', 'origin', 'refs/tags/0.34.0'])
    expect(git.raw).toHaveBeenNthCalledWith(5, ['push', 'origin', ':refs/tags/0.34.0'])
  })
})
