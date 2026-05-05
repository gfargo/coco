import { SimpleGit } from 'simple-git'
import { getCurrentBranchName } from './getCurrentBranchName'

function mockGit(overrides: Partial<{
  revparse: jest.Mock
  raw: jest.Mock
}> = {}): SimpleGit {
  return {
    revparse: overrides.revparse || jest.fn().mockResolvedValue('main'),
    raw: overrides.raw || jest.fn(),
  } as unknown as SimpleGit
}

describe('getCurrentBranchName', () => {
  it('returns the current branch name from rev-parse on a normal repo', async () => {
    const git = mockGit()
    expect(await getCurrentBranchName({ git })).toBe('main')
    expect(git.revparse).toHaveBeenCalledWith(['--abbrev-ref', 'HEAD'])
  })

  // #844 — `git rev-parse --abbrev-ref HEAD` fails fatally on a fresh
  // `git init` repo with no commits yet. `git symbolic-ref --short
  // HEAD` still reports the configured initial branch in that state,
  // so the helper falls through to it instead of crashing the
  // entire commit pipeline (which has already run for minutes by
  // the time this branch lookup fires).
  it('falls back to symbolic-ref when rev-parse fails (initial-commit repo)', async () => {
    const git = mockGit({
      revparse: jest.fn().mockRejectedValue(
        new Error("fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.")
      ),
      raw: jest.fn().mockResolvedValue('main\n'),
    })
    expect(await getCurrentBranchName({ git })).toBe('main')
    expect(git.raw).toHaveBeenCalledWith(['symbolic-ref', '--short', 'HEAD'])
  })

  it('trims trailing whitespace from the symbolic-ref fallback output', async () => {
    const git = mockGit({
      revparse: jest.fn().mockRejectedValue(new Error('boom')),
      raw: jest.fn().mockResolvedValue('  main  \n'),
    })
    expect(await getCurrentBranchName({ git })).toBe('main')
  })

  it('returns an empty string when both rev-parse and symbolic-ref fail', async () => {
    const git = mockGit({
      revparse: jest.fn().mockRejectedValue(new Error('rev-parse blew up')),
      raw: jest.fn().mockRejectedValue(new Error('symbolic-ref blew up')),
    })
    expect(await getCurrentBranchName({ git })).toBe('')
  })

  it('does not call symbolic-ref when rev-parse succeeds', async () => {
    const raw = jest.fn()
    const git = mockGit({ raw })
    await getCurrentBranchName({ git })
    expect(raw).not.toHaveBeenCalled()
  })
})
