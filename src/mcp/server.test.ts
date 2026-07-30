import { z } from 'zod'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createAgentInputJsonSchema } from '../operations/agent/schemas'
import { createCocoMcpServer } from './server'

const mockResolveAgentRepoRoot = jest.fn()
const mockCreateAgentOperationContext = jest.fn()
const mockRunAgentOperation = jest.fn()
const mockRunCondenseDiff = jest.fn()

type HandlerExtra = {
  signal: AbortSignal
  _meta?: { progressToken?: string | number }
  sendNotification: (notification: unknown) => Promise<void>
}

const registrations = new Map<string, {
  config: {
    title: string
    description: string
    inputSchema: z.ZodType
    outputSchema: z.ZodType
    annotations: Record<string, boolean>
  }
  handler: (input: unknown, extra: HandlerExtra) => Promise<Record<string, unknown>>
}>()
const serverOptions: unknown[] = []

jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class MockMcpServer {
    server = {
      getClientCapabilities: jest.fn(() => undefined),
      listRoots: jest.fn(async () => ({ roots: [] })),
    }

    constructor(info: unknown, options: unknown) {
      serverOptions.push({ info, options })
    }

    registerTool(name: string, config: unknown, handler: unknown) {
      registrations.set(name, {
        config: config as {
          title: string
          description: string
          inputSchema: z.ZodType
          outputSchema: z.ZodType
          annotations: Record<string, boolean>
        },
        handler: handler as (input: unknown, extra: HandlerExtra) => Promise<Record<string, unknown>>,
      })
    }

    connect = jest.fn()
  },
}))
jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class MockStdioServerTransport {},
}))
jest.mock('../operations/agent', () => {
  const schemas = jest.requireActual('../operations/agent/schemas') as typeof import('../operations/agent/schemas')
  const errors = jest.requireActual('../operations/agent/errors') as typeof import('../operations/agent/errors')
  return {
    ...schemas,
    ...errors,
    createAgentOperationContext: (...args: unknown[]) => mockCreateAgentOperationContext(...args),
    resolveAgentDirectoryRoot: jest.fn((value: string) => value),
    resolveAgentRepoRoot: (...args: unknown[]) => mockResolveAgentRepoRoot(...args),
    isPathWithinRoot: jest.fn(() => true),
    runAgentOperation: (...args: unknown[]) => mockRunAgentOperation(...args),
    runCondenseDiff: (...args: unknown[]) => mockRunCondenseDiff(...args),
  }
})

