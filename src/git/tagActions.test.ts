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
      getRemotes: jest.fn().mockResolvedValue([{ name: 'origin' }]),
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

  it('falls back to the first remote when origin is not configured', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue(''),
      getRemotes: jest.fn().mockResolvedValue([{ name: 'upstream' }]),
    }

    await pushTag(git as never, 'v1.0.0')
    await deleteRemoteTag(git as never, 'v1.0.0')

    expect(git.raw).toHaveBeenNthCalledWith(1, ['push', 'upstream', 'refs/tags/v1.0.0'])
    expect(git.raw).toHaveBeenNthCalledWith(2, ['push', 'upstream', ':refs/tags/v1.0.0'])
  })

  it('returns an error result when no remote is configured', async () => {
    const git = {
      raw: jest.fn(),
      getRemotes: jest.fn().mockResolvedValue([]),
    }

    const pushResult = await pushTag(git as never, 'v1.0.0')
    const deleteResult = await deleteRemoteTag(git as never, 'v1.0.0')

    expect(pushResult).toEqual({ ok: false, message: 'No remote configured — cannot push tag.' })
    expect(deleteResult).toEqual({ ok: false, message: 'No remote configured — cannot delete remote tag.' })
    expect(git.raw).not.toHaveBeenCalled()
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
