import { execFile } from 'child_process'
import { installNpmPackage } from './installPackage'

jest.mock('child_process', () => ({
  execFile: jest.fn(
    (
      _cmd: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
    ) => {
      callback(null, { stdout: 'done', stderr: '' })
    }
  ),
}))

describe('installNpmPackage', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('invokes npm via execFile with an argv array, not an interpolated string', async () => {
    const result = await installNpmPackage({ name: 'pkg', flags: ['--save-dev'], cwd: '/tmp/project' })
    expect(result).toBe(true)
    expect(execFile).toHaveBeenCalledWith(
      'npm',
      ['i', 'pkg@latest', '--save-dev', '--yes'],
      { cwd: '/tmp/project' },
      expect.any(Function)
    )
  })

  it('does not append @latest when the name already pins a version', async () => {
    await installNpmPackage({ name: 'pkg@1.2.3' })
    expect(execFile).toHaveBeenCalledWith(
      'npm',
      ['i', 'pkg@1.2.3', '--yes'],
      { cwd: process.cwd() },
      expect.any(Function)
    )
  })
})
