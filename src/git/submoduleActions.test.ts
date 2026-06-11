import { SubmoduleEntry } from './submoduleData'
import { initSubmodule, syncSubmodule, updateSubmodule } from './submoduleActions'

const entry: SubmoduleEntry = {
  name: 'vendor-lib',
  path: 'vendor/lib',
  pinnedSha: 'abc1234',
  flag: 'uninitialized',
  trackingBranch: 'main',
  url: 'https://example.com/vendor/lib.git',
}

describe('submodule actions', () => {
  it('inits, updates, and syncs a submodule scoped by path', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }

    await initSubmodule(git as never, entry)
    await updateSubmodule(git as never, entry, { init: true })
    await syncSubmodule(git as never, entry)

    expect(git.raw).toHaveBeenNthCalledWith(1, ['submodule', 'init', '--', 'vendor/lib'])
    expect(git.raw).toHaveBeenNthCalledWith(2, ['submodule', 'update', '--init', '--', 'vendor/lib'])
    expect(git.raw).toHaveBeenNthCalledWith(3, ['submodule', 'sync', '--', 'vendor/lib'])
  })

  it('omits --init on a plain update', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }

    await updateSubmodule(git as never, entry)

    expect(git.raw).toHaveBeenCalledWith(['submodule', 'update', '--', 'vendor/lib'])
  })

  it('returns friendly success messages', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }

    await expect(initSubmodule(git as never, entry)).resolves.toEqual({
      ok: true,
      message: 'Initialized vendor-lib',
    })
    await expect(updateSubmodule(git as never, entry, { init: true })).resolves.toEqual({
      ok: true,
      message: 'Updated vendor-lib',
    })
    await expect(syncSubmodule(git as never, entry)).resolves.toEqual({
      ok: true,
      message: 'Synced vendor-lib URL',
    })
  })

  it('maps a git failure to an error result', async () => {
    const git = {
      raw: jest.fn().mockRejectedValue(new Error('boom')),
    }

    await expect(initSubmodule(git as never, entry)).resolves.toEqual({
      ok: false,
      message: 'boom',
    })
  })

  it('refuses to act when the entry has no path', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }
    const pathless = { ...entry, path: '' }

    await expect(initSubmodule(git as never, pathless)).resolves.toEqual({
      ok: false,
      message: 'No submodule selected.',
    })
    await expect(updateSubmodule(git as never, pathless)).resolves.toEqual({
      ok: false,
      message: 'No submodule selected.',
    })
    await expect(syncSubmodule(git as never, pathless)).resolves.toEqual({
      ok: false,
      message: 'No submodule selected.',
    })
    expect(git.raw).not.toHaveBeenCalled()
  })
})
