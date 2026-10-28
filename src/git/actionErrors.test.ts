import { isGitAuthFailure, isIndexLockError, retryOnIndexLock, withAuthHint } from './actionErrors'

const lockError = () =>
  new Error("fatal: Unable to create '/repo/.git/index.lock': File exists.")

describe('retryOnIndexLock (#2201)', () => {
  it('retries a lock collision and returns the eventual result', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined)
    const action = jest.fn().mockRejectedValueOnce(lockError()).mockResolvedValue('ok')

    await expect(retryOnIndexLock(action, sleep)).resolves.toBe('ok')
    expect(action).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(150)
  })

  it('gives up after two retries and rethrows the lock error', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined)
    const action = jest.fn().mockRejectedValue(lockError())

    await expect(retryOnIndexLock(action, sleep)).rejects.toThrow('index.lock')
    expect(action).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls).toEqual([[150], [450]])
  })

  it('does not retry unrelated failures', async () => {
    const sleep = jest.fn()
    const action = jest.fn().mockRejectedValue(new Error('fatal: not a git repository'))

    await expect(retryOnIndexLock(action, sleep)).rejects.toThrow('not a git repository')
    expect(action).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('recognizes both git phrasings of the lock error', () => {
    expect(isIndexLockError(lockError().message)).toBe(true)
    expect(isIndexLockError('Another git process seems to be running ... .git/index.lock')).toBe(true)
    // Config-file lock (remote / stack actions write .git/config).
    expect(isIndexLockError('error: could not lock config file .git/config: File exists')).toBe(true)
    // A ref race is a lost compare-and-swap, not lock contention: never retried.
    expect(isIndexLockError("error: cannot lock ref 'refs/heads/x': is at abc but expected def")).toBe(false)
    expect(isIndexLockError('fatal: bad revision')).toBe(false)
  })
})

describe('withAuthHint (#2199)', () => {
  it.each([
    'fatal: could not read Username for \'https://github.com\': terminal prompts disabled',
    'git@github.com: Permission denied (publickey).',
    'Host key verification failed.',
    'remote: Authentication failed for ...',
  ])('adds the shell hint to: %s', (message) => {
    expect(isGitAuthFailure(message)).toBe(true)
    expect(withAuthHint(message)).toContain('Run the command once in a shell')
  })

  it('leaves other failures untouched', () => {
    expect(withAuthHint('error: failed to push some refs')).toBe('error: failed to push some refs')
  })
})
