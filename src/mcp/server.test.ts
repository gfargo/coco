import { z } from 'zod'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createAgentInputJsonSchema } from '../operations/agent/schemas'
import { createCocoMcpServer } from './server'

const mockResolveAgentRepoRoot = jest.fn()
const mockCreateAgentOperationContext = jest.fn()
const mockRunAgentOperation = jest.fn()
const mockGetRepoStatus = jest.fn()
const mockGetStagedDiff = jest.fn()
const mockGetBranchContext = jest.fn()
const mockGetRecentLog = jest.fn()

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
const resourceRegistrations = new Map<string, {
  uri: string
  config: {
    title: string
    description: string
    mimeType: string
  }
  readCallback: (uri: URL, extra: { signal: AbortSignal }) => Promise<Record<string, unknown>>
}>()
const promptRegistrations = new Map<string, {
  config: {
    title: string
    description: string
    argsSchema: Record<string, z.ZodType>
  }
  callback: (args: Record<string, unknown>, extra: { signal: AbortSignal }) => Promise<Record<string, unknown>>
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

    registerResource(name: string, uri: string, config: unknown, readCallback: unknown) {
      resourceRegistrations.set(name, {
        uri,
        config: config as {
          title: string
          description: string
          mimeType: string
        },
        readCallback: readCallback as (uri: URL, extra: { signal: AbortSignal }) => Promise<Record<string, unknown>>,
      })
    }

    registerPrompt(name: string, config: unknown, callback: unknown) {
      promptRegistrations.set(name, {
        config: config as {
          title: string
          description: string
          argsSchema: Record<string, z.ZodType>
        },
        callback: callback as (args: Record<string, unknown>, extra: { signal: AbortSignal }) => Promise<Record<string, unknown>>,
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
  const context = jest.requireActual('../operations/agent/context') as typeof import('../operations/agent/context')
  return {
    ...schemas,
    ...errors,
    digestOf: context.digestOf,
    createAgentOperationContext: (...args: unknown[]) => mockCreateAgentOperationContext(...args),
    resolveAgentDirectoryRoot: jest.fn((value: string) => value),
    resolveAgentRepoRoot: (...args: unknown[]) => mockResolveAgentRepoRoot(...args),
    isPathWithinRoot: jest.fn(() => true),
    runAgentOperation: (...args: unknown[]) => mockRunAgentOperation(...args),
    getRepoStatus: (...args: unknown[]) => mockGetRepoStatus(...args),
    getStagedDiff: (...args: unknown[]) => mockGetStagedDiff(...args),
    getBranchContext: (...args: unknown[]) => mockGetBranchContext(...args),
    getRecentLog: (...args: unknown[]) => mockGetRecentLog(...args),
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
    resourceRegistrations.clear()
    promptRegistrations.clear()
    serverOptions.length = 0
    mockResolveAgentRepoRoot.mockResolvedValue('/repo')
    mockCreateAgentOperationContext.mockResolvedValue({ signal: undefined } as never)
    mockRunAgentOperation.mockResolvedValue(reviewSuccess)
    mockGetRepoStatus.mockResolvedValue('## main\n')
    mockGetStagedDiff.mockResolvedValue('')
    mockGetBranchContext.mockResolvedValue('Branch: main')
    mockGetRecentLog.mockResolvedValue('abc1234 initial commit')
  })

  function createServer() {
    return createCocoMcpServer('/repo') as unknown as McpServer
  }

  function tool(name: string) {
    const registration = registrations.get(name)
    if (!registration) throw new Error(`Missing registration: ${name}`)
    return registration
  }

  function resource(name: string) {
    const registration = resourceRegistrations.get(name)
    if (!registration) throw new Error(`Missing resource registration: ${name}`)
    return registration
  }

  function prompt(name: string) {
    const registration = promptRegistrations.get(name)
    if (!registration) throw new Error(`Missing prompt registration: ${name}`)
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

  it('registers four read-only repository resources with static URIs', () => {
    createServer()

    expect([...resourceRegistrations.keys()]).toEqual([
      'coco_repo_status',
      'coco_repo_diff_staged',
      'coco_repo_branch_context',
      'coco_repo_log_recent',
    ])
    expect(resourceRegistrations.get('coco_repo_status')?.uri).toBe('coco://repo/status')
    expect(resourceRegistrations.get('coco_repo_diff_staged')?.uri).toBe('coco://repo/diff/staged')
    expect(resourceRegistrations.get('coco_repo_branch_context')?.uri).toBe('coco://repo/branch-context')
    expect(resourceRegistrations.get('coco_repo_log_recent')?.uri).toBe('coco://repo/log/recent')
    for (const registration of resourceRegistrations.values()) {
      expect(registration.config.mimeType).toBe('text/plain')
      expect(registration.config.description).toEqual(expect.stringContaining('Read-only'))
    }
  })

  it('reads a repository resource without letting the URI switch the bound repo', async () => {
    createServer()
    const controller = new AbortController()

    const result = await resource('coco_repo_status').readCallback(
      new URL('coco://repo/status'),
      { signal: controller.signal },
    )

    expect(mockResolveAgentRepoRoot).toHaveBeenCalledWith(undefined, '/repo', controller.signal)
    expect(mockCreateAgentOperationContext).toHaveBeenCalledWith({
      repoRoot: '/repo',
      signal: controller.signal,
      surface: 'mcp',
    })
    expect(mockGetRepoStatus).toHaveBeenCalled()
    expect(result).toMatchObject({
      contents: [{
        uri: 'coco://repo/status',
        mimeType: 'text/plain',
        text: '## main',
        _meta: { digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) },
      }],
    })
  })

  it('surfaces an empty staged diff as clean content instead of an error', async () => {
    createServer()
    mockGetStagedDiff.mockResolvedValue('')

    const result = await resource('coco_repo_diff_staged').readCallback(
      new URL('coco://repo/diff/staged'),
      { signal: new AbortController().signal },
    )

    expect(result).toMatchObject({
      contents: [{ mimeType: 'text/plain', text: 'No content available.' }],
    })
  })

  it('returns a structured, non-throwing error when a resource read fails', async () => {
    createServer()
    mockCreateAgentOperationContext.mockRejectedValueOnce(new Error('git unavailable'))

    const result = await resource('coco_repo_branch_context').readCallback(
      new URL('coco://repo/branch-context'),
      { signal: new AbortController().signal },
    )

    expect(result).toMatchObject({
      contents: [{
        mimeType: 'application/json',
        text: expect.stringContaining('OPERATION_FAILED'),
      }],
    })
  })

  it('registers coco prompt templates for commit, review, changelog, and recap', () => {
    createServer()

    expect([...promptRegistrations.keys()]).toEqual([
      'coco_commit_prompt',
      'coco_conventional_commit_prompt',
      'coco_review_prompt',
      'coco_changelog_prompt',
      'coco_recap_prompt',
    ])
    expect(promptRegistrations.get('coco_review_prompt')?.config.argsSchema).toMatchObject({
      format_instructions: expect.anything(),
      changes: expect.anything(),
      language_context: expect.anything(),
    })
  })

  it('renders a prompt template with supplied arguments and defaults for the rest', async () => {
    createServer()

    const result = await prompt('coco_review_prompt').callback({
      changes: 'diff --git a/a.ts b/a.ts',
    }, { signal: new AbortController().signal })

    expect(result).toMatchObject({
      messages: [{
        role: 'user',
        content: { type: 'text', text: expect.stringContaining('diff --git a/a.ts b/a.ts') },
      }],
    })
  })
})
