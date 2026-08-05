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

  it('has vendor anthropic and envVar ANTHROPIC_API_KEY', () => {
    expect(adapter.vendor).toBe('anthropic')
    expect(adapter.envVar).toBe('ANTHROPIC_API_KEY')
  })

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

  it('injects ANTHROPIC_API_KEY when apiKey is provided and ambient is unset', async () => {
    const previousApiKey = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    mockSpawn.mockReturnValue(makeChild(0))

    try {
      await adapter.run('fix the bug', undefined, 'explicit-key')
    } finally {
      if (previousApiKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = previousApiKey
      }
    }

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ ANTHROPIC_API_KEY: 'explicit-key' }),
      })
    )
  })

  it('does NOT override an ambient ANTHROPIC_API_KEY with an explicit apiKey', async () => {
    const previousApiKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'ambient-anthropic-key'
    mockSpawn.mockReturnValue(makeChild(0))

    try {
      await adapter.run('fix the bug', undefined, 'some-other-key')
    } finally {
      process.env.ANTHROPIC_API_KEY = previousApiKey
    }

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ ANTHROPIC_API_KEY: 'ambient-anthropic-key' }),
      })
    )
  })

  it('overrides ambient ANTHROPIC_API_KEY when forceApiKey is provided', async () => {
    const previousApiKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'ambient-anthropic-key'
    mockSpawn.mockReturnValue(makeChild(0))

    try {
      await adapter.run('fix the bug', undefined, undefined, 'explicit-force-key')
    } finally {
      process.env.ANTHROPIC_API_KEY = previousApiKey
    }

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ ANTHROPIC_API_KEY: 'explicit-force-key' }),
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

  it('does not inject ANTHROPIC_API_KEY when apiKey is empty string', async () => {
    const previousApiKey = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    mockSpawn.mockReturnValue(makeChild(0))

    try {
      await adapter.run('fix the bug', undefined, '')
    } finally {
      if (previousApiKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = previousApiKey
      }
    }

    const envArg = mockSpawn.mock.calls[0][2].env
    expect(envArg.ANTHROPIC_API_KEY).toBeUndefined()
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
