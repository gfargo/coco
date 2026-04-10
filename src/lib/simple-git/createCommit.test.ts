import { SimpleGit, CommitResult, GitError } from 'simple-git'
import { createCommit, isPreCommitHookModifiedFilesError, PreCommitHookError } from './createCommit'

const mockCommitResult: CommitResult = {
  author: null,
  branch: 'main',
  commit: '123abc',
  root: false,
  summary: { changes: 1, deletions: 0, insertions: 1 },
}

function makeGit(commitImpl: jest.Mock, addImpl?: jest.Mock): SimpleGit {
  return {
    commit: commitImpl,
    add: addImpl ?? jest.fn().mockResolvedValue(undefined),
  } as unknown as SimpleGit
}

describe('isPreCommitHookModifiedFilesError', () => {
  it('returns true for "files were modified by this hook"', () => {
    const err = new Error('black...Failed\n- hook id: black\n- files were modified by this hook')
    expect(isPreCommitHookModifiedFilesError(err)).toBe(true)
  })

  it('returns true for "modified by this hook"', () => {
    const err = new Error('prettier modified by this hook')
    expect(isPreCommitHookModifiedFilesError(err)).toBe(true)
  })

  it('returns true when message contains "hook id:"', () => {
    const err = new Error('- hook id: trailing-whitespace\n- exit code: 1')
    expect(isPreCommitHookModifiedFilesError(err)).toBe(true)
  })

  it('returns false for unrelated git errors', () => {
    const err = new Error('nothing to commit, working tree clean')
    expect(isPreCommitHookModifiedFilesError(err)).toBe(false)
  })

  it('returns false for non-Error values', () => {
    expect(isPreCommitHookModifiedFilesError('string error')).toBe(false)
    expect(isPreCommitHookModifiedFilesError(null)).toBe(false)
  })
})

describe('PreCommitHookError', () => {
  it('is an instance of Error', () => {
    const err = new PreCommitHookError('ruff found 2 errors')
    expect(err).toBeInstanceOf(Error)
  })

  it('has name "PreCommitHookError"', () => {
    const err = new PreCommitHookError('ruff found 2 errors')
    expect(err.name).toBe('PreCommitHookError')
  })

  it('exposes hookOutput', () => {
    const output = '🔍 Running ruff...\nE402 Module level import\nFound 2 errors.'
    const err = new PreCommitHookError(output)
    expect(err.hookOutput).toBe(output)
  })

  it('includes hookOutput in message', () => {
    const output = 'ruff found errors'
    const err = new PreCommitHookError(output)
    expect(err.message).toBe('Pre-commit hook failed')
  })
})

