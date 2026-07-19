import {
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
    await deleteLocalTag(git as never, '0.34.0')
    await pushTag(git as never, '0.34.0')
    await deleteRemoteTag(git as never, '0.34.0')

    expect(git.raw).toHaveBeenNthCalledWith(1, ['tag', '0.34.0', 'abc1234'])
    expect(git.raw).toHaveBeenNthCalledWith(2, ['tag', '-d', '0.34.0'])
    // Remote-side refspecs stay fully qualified. The bare forms are
    // ambiguous against a same-named remote branch: push errors with
    // "matches more than one", and delete resolves against ANY matching
    // ref — `:0.34.0` deleted a remote BRANCH named 0.34.0 when the tag
    // itself had never been pushed.
    expect(git.raw).toHaveBeenNthCalledWith(3, ['push', 'origin', 'refs/tags/0.34.0'])
    expect(git.raw).toHaveBeenNthCalledWith(4, ['push', 'origin', ':refs/tags/0.34.0'])
  })

  it('rejects a flag-like tag name to avoid arg injection', async () => {
    const git = { raw: jest.fn() }

    await expect(createLightweightTag(git as never, '-d', 'abc1234')).resolves.toEqual({
      ok: false,
      message: "Tag name '-d' cannot start with '-'.",
    })
    await expect(deleteLocalTag(git as never, '-d')).resolves.toEqual({
      ok: false,
      message: "Tag name '-d' cannot start with '-'.",
    })
    expect(git.raw).not.toHaveBeenCalled()
  })
})
