import { EventEmitter } from 'events'
import { ClaudeAdapter } from './claude'

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}))

import { spawn } from 'child_process'

const mockSpawn = spawn as jest.Mock

function makeChild(exitCode: number | null = 0, errorCode?: string) {
  const child = new EventEmitter() as EventEmitter & { stdin: null }
  child.stdin = null

  process.nextTick(() => {
    if (errorCode) {
      const err = Object.assign(new Error(errorCode), { code: errorCode })
      child.emit('error', err)
    } else {
      child.emit('close', exitCode)
    }
  })

  return child
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('ClaudeAdapter', () => {
  const adapter = new ClaudeAdapter()

  it('spawns claude with --print and the prompt as the last argument', async () => {
    mockSpawn.mockReturnValue(makeChild(0))

    await adapter.run('fix the bug')

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      ['--print', 'fix the bug'],
      expect.objectContaining({ stdio: 'inherit' })
    )
  })

  it('inherits current process env', async () => {
    mockSpawn.mockReturnValue(makeChild(0))

    await adapter.run('fix the bug')

    const envArg = mockSpawn.mock.calls[0][2].env
    // The env should contain all of process.env
    for (const key of Object.keys(process.env)) {
      expect(envArg[key]).toBe(process.env[key])
    }
  })

  it('appends autoFixToolOptions as --key value flags after --print', async () => {
    mockSpawn.mockReturnValue(makeChild(0))

    await adapter.run('fix the bug', { model: 'claude-sonnet-4-20250514', 'max-turns': '10' })

    const args = mockSpawn.mock.calls[0][1] as string[]
    expect(args).toContain('--model')
    expect(args).toContain('claude-sonnet-4-20250514')
    expect(args).toContain('--max-turns')
    expect(args).toContain('10')
    expect(args[args.length - 1]).toBe('fix the bug')
  })

  it('overrides ANTHROPIC_API_KEY when an explicit apiKey is provided', async () => {
    mockSpawn.mockReturnValue(makeChild(0))

    await adapter.run('fix the bug', undefined, 'override-key')

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ ANTHROPIC_API_KEY: 'override-key' }),
      })
    )
  })

  it('preserves inherited ANTHROPIC_API_KEY when apiKey is undefined', async () => {
    const previousApiKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'inherited-key'
    mockSpawn.mockReturnValue(makeChild(0))

    try {
      await adapter.run('fix the bug', undefined, undefined)
    } finally {
      process.env.ANTHROPIC_API_KEY = previousApiKey
    }

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ ANTHROPIC_API_KEY: 'inherited-key' }),
      })
    )
  })

  it('does not replace inherited ANTHROPIC_API_KEY with an empty apiKey', async () => {
    const previousApiKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'inherited-key'
    mockSpawn.mockReturnValue(makeChild(0))

    try {
      await adapter.run('fix the bug', undefined, '')
    } finally {
      process.env.ANTHROPIC_API_KEY = previousApiKey
    }

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ ANTHROPIC_API_KEY: 'inherited-key' }),
      })
    )
  })

  it('resolves when child process exits with code 0', async () => {
    mockSpawn.mockReturnValue(makeChild(0))

    await expect(adapter.run('fix the bug')).resolves.toBeUndefined()
  })

  it('rejects with exit code when child process exits non-zero', async () => {
    mockSpawn.mockReturnValue(makeChild(1))

    await expect(adapter.run('fix the bug')).rejects.toThrow('claude exited with code 1')
  })

  it('throws descriptive error when claude binary is not found (ENOENT)', async () => {
    mockSpawn.mockReturnValue(makeChild(null, 'ENOENT'))

    await expect(adapter.run('fix the bug')).rejects.toThrow(
      'claude binary not found. Please install Claude Code: https://docs.anthropic.com/en/docs/claude-code'
    )
  })
})
