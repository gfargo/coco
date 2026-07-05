import { execPromise } from './execPromise'

describe('execPromise', () => {
  it('resolves stdout/stderr for a successful command', async () => {
    const { stdout } = await execPromise('echo hello')
    expect(stdout.trim()).toBe('hello')
  })

  it('rejects with the underlying Error, not a string', async () => {
    let rejection: unknown
    try {
      await execPromise('exit 1')
    } catch (error) {
      rejection = error
    }
    expect(typeof rejection).not.toBe('string')
    expect(rejection).toMatchObject({ message: expect.any(String) })
  })

  it('lets caller-supplied options override the default timeout/maxBuffer', async () => {
    const longRunning = `"${process.execPath}" -e "setTimeout(() => {}, 5000)"`
    await expect(execPromise(longRunning, { timeout: 50 })).rejects.toMatchObject({
      killed: true,
    })
  })
})
