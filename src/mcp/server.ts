import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { BUILD_VERSION } from '../lib/buildInfo'
import {
    AgentOperation,
    AgentOperationError,
    AgentTaskInputSchema,
    ChangelogDataSchema,
    CommitDraftDataSchema,
    CondenseDiffDataSchema,
    CondenseDiffRequestSchema,
    createAgentFailureEnvelope,
    createAgentMcpOutputSchema,
    createAgentOperationContext,
    isPathWithinRoot,
    RecapDataSchema,
    resolveAgentDirectoryRoot,
    resolveAgentRepoRoot,
    ReviewDataSchema,
    runAgentOperation,
    runCondenseDiff,
    toAgentOperationError,
} from '../operations/agent'

function outputSchemaFor(operation: AgentOperation) {
  switch (operation) {
    case 'commit-draft':
      return createAgentMcpOutputSchema(operation, CommitDraftDataSchema)
    case 'review':
      return createAgentMcpOutputSchema(operation, ReviewDataSchema)
    case 'changelog':
      return createAgentMcpOutputSchema(operation, ChangelogDataSchema)
    case 'recap':
      return createAgentMcpOutputSchema(operation, RecapDataSchema)
    case 'condense-diff':
      return createAgentMcpOutputSchema(operation, CondenseDiffDataSchema)
  }
}

/**
 * Resolve the first git repository root found among the MCP client's
 * declared roots. Returns `undefined` if the client does not declare
 * roots or none of them contain a git repository.
 */
async function resolveRepoFromClientRoots(server: McpServer): Promise<string | undefined> {
  if (!server.server.getClientCapabilities()?.roots) return undefined
  const { roots } = await server.server.listRoots()
  for (const root of roots) {
    if (!root.uri.startsWith('file://')) continue
    try {
      const dir = resolveAgentDirectoryRoot(fileURLToPath(root.uri))
      const resolved = await resolveAgentRepoRoot(dir)
      return resolved
    } catch {
      // Not a git repo or not a valid directory — skip.
    }
  }
  return undefined
}

async function assertClientAllowsRoot(server: McpServer, repoRoot: string): Promise<void> {
  if (!server.server.getClientCapabilities()?.roots) return
  const { roots } = await server.server.listRoots()
  const allowed = roots.some((root) => {
    if (!root.uri.startsWith('file://')) return false
    try {
      const clientRoot = resolveAgentDirectoryRoot(fileURLToPath(root.uri))
      return isPathWithinRoot(repoRoot, clientRoot)
    } catch {
      return false
    }
  })
  if (!allowed) {
    throw new AgentOperationError(
      'REPOSITORY_OUTSIDE_ROOT',
      `The MCP client did not expose '${repoRoot}' as an allowed filesystem root.`,
    )
  }
}

/**
 * Resolve the effective repository root for a tool call. In bound mode
 * (explicit `--repo`), the server enforces single-repo confinement. In
 * deferred mode (no `--repo`), the repo is resolved per-call from:
 *   1. The `repo` field in the tool input, OR
 *   2. The first git root found in the client's declared roots.
 */
async function resolveEffectiveRepoRoot(
  server: McpServer,
  inputRepo: string | undefined,
  boundRoot: string | undefined,
  signal?: AbortSignal,
): Promise<string> {
  // Bound mode: --repo was explicitly provided at server start.
  if (boundRoot) {
    const requestedRoot = await resolveAgentRepoRoot(inputRepo, boundRoot, signal)
    if (requestedRoot !== boundRoot) {
      throw new AgentOperationError(
        'REPOSITORY_MISMATCH',
        `This coco MCP server is bound to '${boundRoot}'. Start another server for '${requestedRoot}'.`,
      )
    }
    return boundRoot
  }

  // Deferred mode: resolve from input.repo or client roots.
  if (inputRepo) {
    return resolveAgentRepoRoot(inputRepo, undefined, signal)
  }

  const fromRoots = await resolveRepoFromClientRoots(server)
  if (fromRoots) return fromRoots

  throw new AgentOperationError(
    'INVALID_REPOSITORY',
    'No repository specified. Either pass a `repo` field in the tool input, declare a workspace root containing a git repository, or start the server with `--repo <path>`.',
  )
}

