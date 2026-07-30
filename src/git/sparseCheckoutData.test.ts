import { SimpleGit } from 'simple-git'
import { getSparseCheckoutStatus } from './sparseCheckoutData'

jest.mock('fs', () => {
  const actual = jest.requireActual('fs')
  return {
    ...actual,
    existsSync: jest.fn().mockReturnValue(false),
    readFileSync: jest.fn(),
  }
})

import { existsSync, readFileSync } from 'fs'
const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>
const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>

function makeGit(overrides: {
  sparseConfig?: string
  gitPath?: string
  coneConfig?: string
  rawImpl?: (args: string[]) => Promise<string>
}): SimpleGit {
  const raw = jest.fn(async (args: string[]) => {
    if (overrides.rawImpl) return overrides.rawImpl(args)
    if (args[0] === 'config' && args[2] === 'core.sparseCheckout') {
      if (overrides.sparseConfig === undefined) throw new Error('unset config')
      return overrides.sparseConfig
    }
    if (args[0] === 'config' && args[2] === 'core.sparseCheckoutCone') {
      if (overrides.coneConfig === undefined) throw new Error('unset config')
      return overrides.coneConfig
    }
    if (args[0] === 'rev-parse' && args[1] === '--git-path') {
      return overrides.gitPath ?? '/repo/.git/info/sparse-checkout\n'
    }
    throw new Error(`unexpected raw call: ${args.join(' ')}`)
  })
  return { raw } as unknown as SimpleGit
}

describe('getSparseCheckoutStatus', () => {
  beforeEach(() => {
    mockExistsSync.mockReset()
    mockExistsSync.mockReturnValue(false)
    mockReadFileSync.mockReset()
  })

  it('returns enabled with pattern count when config is true and the file exists', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('/foo\n/bar\n# comment\n\n/baz\n')
    const git = makeGit({ sparseConfig: 'true\n', coneConfig: 'true\n' })

    const status = await getSparseCheckoutStatus(git)

    expect(status).toEqual({ enabled: true, cone: true, patternCount: 3 })
  })

  it('returns EMPTY_STATUS when core.sparseCheckout is false', async () => {
    const git = makeGit({ sparseConfig: 'false\n' })

    const status = await getSparseCheckoutStatus(git)

    expect(status).toEqual({ enabled: false, cone: false, patternCount: 0 })
    expect(mockExistsSync).not.toHaveBeenCalled()
  })

  it('returns EMPTY_STATUS when config is true but the pattern file does not exist', async () => {
    mockExistsSync.mockReturnValue(false)
    const git = makeGit({ sparseConfig: 'true\n' })

    const status = await getSparseCheckoutStatus(git)

    expect(status).toEqual({ enabled: false, cone: false, patternCount: 0 })
  })

  it('reflects cone: false when core.sparseCheckoutCone is unset', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('/foo\n')
    const git = makeGit({ sparseConfig: 'true\n' })

    const status = await getSparseCheckoutStatus(git)

    expect(status).toEqual({ enabled: true, cone: false, patternCount: 1 })
  })

  it('ignores blank lines and comment lines when counting patterns', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('\n# a comment\n  \n/only-real-pattern\n')
    const git = makeGit({ sparseConfig: 'true\n' })

    const status = await getSparseCheckoutStatus(git)

    expect(status.patternCount).toBe(1)
  })

  it('never throws — returns EMPTY_STATUS when git.raw rejects', async () => {
    const git = makeGit({ rawImpl: async () => { throw new Error('not a git repo') } })

    const status = await getSparseCheckoutStatus(git)

    expect(status).toEqual({ enabled: false, cone: false, patternCount: 0 })
  })

  it('returns EMPTY_STATUS when --git-path yields an empty path', async () => {
    mockExistsSync.mockReturnValue(true)
    const git = makeGit({ sparseConfig: 'true\n', gitPath: '\n' })

    const status = await getSparseCheckoutStatus(git)

    expect(status).toEqual({ enabled: false, cone: false, patternCount: 0 })
  })
})
