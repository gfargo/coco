import * as path from 'node:path'

import { applyRepoFlag } from './applyRepoFlag'

jest.mock('../../lib/simple-git/getRepo', () => ({
  getRepo: jest.fn(),
}))

import { getRepo } from '../../lib/simple-git/getRepo'

const mockedGetRepo = getRepo as jest.MockedFunction<typeof getRepo>

describe('applyRepoFlag', () => {
  let originalCwd: string
  let chdirSpy: jest.SpyInstance

  beforeEach(() => {
    originalCwd = process.cwd()
    chdirSpy = jest.spyOn(process, 'chdir').mockImplementation(() => undefined)
    mockedGetRepo.mockReset()
    mockedGetRepo.mockReturnValue({} as ReturnType<typeof getRepo>)
  })

  afterEach(() => {
    chdirSpy.mockRestore()
    // Reset cwd in case the real chdir slipped through.
    if (process.cwd() !== originalCwd) {
      try { process.chdir(originalCwd) } catch { /* noop */ }
    }
  })

  it('returns getRepo() (no baseDir) when --repo is omitted', () => {
    applyRepoFlag({ repo: undefined })

    expect(mockedGetRepo).toHaveBeenCalledWith()
    expect(chdirSpy).not.toHaveBeenCalled()
  })

  it('returns getRepo(absolutePath) and chdirs when --repo is set', () => {
    // An already-absolute input is passed through `path.resolve`, which
    // normalizes to the OS-native form (`/tmp/some-repo` on POSIX,
    // `<drive>:\tmp\some-repo` on Windows). Build the expectation the
    // same way so the assertion holds on every platform.
    const repo = path.resolve('/tmp/some-repo')
    applyRepoFlag({ repo })

    expect(chdirSpy).toHaveBeenCalledTimes(1)
    expect(chdirSpy).toHaveBeenCalledWith(repo)
    expect(mockedGetRepo).toHaveBeenCalledWith(repo)
  })

  it('resolves a relative --repo path to absolute before chdir', () => {
    // Whatever cwd we're running in, a './fixture' relative path
    // should be resolved against it. We assert only that the chdir
    // target is absolute — testing the resolved value end-to-end
    // ties this to the runner's cwd, which is brittle.
    applyRepoFlag({ repo: './fixture' })

    expect(chdirSpy).toHaveBeenCalledTimes(1)
    const target = chdirSpy.mock.calls[0][0] as string
    // Assert it was resolved to an absolute, OS-native path ending in
    // `fixture` — without pinning the POSIX separator so this holds on
    // Windows too.
    expect(path.isAbsolute(target)).toBe(true)
    expect(path.basename(target)).toBe('fixture')
    expect(mockedGetRepo).toHaveBeenCalledWith(target)
  })

  it('does not chdir when --repo is an empty string', () => {
    // Empty string is treated the same as omitted — defensive guard
    // since yargs can produce `''` for flags that were set without
    // a value in some edge cases.
    applyRepoFlag({ repo: '' })

    expect(mockedGetRepo).toHaveBeenCalledWith()
    expect(chdirSpy).not.toHaveBeenCalled()
  })
})
