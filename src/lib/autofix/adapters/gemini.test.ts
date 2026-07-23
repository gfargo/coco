import { EventEmitter } from 'events'
import { GeminiAdapter } from './gemini'

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

describe('GeminiAdapter', () => {
  const adapter = new GeminiAdapter()

  it('spawns gemini with the prompt as the last argument', async () => {
    mockSpawn.mockReturnValue(makeChild(0))

    await adapter.run('fix the bug')

    expect(mockSpawn).toHaveBeenCalledWith(
      'gemini',
      ['fix the bug'],
      expect.objectContaining({ stdio: 'inherit' })
    )
  })

  it('inherits current process env', async () => {
    mockSpawn.mockReturnValue(makeChild(0))

    await adapter.run('fix the bug')

    const envArg = mockSpawn.mock.calls[0][2].env
    // The env should contain all process.env keys (spread, not reference-equal)
    for (const key of Object.keys(process.env)) {
      expect(envArg).toHaveProperty(key, process.env[key])
    }
  })

  it('appends autoFixToolOptions as --key value flags before the prompt', async () => {
    mockSpawn.mockReturnValue(makeChild(0))

    await adapter.run('fix the bug', { model: 'gemini-2.5-pro', sandbox: 'none' })

    const args = mockSpawn.mock.calls[0][1] as string[]
    expect(args).toContain('--model')
    expect(args).toContain('gemini-2.5-pro')
    expect(args).toContain('--sandbox')
    expect(args).toContain('none')
    expect(args[args.length - 1]).toBe('fix the bug')
  })

  it('overrides GEMINI_API_KEY when an explicit apiKey is provided', async () => {
    mockSpawn.mockReturnValue(makeChild(0))

    await adapter.run('fix the bug', undefined, 'override-key')

    expect(mockSpawn).toHaveBeenCalledWith(
      'gemini',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ GEMINI_API_KEY: 'override-key' }),
      })
    )
  })

  it('preserves inherited GEMINI_API_KEY when apiKey is undefined', async () => {
    const previousApiKey = process.env.GEMINI_API_KEY
    process.env.GEMINI_API_KEY = 'inherited-key'
    mockSpawn.mockReturnValue(makeChild(0))

    try {
      await adapter.run('fix the bug', undefined, undefined)
    } finally {
      process.env.GEMINI_API_KEY = previousApiKey
    }

    expect(mockSpawn).toHaveBeenCalledWith(
      'gemini',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ GEMINI_API_KEY: 'inherited-key' }),
      })
    )
  })

  it('does not replace inherited GEMINI_API_KEY with an empty apiKey', async () => {
    const previousApiKey = process.env.GEMINI_API_KEY
    process.env.GEMINI_API_KEY = 'inherited-key'
    mockSpawn.mockReturnValue(makeChild(0))

    try {
      await adapter.run('fix the bug', undefined, '')
    } finally {
      process.env.GEMINI_API_KEY = previousApiKey
    }

    expect(mockSpawn).toHaveBeenCalledWith(
      'gemini',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ GEMINI_API_KEY: 'inherited-key' }),
      })
    )
  })

  it('resolves when child process exits with code 0', async () => {
    mockSpawn.mockReturnValue(makeChild(0))

    await expect(adapter.run('fix the bug')).resolves.toBeUndefined()
  })

  it('rejects with exit code when child process exits non-zero', async () => {
    mockSpawn.mockReturnValue(makeChild(1))

    await expect(adapter.run('fix the bug')).rejects.toThrow('gemini exited with code 1')
  })

  it('throws descriptive error when gemini binary is not found (ENOENT)', async () => {
    mockSpawn.mockReturnValue(makeChild(null, 'ENOENT'))

    await expect(adapter.run('fix the bug')).rejects.toThrow(
      'gemini binary not found. Please install Gemini CLI: https://ai.google.dev/gemini-api/docs/quickstart'
    )
  })
})