describe('createCommit', () => {
  afterEach(() => jest.clearAllMocks())

  it('calls git.commit with the provided message', async () => {
    const commitMock = jest.fn().mockResolvedValue(mockCommitResult)
    const git = makeGit(commitMock)
    await createCommit('test commit', git)
    expect(commitMock).toHaveBeenCalledWith('test commit', [])
  })

  it('returns CommitResult on success', async () => {
    const commitMock = jest.fn().mockResolvedValue(mockCommitResult)
    const git = makeGit(commitMock)
    const result = await createCommit('test commit', git)
    expect(result).toEqual(mockCommitResult)
  })

  it('re-throws non-GitError errors', async () => {
    const err = new Error('nothing to commit')
    const commitMock = jest.fn().mockRejectedValue(err)
    const git = makeGit(commitMock)
    await expect(createCommit('test commit', git)).rejects.toThrow('nothing to commit')
  })

  it('wraps GitError as PreCommitHookError', async () => {
    const gitErr = new GitError(undefined, '🔍 Running ruff...\nFound 2 errors.')
    const commitMock = jest.fn().mockRejectedValue(gitErr)
    const git = makeGit(commitMock)
    await expect(createCommit('test commit', git)).rejects.toBeInstanceOf(PreCommitHookError)
  })

  it('preserves hook output in PreCommitHookError', async () => {
    const hookOutput = '🔍 Running ruff...\nFound 2 errors.'
    const gitErr = new GitError(undefined, hookOutput)
    const commitMock = jest.fn().mockRejectedValue(gitErr)
    const git = makeGit(commitMock)
    try {
      await createCommit('test commit', git)
      fail('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(PreCommitHookError)
      expect((err as PreCommitHookError).hookOutput).toBe(hookOutput)
    }
  })

  describe('noVerify option', () => {
    it('passes --no-verify flag when noVerify is true', async () => {
      const commitMock = jest.fn().mockResolvedValue(mockCommitResult)
      const git = makeGit(commitMock)
      await createCommit('test commit', git, undefined, { noVerify: true })
      expect(commitMock).toHaveBeenCalledWith('test commit', ['--no-verify'])
    })

    it('passes empty flags array when noVerify is false', async () => {
      const commitMock = jest.fn().mockResolvedValue(mockCommitResult)
      const git = makeGit(commitMock)
      await createCommit('test commit', git, undefined, { noVerify: false })
      expect(commitMock).toHaveBeenCalledWith('test commit', [])
    })

    it('passes empty flags array when options is omitted', async () => {
      const commitMock = jest.fn().mockResolvedValue(mockCommitResult)
      const git = makeGit(commitMock)
      await createCommit('test commit', git)
      expect(commitMock).toHaveBeenCalledWith('test commit', [])
    })
  })

  describe('pre-commit hook modifies files', () => {
    const hookError = new Error(
      'black...Failed\n- hook id: black\n- files were modified by this hook'
    )

    it('stages all files and retries the commit', async () => {
      const addMock = jest.fn().mockResolvedValue(undefined)
      const commitMock = jest
        .fn()
        .mockRejectedValueOnce(hookError)
        .mockResolvedValueOnce(mockCommitResult)
      const git = makeGit(commitMock, addMock)

      const result = await createCommit('test commit', git)

      expect(addMock).toHaveBeenCalledWith('.')
      expect(commitMock).toHaveBeenCalledTimes(2)
      expect(result).toEqual(mockCommitResult)
    })

    it('calls onHookModifiedFiles callback before retry', async () => {
      const onHookModifiedFiles = jest.fn()
      const addMock = jest.fn().mockResolvedValue(undefined)
      const commitMock = jest
        .fn()
        .mockRejectedValueOnce(hookError)
        .mockResolvedValueOnce(mockCommitResult)
      const git = makeGit(commitMock, addMock)

      await createCommit('test commit', git, onHookModifiedFiles)

      expect(onHookModifiedFiles).toHaveBeenCalledTimes(1)
    })

    it('works without an onHookModifiedFiles callback', async () => {
      const addMock = jest.fn().mockResolvedValue(undefined)
      const commitMock = jest
        .fn()
        .mockRejectedValueOnce(hookError)
        .mockResolvedValueOnce(mockCommitResult)
      const git = makeGit(commitMock, addMock)

      await expect(createCommit('test commit', git)).resolves.toEqual(mockCommitResult)
    })

    it('throws if the retry also fails', async () => {
      const retryError = new Error('commit failed after hook fix')
      const addMock = jest.fn().mockResolvedValue(undefined)
      const commitMock = jest
        .fn()
        .mockRejectedValueOnce(hookError)
        .mockRejectedValueOnce(retryError)
      const git = makeGit(commitMock, addMock)

      await expect(createCommit('test commit', git)).rejects.toThrow('commit failed after hook fix')
    })

    it('passes noVerify flag through to retry commit', async () => {
      const addMock = jest.fn().mockResolvedValue(undefined)
      const commitMock = jest
        .fn()
        .mockRejectedValueOnce(hookError)
        .mockResolvedValueOnce(mockCommitResult)
      const git = makeGit(commitMock, addMock)

      await createCommit('test commit', git, undefined, { noVerify: true })

      expect(commitMock).toHaveBeenNthCalledWith(1, 'test commit', ['--no-verify'])
      expect(commitMock).toHaveBeenNthCalledWith(2, 'test commit', ['--no-verify'])
    })
  })
})