const reviewSuccess = {
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

describe('createCocoMcpServer', () => {
  const condenseDiffSuccess = {
    version: 1 as const,
    ok: true as const,
    operation: 'condense-diff' as const,
    status: 'completed' as const,
    data: {
      condensed: '',
      metrics: { inputTokens: 0, outputTokens: 0, reductionRatio: 0, filesIncluded: 0, filesOmitted: 0, strategy: 'structural' as const },
      files: [],
    },
    warnings: [],
    meta: { kind: 'summary' as const, digest: 'sha256:test', verification: 'provided-unverified' as const },
  }

  beforeEach(() => {
    jest.clearAllMocks()
    registrations.clear()
    serverOptions.length = 0
    mockResolveAgentRepoRoot.mockResolvedValue('/repo')
    mockCreateAgentOperationContext.mockResolvedValue({ signal: undefined } as never)
    mockRunAgentOperation.mockResolvedValue(reviewSuccess)
    mockRunCondenseDiff.mockResolvedValue(condenseDiffSuccess)
  })

  function createServer() {
    return createCocoMcpServer('/repo') as unknown as McpServer
  }

  function tool(name: string) {
    const registration = registrations.get(name)
    if (!registration) throw new Error(`Missing registration: ${name}`)
    return registration
  }

  function makeExtra(overrides: Partial<HandlerExtra> = {}): HandlerExtra {
    return {
      signal: new AbortController().signal,
      sendNotification: jest.fn(async () => undefined),
      ...overrides,
    }
  }

  it('registers five read-only generation tools including coco_condense_diff', () => {
    createServer()

    expect([...registrations.keys()]).toEqual([
      'coco_commit_draft',
      'coco_review',
      'coco_changelog',
      'coco_recap',
      'coco_condense_diff',
    ])
    // The four LLM-generation tools share the AgentTaskInputSchema and have
    // idempotentHint:false; condense-diff has its own schema and idempotentHint:true.
    const generationTools = ['coco_commit_draft', 'coco_review', 'coco_changelog', 'coco_recap']
    for (const name of generationTools) {
      const registration = tool(name)
      expect(registration.config.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      })
      const inputJson = z.toJSONSchema(registration.config.inputSchema, {
        io: 'input',
        target: 'draft-07',
      })
      const outputJson = z.toJSONSchema(registration.config.outputSchema) as { type?: string; oneOf?: unknown[] }
      expect(inputJson).toEqual(createAgentInputJsonSchema())
      expect(inputJson).toMatchObject({ type: 'object', additionalProperties: false })
      expect(outputJson.type).toBe('object')
      expect(outputJson.oneOf).toHaveLength(2)
    }

    // coco_condense_diff uses its own request schema.
    const condenseTool = tool('coco_condense_diff')
    expect(condenseTool.config.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    })
    const condenseInputJson = z.toJSONSchema(condenseTool.config.inputSchema, {
      io: 'input',
      target: 'draft-07',
    })
    expect(condenseInputJson).toMatchObject({ type: 'object', additionalProperties: false })
    // Must NOT be the same as the generation tool input schema.
    expect(condenseInputJson).not.toEqual(createAgentInputJsonSchema())
    const condenseOutputJson = z.toJSONSchema(condenseTool.config.outputSchema) as { type?: string; oneOf?: unknown[] }
    expect(condenseOutputJson.type).toBe('object')
    expect(condenseOutputJson.oneOf).toHaveLength(2)
  })

  it('documents repository binding and metadata-only analytics in server instructions', () => {
    createServer()

    expect(serverOptions).toHaveLength(1)
    expect(serverOptions[0]).toEqual(expect.objectContaining({
      info: expect.objectContaining({ name: 'coco' }),
      options: expect.objectContaining({
        instructions: expect.stringContaining('prompts, diffs, and code are never recorded'),
      }),
    }))
  })

  it('runs tools with an MCP usage surface and the request cancellation signal', async () => {
    createServer()
    const controller = new AbortController()

    const result = await tool('coco_review').handler({
      source: { kind: 'summary', summary: 'changed' },
    }, makeExtra({ signal: controller.signal }))

    expect(mockResolveAgentRepoRoot).toHaveBeenCalledWith(undefined, '/repo', controller.signal)
    expect(mockCreateAgentOperationContext).toHaveBeenCalledWith({
      repoRoot: '/repo',
      signal: controller.signal,
      surface: 'mcp',
      onProgress: undefined,
    })
    expect(mockRunAgentOperation).toHaveBeenCalledWith(
      'review',
      expect.objectContaining({
        source: { kind: 'summary', summary: 'changed' },
        options: expect.objectContaining({ trustRepositoryConfig: false }),
      }),
      expect.anything(),
    )
    expect(result).toMatchObject({
      structuredContent: reviewSuccess,
      content: [{ type: 'text', text: expect.stringContaining('"ok": true') }],
    })
  })

  it('rejects the unsafe repository-config option with a structured error', async () => {
    createServer()

    const result = await tool('coco_review').handler({
      source: { kind: 'summary', summary: 'changed' },
      options: { trustRepositoryConfig: true },
    }, makeExtra())

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        version: 1,
        ok: false,
        operation: 'review',
        error: { code: 'UNSAFE_OPTION', retryable: false },
      },
    })
    expect(mockCreateAgentOperationContext).not.toHaveBeenCalled()
    expect(mockRunAgentOperation).not.toHaveBeenCalled()
  })

  it('returns strict input validation failures as structured MCP errors', async () => {
    createServer()

    const result = await tool('coco_changelog').handler({ unexpected: true }, makeExtra())

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        operation: 'changelog',
        error: { code: 'INVALID_INPUT', details: expect.any(Array) },
      },
      content: [{ type: 'text', text: expect.stringContaining('INVALID_INPUT') }],
    })
  })

  it('normalizes operation failures into the same structured error envelope', async () => {
    createServer()
    mockRunAgentOperation.mockRejectedValueOnce(new Error('provider unavailable'))

    const result = await tool('coco_recap').handler({
      source: { kind: 'summary', summary: 'changed' },
    }, makeExtra())

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        operation: 'recap',
        error: { code: 'OPERATION_FAILED', message: 'provider unavailable' },
      },
    })
  })

  it('routes condense-diff to runCondenseDiff and returns a structured result', async () => {
    createServer()
    const controller = new AbortController()

    const result = await tool('coco_condense_diff').handler({
      source: { kind: 'summary', summary: 'changed' },
      budget: { tokens: 1000 },
    }, makeExtra({ signal: controller.signal }))

    expect(result).toMatchObject({
      structuredContent: expect.objectContaining({
        ok: true,
        operation: 'condense-diff',
      }),
    })
  })

  it('returns validation failures for invalid condense-diff input', async () => {
    createServer()

    const result = await tool('coco_condense_diff').handler({
      // budget is required — omitting it triggers a validation error
      source: { kind: 'summary', summary: 'changed' },
    }, makeExtra())

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        operation: 'condense-diff',
        error: { code: 'INVALID_INPUT' },
      },
    })
  })

  it('rejects trustRepositoryConfig:true on coco_condense_diff with UNSAFE_OPTION', async () => {
    createServer()

    const result = await tool('coco_condense_diff').handler({
      source: { kind: 'summary', summary: 'changed' },
      budget: { tokens: 1000 },
      trustRepositoryConfig: true,
    }, makeExtra())

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        version: 1,
        ok: false,
        operation: 'condense-diff',
        error: { code: 'UNSAFE_OPTION', retryable: false },
      },
    })
    expect(mockCreateAgentOperationContext).not.toHaveBeenCalled()
    expect(mockRunCondenseDiff).not.toHaveBeenCalled()
  })

  it('builds a progress reporter and forwards notifications/progress with a monotonic counter when a progressToken is present', async () => {
    createServer()
    let capturedOnProgress: ((update: { message?: string; fraction?: number }) => void) | undefined
    mockCreateAgentOperationContext.mockImplementationOnce(async (input: { onProgress?: typeof capturedOnProgress }) => {
      capturedOnProgress = input.onProgress
      return { signal: undefined } as never
    })
    const sendNotification = jest.fn(async () => undefined)

    await tool('coco_review').handler({
      source: { kind: 'summary', summary: 'changed' },
    }, makeExtra({ _meta: { progressToken: 'token-1' }, sendNotification }))

    expect(capturedOnProgress).toBeInstanceOf(Function)
    capturedOnProgress!({ message: 'Resolved changes' })
    capturedOnProgress!({ message: 'Generating review…' })

    expect(sendNotification).toHaveBeenNthCalledWith(1, {
      method: 'notifications/progress',
      params: { progressToken: 'token-1', progress: 1, message: 'Resolved changes' },
    })
    expect(sendNotification).toHaveBeenNthCalledWith(2, {
      method: 'notifications/progress',
      params: { progressToken: 'token-1', progress: 2, message: 'Generating review…' },
    })
  })

  it('swallows a rejecting sendNotification without failing the operation', async () => {
    createServer()
    let capturedOnProgress: ((update: { message?: string; fraction?: number }) => void) | undefined
    mockCreateAgentOperationContext.mockImplementationOnce(async (input: { onProgress?: typeof capturedOnProgress }) => {
      capturedOnProgress = input.onProgress
      return { signal: undefined } as never
    })
    const sendNotification = jest.fn(async () => {
      throw new Error('client closed its notification channel')
    })

    const result = await tool('coco_review').handler({
      source: { kind: 'summary', summary: 'changed' },
    }, makeExtra({ _meta: { progressToken: 'token-3' }, sendNotification }))

    expect(capturedOnProgress).toBeInstanceOf(Function)
    expect(() => capturedOnProgress!({ message: 'Resolved changes' })).not.toThrow()
    expect(sendNotification).toHaveBeenCalledTimes(1)

    // Give the fire-and-forget rejection a microtask turn to settle,
    // then confirm it never surfaced through the handler's own result.
    await Promise.resolve()
    expect(result).toMatchObject({
      structuredContent: { ok: true },
    })
  })

  it('passes no progress reporter when the request has no progressToken', async () => {
    createServer()

    await tool('coco_review').handler({
      source: { kind: 'summary', summary: 'changed' },
    }, makeExtra())

    expect(mockCreateAgentOperationContext).toHaveBeenCalledWith(
      expect.objectContaining({ onProgress: undefined }),
    )
  })

  it('keeps the terminal envelope byte-identical whether or not a progressToken is present', async () => {
    createServer()

    const withToken = await tool('coco_review').handler({
      source: { kind: 'summary', summary: 'changed' },
    }, makeExtra({ _meta: { progressToken: 'token-2' } }))
    const withoutToken = await tool('coco_review').handler({
      source: { kind: 'summary', summary: 'changed' },
    }, makeExtra())

    expect(withToken).toEqual(withoutToken)
  })
})
