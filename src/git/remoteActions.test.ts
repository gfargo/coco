import { addRemote, pruneRemote, removeRemote, setRemoteUrl } from './remoteActions'

describe('remote actions', () => {
  it('adds, sets-url, removes, and prunes with the right argv', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }

    await addRemote(git as never, 'upstream', 'https://example.com/up.git')
    await setRemoteUrl(git as never, 'origin', 'git@github.com:me/fork.git')
    await removeRemote(git as never, 'upstream')
    await pruneRemote(git as never, 'origin')

    expect(git.raw).toHaveBeenNthCalledWith(1, [
      'remote', 'add', 'upstream', 'https://example.com/up.git',
    ])
    expect(git.raw).toHaveBeenNthCalledWith(2, [
      'remote', 'set-url', 'origin', 'git@github.com:me/fork.git',
    ])
    expect(git.raw).toHaveBeenNthCalledWith(3, ['remote', 'remove', 'upstream'])
    expect(git.raw).toHaveBeenNthCalledWith(4, ['remote', 'prune', 'origin'])
  })

  it('trims whitespace around name and url', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }
    await addRemote(git as never, '  upstream  ', '  https://example.com/up.git  ')
    expect(git.raw).toHaveBeenCalledWith([
      'remote', 'add', 'upstream', 'https://example.com/up.git',
    ])
  })

  it('returns friendly success messages', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }

    await expect(addRemote(git as never, 'upstream', 'https://up.git')).resolves.toEqual({
      ok: true,
      message: 'Added remote upstream',
    })
    await expect(setRemoteUrl(git as never, 'origin', 'https://o.git')).resolves.toEqual({
      ok: true,
      message: 'Set origin URL',
    })
    await expect(removeRemote(git as never, 'upstream')).resolves.toEqual({
      ok: true,
      message: 'Removed remote upstream',
    })
    await expect(pruneRemote(git as never, 'origin')).resolves.toEqual({
      ok: true,
      message: 'Pruned remote origin',
    })
  })

  it('maps a git failure to an error result', async () => {
    const git = { raw: jest.fn().mockRejectedValue(new Error('boom')) }
    await expect(addRemote(git as never, 'upstream', 'https://up.git')).resolves.toEqual({
      ok: false,
      message: 'boom',
    })
  })

  it('rejects an empty name without calling git', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }
    await expect(addRemote(git as never, '   ', 'https://up.git')).resolves.toEqual({
      ok: false,
      message: 'Remote name required.',
    })
    await expect(removeRemote(git as never, '')).resolves.toEqual({
      ok: false,
      message: 'Remote name required.',
    })
    await expect(pruneRemote(git as never, '')).resolves.toEqual({
      ok: false,
      message: 'Remote name required.',
    })
    expect(git.raw).not.toHaveBeenCalled()
  })

  it('rejects an empty url without calling git', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }
    await expect(addRemote(git as never, 'upstream', '  ')).resolves.toEqual({
      ok: false,
      message: 'Remote URL required.',
    })
    await expect(setRemoteUrl(git as never, 'origin', '')).resolves.toEqual({
      ok: false,
      message: 'Remote URL required.',
    })
    expect(git.raw).not.toHaveBeenCalled()
  })

  it('rejects a flag-like name to avoid arg injection', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }
    await expect(addRemote(git as never, '--mirror', 'https://up.git')).resolves.toEqual({
      ok: false,
      message: "Remote name '--mirror' cannot start with '-'.",
    })
    expect(git.raw).not.toHaveBeenCalled()
  })

  it('rejects a flag-like url to avoid arg injection', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }
    await expect(addRemote(git as never, 'upstream', '--upload-pack=evil')).resolves.toEqual({
      ok: false,
      message: "Remote URL '--upload-pack=evil' cannot start with '-'.",
    })
    expect(git.raw).not.toHaveBeenCalled()
  })
})
