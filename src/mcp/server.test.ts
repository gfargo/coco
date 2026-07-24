import { z } from 'zod'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createAgentInputJsonSchema } from '../operations/agent/schemas'
import { createCocoMcpServer } from './server'

const mockResolveAgentRepoRoot = jest.fn()
const mockCreateAgentOperationContext = jest.fn()
const mockRunAgentOperation = jest.fn()

const registrations = new Map<string, {
  config: {
    title: string
    description: string
    inputSchema: z.ZodType
    outputSchema: z.ZodType
    annotations: Record<string, boolean>
  }
  handler: (input: unknown, extra: { signal: AbortSignal }) => Promise<Record<string, unknown>>
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
        handler: handler as (input: unknown, extra: { signal: AbortSignal }) => Promise<Record<string, unknown>>,
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
  beforeEach(() => {
    jest.clearAllMocks()
    registrations.clear()
    serverOptions.length = 0
    mockResolveAgentRepoRoot.mockResolvedValue('/repo')
    mockCreateAgentOperationContext.mockResolvedValue({ signal: undefined } as never)
    mockRunAgentOperation.mockResolvedValue(reviewSuccess)
  })

  function createServer() {
    return createCocoMcpServer('/repo') as unknown as McpServer
  }

  function tool(name: string) {
    const registration = registrations.get(name)
    if (!registration) throw new Error(`Missing registration: ${name}`)
    return registration
  }

  it('registers four read-only generation tools with visible discriminated output schemas', () => {
    createServer()

    expect([...registrations.keys()]).toEqual([
      'coco_commit_draft',
      'coco_review',
      'coco_changelog',
      'coco_recap',
    ])
    for (const registration of registrations.values()) {
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
    }, { signal: controller.signal })

    expect(mockResolveAgentRepoRoot).toHaveBeenCalledWith(undefined, '/repo', controller.signal)
    expect(mockCreateAgentOperationContext).toHaveBeenCalledWith({
      repoRoot: '/repo',
      signal: controller.signal,
      surface: 'mcp',
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
    }, { signal: new AbortController().signal })

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

    const result = await tool('coco_changelog').handler({ unexpected: true }, {
      signal: new AbortController().signal,
    })

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
    }, { signal: new AbortController().signal })

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        operation: 'recap',
        error: { code: 'OPERATION_FAILED', message: 'provider unavailable' },
      },
    })
  })
})
