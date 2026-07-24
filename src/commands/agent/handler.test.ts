import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { handler } from './handler'

const mockArmNonInteractiveUsageTelemetry = jest.fn()
const mockResolveAgentRepoRoot = jest.fn()
const mockCreateAgentOperationContext = jest.fn()
const mockRunAgentOperation = jest.fn()

jest.mock('../utils/usageTelemetry', () => ({
  armNonInteractiveUsageTelemetry: (...args: unknown[]) => Promise.resolve(mockArmNonInteractiveUsageTelemetry(...args)),
}))

jest.mock('../../operations/agent', () => {
  const schemas = jest.requireActual('../../operations/agent/schemas') as typeof import('../../operations/agent/schemas')
  const errors = jest.requireActual('../../operations/agent/errors') as typeof import('../../operations/agent/errors')
  return {
    ...schemas,
    ...errors,
    createAgentOperationContext: (...args: unknown[]) => mockCreateAgentOperationContext(...args),
    resolveAgentRepoRoot: (...args: unknown[]) => mockResolveAgentRepoRoot(...args),
    runAgentOperation: (...args: unknown[]) => mockRunAgentOperation(...args),
  }
})

function argv(overrides: Record<string, unknown> = {}) {
  return {
    $0: 'coco',
    _: ['agent'],
    operation: 'review',
    interactive: false,
    verbose: false,
    quiet: true,
    json: true,
    version: false,
    help: false,
    ...overrides,
  } as never
}

const success = {
  version: 1 as const,
  ok: true as const,
  operation: 'review' as const,
  status: 'completed' as const,
  data: { findings: [] },
  warnings: [],
  meta: {
    kind: 'summary' as const,
    digest: 'sha256:test',
    verification: 'provided-unverified' as const,
  },
}

describe('agent command handler', () => {
  let tempDir: string
  let stdout = ''
  let stdoutSpy: jest.SpyInstance
  let chdirSpy: jest.SpyInstance
  let previousExitCode: typeof process.exitCode

  beforeEach(() => {
    jest.clearAllMocks()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-agent-handler-'))
    stdout = ''
    previousExitCode = process.exitCode
    process.exitCode = undefined
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
      stdout += String(chunk)
      return true
    }) as never)
    chdirSpy = jest.spyOn(process, 'chdir').mockImplementation(() => undefined)
    mockResolveAgentRepoRoot.mockResolvedValue('/repo')
    mockCreateAgentOperationContext.mockResolvedValue({ signal: undefined } as never)
    mockRunAgentOperation.mockResolvedValue(success)
  })

  afterEach(() => {
    stdoutSpy.mockRestore()
    chdirSpy.mockRestore()
    process.exitCode = previousExitCode
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  function writeRequest(value: unknown): string {
    const file = path.join(tempDir, 'request.json')
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value))
    return file
  }

  it('prints versioned input/output schemas without starting an operation', async () => {
    await handler(argv({ operation: 'schema', task: 'review' }))

    const output = JSON.parse(stdout)
    expect(output).toMatchObject({
      version: 1,
      operation: 'review',
      input: { type: 'object', additionalProperties: false },
      output: { oneOf: expect.any(Array) },
    })
    expect(output.input.required).toBeUndefined()
    expect(output.input.properties.options.required).toBeUndefined()
    expect(mockResolveAgentRepoRoot).not.toHaveBeenCalled()
    expect(mockArmNonInteractiveUsageTelemetry).not.toHaveBeenCalled()
  })

  it('emits a structured INVALID_JSON failure', async () => {
    await handler(argv({ input: writeRequest('{not json') }))

    expect(JSON.parse(stdout)).toMatchObject({
      version: 1,
      ok: false,
      operation: 'review',
      error: { code: 'INVALID_JSON', retryable: false },
    })
    expect(process.exitCode).toBe(1)
  })

  it('emits a structured INVALID_INPUT failure for strict-schema violations', async () => {
    await handler(argv({ input: writeRequest({ unexpected: true }) }))

    expect(JSON.parse(stdout)).toMatchObject({
      ok: false,
      operation: 'review',
      error: { code: 'INVALID_INPUT', details: expect.any(Array) },
    })
    expect(mockRunAgentOperation).not.toHaveBeenCalled()
  })

  it('arms telemetry and creates an agent-cli cancellation context before generation', async () => {
    const input = writeRequest({ source: { kind: 'summary', summary: 'changed' } })
    const listenersBefore = process.listenerCount('SIGINT')

    await handler(argv({ input, repo: '/requested' }))

    expect(mockResolveAgentRepoRoot).toHaveBeenCalledWith('/requested', undefined, expect.any(AbortSignal))
    expect(chdirSpy).toHaveBeenCalledWith('/repo')
    expect(mockArmNonInteractiveUsageTelemetry).toHaveBeenCalledWith(expect.objectContaining({ operation: 'review' }), '/repo')
    expect(mockCreateAgentOperationContext).toHaveBeenCalledWith({
      repoRoot: '/repo',
      signal: expect.any(AbortSignal),
      surface: 'agent-cli',
    })
    expect(mockRunAgentOperation).toHaveBeenCalledWith(
      'review',
      expect.objectContaining({ source: { kind: 'summary', summary: 'changed' } }),
      expect.anything(),
    )
    expect(JSON.parse(stdout)).toEqual(success)
    expect(process.listenerCount('SIGINT')).toBe(listenersBefore)
  })

  it('normalizes generation failures into a structured envelope', async () => {
    mockRunAgentOperation.mockRejectedValueOnce(new Error('provider unavailable'))

    await handler(argv({ input: writeRequest({ source: { kind: 'summary', summary: 'changed' } }) }))

    expect(JSON.parse(stdout)).toMatchObject({
      ok: false,
      operation: 'review',
      error: { code: 'OPERATION_FAILED', message: 'provider unavailable', retryable: false },
    })
    expect(process.exitCode).toBe(1)
  })
})
