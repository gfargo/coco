import { EventEmitter } from 'events'
import { CodexAdapter } from './codex'

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

describe('CodexAdapter', () => {
  const adapter = new CodexAdapter()

  it('spawns codex exec with full-auto and the prompt as the last argument', async () => {
    mockSpawn.mockReturnValue(makeChild(0))

    await adapter.run('fix the bug')

    expect(mockSpawn).toHaveBeenCalledWith(
      'codex',
      ['exec', '--full-auto', 'fix the bug'],
      expect.objectContaining({ stdio: 'inherit' })
    )
  })

  it('inherits current process env', async () => {
    mockSpawn.mockReturnValue(makeChild(0))

    await adapter.run('fix the bug')

    expect(mockSpawn).toHaveBeenCalledWith('codex', expect.any(Array), expect.objectContaining({ env: process.env }))
  })

  it('maps supported options and passes other options as config overrides', async () => {
    mockSpawn.mockReturnValue(makeChild(0))

    await adapter.run('fix the bug', { model: 'o4-mini', sandbox: 'workspace-write', 'approval-mode': 'auto-edit' })

    const args = mockSpawn.mock.calls[0][1] as string[]
    expect(args).toContain('--model')
    expect(args).toContain('o4-mini')
    expect(args).toContain('--sandbox')
    expect(args).toContain('workspace-write')
    expect(args).toContain('-c')
    expect(args).toContain('approval-mode=auto-edit')
    expect(args[args.length - 1]).toBe('fix the bug')
  })

  it('overrides OPENAI_API_KEY when an explicit api key is provided', async () => {
    mockSpawn.mockReturnValue(makeChild(0))

    await adapter.run('fix the bug', undefined, 'override-key')

    expect(mockSpawn).toHaveBeenCalledWith(
      'codex',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ OPENAI_API_KEY: 'override-key' }),
      })
    )
  })

  it('preserves inherited OPENAI_API_KEY when api key is undefined', async () => {
    const previousApiKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'inherited-key'
    mockSpawn.mockReturnValue(makeChild(0))

    try {
      await adapter.run('fix the bug', undefined, undefined)
    } finally {
      process.env.OPENAI_API_KEY = previousApiKey
    }

    expect(mockSpawn).toHaveBeenCalledWith(
      'codex',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ OPENAI_API_KEY: 'inherited-key' }),
      })
    )
  })

  it('does not replace inherited OPENAI_API_KEY with an empty api key', async () => {
    const previousApiKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'inherited-key'
    mockSpawn.mockReturnValue(makeChild(0))

    try {
      await adapter.run('fix the bug', undefined, '')
    } finally {
      process.env.OPENAI_API_KEY = previousApiKey
    }

    expect(mockSpawn).toHaveBeenCalledWith(
      'codex',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ OPENAI_API_KEY: 'inherited-key' }),
      })
    )
  })

  it('resolves when child process exits with code 0', async () => {
    mockSpawn.mockReturnValue(makeChild(0))

    await expect(adapter.run('fix the bug')).resolves.toBeUndefined()
  })

  it('rejects with exit code when child process exits non-zero', async () => {
    mockSpawn.mockReturnValue(makeChild(1))

    await expect(adapter.run('fix the bug')).rejects.toThrow('codex exited with code 1')
  })

  it('throws descriptive error when codex binary is not found (ENOENT)', async () => {
    mockSpawn.mockReturnValue(makeChild(null, 'ENOENT'))

    await expect(adapter.run('fix the bug')).rejects.toThrow(
      'codex binary not found. Please install it: npm i -g @openai/codex'
    )
  })
})
