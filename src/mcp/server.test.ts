import { z } from 'zod'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  createAgentInputJsonSchema,
  createMcpAgentInputJsonSchema,
  createMcpCondenseDiffInputJsonSchema,
} from '../operations/agent/schemas'
import { createCocoMcpServer } from './server'

const mockResolveAgentRepoRoot = jest.fn()
const mockCreateAgentOperationContext = jest.fn()
const mockRunAgentOperation = jest.fn()
const mockGetRepoStatus = jest.fn()
const mockGetStagedDiff = jest.fn()
const mockGetBranchContext = jest.fn()
const mockGetRecentLog = jest.fn()
const mockGetRepoConfig = jest.fn()
const mockRunCondenseDiff = jest.fn()
const mockRunRepoContext = jest.fn()

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
        handler: handler as (input: unknown, extra: HandlerExtra) => Promise<Record<string, unknown>>,
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
    requiresRepository: context.requiresRepository,
    describeRepoResolutionFailure: context.describeRepoResolutionFailure,
    createAgentOperationContext: (...args: unknown[]) => mockCreateAgentOperationContext(...args),
    resolveAgentDirectoryRoot: jest.fn((value: string) => value),
    resolveAgentRepoRoot: (...args: unknown[]) => mockResolveAgentRepoRoot(...args),
    isPathWithinRoot: jest.fn(() => true),
    runAgentOperation: (...args: unknown[]) => mockRunAgentOperation(...args),
    getRepoStatus: (...args: unknown[]) => mockGetRepoStatus(...args),
    getStagedDiff: (...args: unknown[]) => mockGetStagedDiff(...args),
    getBranchContext: (...args: unknown[]) => mockGetBranchContext(...args),
    getRecentLog: (...args: unknown[]) => mockGetRecentLog(...args),
    getRepoConfig: (...args: unknown[]) => mockGetRepoConfig(...args),
    runCondenseDiff: (...args: unknown[]) => mockRunCondenseDiff(...args),
    runRepoContext: (...args: unknown[]) => mockRunRepoContext(...args),
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
    mockGetRepoConfig.mockResolvedValue(JSON.stringify({
      defaultBranch: 'main',
      service: { provider: 'anthropic', model: 'claude-sonnet-4-6', tokenLimit: 4096 },
      telemetry: { usage: false },
      ignoredFiles: ['*.lock'],
      ignoredExtensions: ['.map'],
    }))
    mockRunCondenseDiff.mockResolvedValue(condenseDiffSuccess)
    mockRunRepoContext.mockResolvedValue({
      version: 1 as const,
      ok: true as const,
      operation: 'repo-context' as const,
      status: 'completed' as const,
      data: { branch: { current: 'main', detached: false } },
      warnings: [],
      meta: { kind: 'repository' as const, digest: 'sha256:test', verification: 'repository-derived' as const },
    })
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

  function makeExtra(overrides: Partial<HandlerExtra> = {}): HandlerExtra {
    return {
      signal: new AbortController().signal,
      sendNotification: jest.fn(async () => undefined),
      ...overrides,
    }
  }

  it('registers six read-only generation tools including coco_condense_diff and coco_repo_context', () => {
    createServer()

    expect([...registrations.keys()]).toEqual([
      'coco_commit_draft',
      'coco_review',
      'coco_changelog',
      'coco_recap',
      'coco_condense_diff',
      'coco_repo_context',
    ])
    // The four LLM-generation tools share the AgentTaskInputSchema and have
    // idempotentHint:false; condense-diff and repo-context have their own schemas and idempotentHint:true.
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
      expect(inputJson).toEqual(createMcpAgentInputJsonSchema())
      expect(inputJson).not.toEqual(createAgentInputJsonSchema())
      expect(inputJson).toMatchObject({ type: 'object', additionalProperties: false })
      const optionsProperties = (inputJson as {
        properties?: { options?: { properties?: Record<string, unknown> } }
      }).properties?.options?.properties
      expect(optionsProperties).toBeDefined()
      expect(optionsProperties).not.toHaveProperty('trustRepositoryConfig')
      const cliOptionsProperties = (createAgentInputJsonSchema() as {
        properties?: { options?: { properties?: Record<string, unknown> } }
      }).properties?.options?.properties
      expect(cliOptionsProperties).toHaveProperty('trustRepositoryConfig')
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
    expect(condenseInputJson).not.toEqual(createMcpAgentInputJsonSchema())
    expect(condenseInputJson).toEqual(createMcpCondenseDiffInputJsonSchema())
    expect(condenseInputJson).not.toHaveProperty('properties.trustRepositoryConfig')
    const condenseOutputJson = z.toJSONSchema(condenseTool.config.outputSchema) as { type?: string; oneOf?: unknown[] }
    expect(condenseOutputJson.type).toBe('object')
    expect(condenseOutputJson.oneOf).toHaveLength(2)

    // coco_repo_context uses its own request schema.
    const repoContextTool = tool('coco_repo_context')
    expect(repoContextTool.config.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    })
    const repoContextInputJson = z.toJSONSchema(repoContextTool.config.inputSchema, {
      io: 'input',
      target: 'draft-07',
    })
    expect(repoContextInputJson).toMatchObject({ type: 'object', additionalProperties: false })
    expect(repoContextInputJson).not.toEqual(createAgentInputJsonSchema())
    const repoContextOutputJson = z.toJSONSchema(repoContextTool.config.outputSchema) as { type?: string; oneOf?: unknown[] }
    expect(repoContextOutputJson.type).toBe('object')
    expect(repoContextOutputJson.oneOf).toHaveLength(2)
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
      requireRepository: true,
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

  it('dispatches review with a supplied source without calling resolveEffectiveRepoRoot when INVALID_REPOSITORY is thrown', async () => {
    // Create server in deferred mode (no bound root) so resolveEffectiveRepoRoot falls through to INVALID_REPOSITORY.
    // This overwrites the registrations map with the deferred-mode server's handlers.
    createCocoMcpServer()

    const result = await registrations.get('coco_review')!.handler({
      source: { kind: 'summary', summary: 'changed' },
    }, makeExtra())

    // Should succeed: supplied source + no repo → requireRepository: false, falls back to cwd.
    expect(result).toMatchObject({
      structuredContent: { ok: true, operation: 'review' },
    })
    expect(mockCreateAgentOperationContext).toHaveBeenCalledWith(
      expect.objectContaining({ requireRepository: false }),
    )
  })

  it('emits a commit-draft-specific INVALID_REPOSITORY message when no repository resolves', async () => {
    const { AgentOperationError } = jest.requireActual('../operations/agent/errors') as typeof import('../operations/agent/errors')
    mockResolveAgentRepoRoot.mockRejectedValueOnce(
      new AgentOperationError('INVALID_REPOSITORY', 'Not a git repository: /tmp/notgit'),
    )
    createServer()

    const result = await tool('coco_commit_draft').handler({
      source: { kind: 'summary', summary: 'changed' },
    }, makeExtra())

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        operation: 'commit-draft',
        error: {
          code: 'INVALID_REPOSITORY',
          message: expect.stringContaining('commit-draft requires a git repository'),
          retryable: false,
        },
      },
    })
    expect(mockCreateAgentOperationContext).not.toHaveBeenCalled()
  })

  it('re-throws CANCELLED instead of falling back to a no-repo context for supplied sources', async () => {
    const { AgentOperationError } = jest.requireActual('../operations/agent/errors') as typeof import('../operations/agent/errors')
    mockResolveAgentRepoRoot.mockRejectedValueOnce(
      new AgentOperationError('CANCELLED', 'Request was cancelled.'),
    )
    // Bound mode guarantees resolveEffectiveRepoRoot calls through to
    // resolveAgentRepoRoot (mocked above) regardless of the input's repo field.
    createServer()

    const result = await tool('coco_review').handler({
      source: { kind: 'summary', summary: 'changed' },
    }, makeExtra())

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        operation: 'review',
        error: { code: 'CANCELLED' },
      },
    })
    expect(mockCreateAgentOperationContext).not.toHaveBeenCalled()
  })

  it('rejects a stray trustRepositoryConfig option with a structured INVALID_INPUT error (UNSAFE_OPTION is unreachable via MCP)', async () => {
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
        error: { code: 'INVALID_INPUT', retryable: false },
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

  it('registers five read-only repository resources with static URIs', () => {
    createServer()

    expect([...resourceRegistrations.keys()]).toEqual([
      'coco_repo_status',
      'coco_repo_diff_staged',
      'coco_repo_branch_context',
      'coco_repo_log_recent',
      'coco_repo_config',
    ])
    expect(resourceRegistrations.get('coco_repo_status')?.uri).toBe('coco://repo/status')
    expect(resourceRegistrations.get('coco_repo_diff_staged')?.uri).toBe('coco://repo/diff/staged')
    expect(resourceRegistrations.get('coco_repo_branch_context')?.uri).toBe('coco://repo/branch-context')
    expect(resourceRegistrations.get('coco_repo_log_recent')?.uri).toBe('coco://repo/log/recent')
    expect(resourceRegistrations.get('coco_repo_config')?.uri).toBe('coco://repo/config')
    for (const registration of resourceRegistrations.values()) {
      expect(registration.config.description).toEqual(expect.stringContaining('Read-only'))
    }
    expect(resourceRegistrations.get('coco_repo_config')?.config.mimeType).toBe('application/json')
    for (const name of ['coco_repo_status', 'coco_repo_diff_staged', 'coco_repo_branch_context', 'coco_repo_log_recent']) {
      expect(resourceRegistrations.get(name)?.config.mimeType).toBe('text/plain')
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

  it('reads the resolved repo config as JSON with a digest and no credentials', async () => {
    createServer()

    const result = await resource('coco_repo_config').readCallback(
      new URL('coco://repo/config'),
      { signal: new AbortController().signal },
    )

    expect(mockGetRepoConfig).toHaveBeenCalled()
    expect(result).toMatchObject({
      contents: [{
        uri: 'coco://repo/config',
        mimeType: 'application/json',
        _meta: { digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) },
      }],
    })
    const parsed = JSON.parse((result.contents as Array<{ text: string }>)[0].text)
    expect(parsed).toMatchObject({
      defaultBranch: 'main',
      service: { provider: 'anthropic', model: 'claude-sonnet-4-6', tokenLimit: 4096 },
      telemetry: { usage: false },
      ignoredFiles: ['*.lock'],
      ignoredExtensions: ['.map'],
    })
    const serialized = JSON.stringify(parsed)
    expect(serialized).not.toContain('apiKey')
    expect(serialized).not.toContain('authentication')
    expect(serialized).not.toContain('secretAccessKey')
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

  it('wires a progress reporter into coco_condense_diff when a progressToken is present', async () => {
    createServer()
    let capturedOnProgress: ((update: { message?: string; fraction?: number }) => void) | undefined
    mockCreateAgentOperationContext.mockImplementationOnce(async (input: { onProgress?: typeof capturedOnProgress }) => {
      capturedOnProgress = input.onProgress
      return { signal: undefined } as never
    })
    const sendNotification = jest.fn(async () => undefined)

    await tool('coco_condense_diff').handler({
      source: { kind: 'summary', summary: 'changed' },
      budget: { tokens: 1000 },
    }, makeExtra({ _meta: { progressToken: 'token-4' }, sendNotification }))

    expect(capturedOnProgress).toBeInstanceOf(Function)
    capturedOnProgress!({ message: 'Resolved diff', fraction: 0.3 })
    capturedOnProgress!({ message: 'Condensing a.ts', fraction: 0.6 })
    capturedOnProgress!({ message: 'Completed', fraction: 1 })

    expect(sendNotification).toHaveBeenNthCalledWith(1, {
      method: 'notifications/progress',
      params: { progressToken: 'token-4', progress: 0.3, total: 1, message: 'Resolved diff' },
    })
    expect(sendNotification).toHaveBeenNthCalledWith(3, {
      method: 'notifications/progress',
      params: { progressToken: 'token-4', progress: 1, total: 1, message: 'Completed' },
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

  it('rejects a stray trustRepositoryConfig on coco_condense_diff with INVALID_INPUT (UNSAFE_OPTION is unreachable via MCP)', async () => {
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
        error: { code: 'INVALID_INPUT', retryable: false },
      },
    })
    expect(mockCreateAgentOperationContext).not.toHaveBeenCalled()
    expect(mockRunCondenseDiff).not.toHaveBeenCalled()
  })

  it('builds a progress reporter and forwards notifications/progress with fraction-derived progress/total when a progressToken is present', async () => {
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
    capturedOnProgress!({ message: 'Resolved changes', fraction: 0.2 })
    capturedOnProgress!({ message: 'Generating review…', fraction: 0.4 })

    expect(sendNotification).toHaveBeenNthCalledWith(1, {
      method: 'notifications/progress',
      params: { progressToken: 'token-1', progress: 0.2, total: 1, message: 'Resolved changes' },
    })
    expect(sendNotification).toHaveBeenNthCalledWith(2, {
      method: 'notifications/progress',
      params: { progressToken: 'token-1', progress: 0.4, total: 1, message: 'Generating review…' },
    })
  })

  it('keeps progress non-decreasing when a later tick carries no fraction', async () => {
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
    capturedOnProgress!({ message: 'Generating review…', fraction: 0.4 })
    capturedOnProgress!({ message: 'Generating review…' })

    expect(sendNotification).toHaveBeenNthCalledWith(2, {
      method: 'notifications/progress',
      params: { progressToken: 'token-1', progress: 0.4, total: 1, message: 'Generating review…' },
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

  it('routes coco_repo_context to runRepoContext and returns a structured result', async () => {
    createServer()
    const controller = new AbortController()

    const result = await tool('coco_repo_context').handler(
      {},
      makeExtra({ signal: controller.signal }),
    )

    expect(mockResolveAgentRepoRoot).toHaveBeenCalledWith(undefined, '/repo', controller.signal)
    expect(mockRunRepoContext).toHaveBeenCalled()
    expect(result).toMatchObject({
      structuredContent: expect.objectContaining({
        ok: true,
        operation: 'repo-context',
      }),
    })
  })

  it('returns a structured error when coco_repo_context fails', async () => {
    createServer()
    mockRunRepoContext.mockRejectedValueOnce(new Error('git unavailable'))

    const result = await tool('coco_repo_context').handler({}, makeExtra())

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        operation: 'repo-context',
        error: { code: 'OPERATION_FAILED', message: 'git unavailable' },
      },
    })
  })

  it('returns validation failures for invalid coco_repo_context input', async () => {
    createServer()

    const result = await tool('coco_repo_context').handler(
      { historyLimit: 0 },  // min is 1 — should fail validation
      makeExtra(),
    )

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        operation: 'repo-context',
        error: { code: 'INVALID_INPUT' },
      },
    })
  })
})