function registerGenerationTool(
  server: McpServer,
  operation: AgentOperation,
  title: string,
  description: string,
  boundRoot: string | undefined,
): void {
  server.registerTool(`coco_${operation.replace('-', '_')}`, {
    title,
    description,
    inputSchema: AgentTaskInputSchema,
    outputSchema: outputSchemaFor(operation),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, async (rawInput, extra) => {
    try {
      const input = AgentTaskInputSchema.parse(rawInput)
      if (input.options.trustRepositoryConfig) {
        throw new AgentOperationError(
          'UNSAFE_OPTION',
          'MCP tools do not execute repository-defined prompts or commitlint configuration. Use the one-shot agent CLI only for explicitly trusted repositories.',
        )
      }
      const repoRoot = await resolveEffectiveRepoRoot(server, input.repo, boundRoot, extra.signal)
      await assertClientAllowsRoot(server, repoRoot)
      const progressToken = extra._meta?.progressToken
      let progressCounter = 0
      const onProgress = progressToken === undefined
        ? undefined
        : (update: { message?: string; fraction?: number }) => {
          void extra.sendNotification({
            method: 'notifications/progress',
            params: {
              progressToken,
              progress: ++progressCounter,
              message: update.message,
            },
          }).catch(() => {
            // Fire-and-forget: a client that closed its notification
            // channel mid-call must never fail the underlying operation.
          })
        }
      const context = await createAgentOperationContext({
        repoRoot,
        signal: extra.signal,
        surface: 'mcp',
        onProgress,
      })
      const result = await runAgentOperation(operation, input, context)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      }
    } catch (error) {
      const failure = createAgentFailureEnvelope(operation, toAgentOperationError(error))
      return {
        isError: true,
        content: [{ type: 'text' as const, text: JSON.stringify(failure, null, 2) }],
        structuredContent: failure,
      }
    }
  })
}

export function createCocoMcpServer(repoRoot?: string): McpServer {
  const instructions = [
    repoRoot
      ? `This server is bound to the git repository at ${repoRoot}.`
      : 'This server resolves the target repository from the workspace roots declared by the MCP client, or from the `repo` field in each tool input.',
    'All tools generate structured drafts or analysis only.',
    'No tool creates commits, writes repository files, posts comments, or mutates a forge.',
    'If local usage analytics are enabled, coco appends metadata-only call statistics to its user cache; prompts, diffs, and code are never recorded.',
    'Repository-defined prompts and executable commitlint configuration are never enabled by MCP tools.',
    'Prefer a supplied summary source when the calling agent already understands the change.',
  ].join(' ')

  const server = new McpServer({
    name: 'coco',
    version: BUILD_VERSION,
  }, {
    instructions,
  })

  registerGenerationTool(
    server,
    'commit-draft',
    'Generate commit message',
    'Generate a commit-message draft from repository changes or supplied context. Conventional mode uses built-in validation without loading repository config. Never creates a commit.',
    repoRoot,
  )
  registerGenerationTool(
    server,
    'review',
    'Review changes',
    'Review repository changes or supplied context and return structured findings. Never posts comments or modifies files.',
    repoRoot,
  )
  registerGenerationTool(
    server,
    'changelog',
    'Generate changelog',
    'Generate a structured changelog from repository changes or supplied context. Never writes CHANGELOG.md.',
    repoRoot,
  )
  registerGenerationTool(
    server,
    'recap',
    'Recap changes',
    'Generate a structured recap from repository changes or supplied context.',
    repoRoot,
  )

  // condense-diff uses its own input schema (CondenseDiffRequestSchema) and
  // dispatches to runCondenseDiff, so it is registered separately rather than
  // through registerGenerationTool.
  server.registerTool('coco_condense_diff', {
    title: 'Condense diff',
    description: [
      'Reduce a diff to a semantically condensed representation within a token budget.',
      'Uses tree-sitter / regex structural extractors — no LLM call, no API key required in structural mode (the default).',
      'Per-file metrics report whether structural extraction, a trivial-shape shortcut, or line-based fallback was applied.',
      'Files omitted to meet the budget are reported in metrics.filesOmitted.',
      'The result is a LOSSY reduction; findings based on it may miss details from omitted or simplified content.',
    ].join(' '),
    inputSchema: CondenseDiffRequestSchema,
    outputSchema: outputSchemaFor('condense-diff'),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async (rawInput, extra) => {
    const operation = 'condense-diff' as const
    try {
      const input = CondenseDiffRequestSchema.parse(rawInput)
      if (input.trustRepositoryConfig) {
        throw new AgentOperationError(
          'UNSAFE_OPTION',
          'MCP tools do not execute repository-defined prompts or commitlint configuration. Use the one-shot agent CLI only for explicitly trusted repositories.',
        )
      }
      // repoRoot here shadows the outer parameter, using it as the "boundRoot"
      // to match the single-repo confinement pattern of the other tools.
      const resolvedRepoRoot = await resolveEffectiveRepoRoot(server, input.repo, repoRoot, extra.signal)
      await assertClientAllowsRoot(server, resolvedRepoRoot)
      const context = await createAgentOperationContext({
        repoRoot: resolvedRepoRoot,
        signal: extra.signal,
        surface: 'mcp',
      })
      const result = await runCondenseDiff(input, context)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      }
    } catch (error) {
      const failure = createAgentFailureEnvelope(operation, toAgentOperationError(error))
      return {
        isError: true,
        content: [{ type: 'text' as const, text: JSON.stringify(failure, null, 2) }],
        structuredContent: failure,
      }
    }
  })

  return server
}

export async function startCocoMcpServer(repoRoot?: string): Promise<void> {
  const server = createCocoMcpServer(repoRoot)
  await server.connect(new StdioServerTransport())
  if (repoRoot) {
    process.stderr.write(`coco MCP server ${BUILD_VERSION} bound to ${repoRoot}\n`)
  } else {
    process.stderr.write(`coco MCP server ${BUILD_VERSION} started (repo resolved from client roots)\n`)
  }
}
