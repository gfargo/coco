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
    createAgentFailureEnvelope,
    createAgentMcpOutputSchema,
    createAgentOperationContext,
    isPathWithinRoot,
    RecapDataSchema,
    resolveAgentDirectoryRoot,
    resolveAgentRepoRoot,
    ReviewDataSchema,
    runAgentOperation,
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
  }
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

function registerGenerationTool(
  server: McpServer,
  operation: AgentOperation,
  title: string,
  description: string,
  repoRoot: string,
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
      await assertClientAllowsRoot(server, repoRoot)
      const input = AgentTaskInputSchema.parse(rawInput)
      if (input.options.trustRepositoryConfig) {
        throw new AgentOperationError(
          'UNSAFE_OPTION',
          'MCP tools do not execute repository-defined prompts or commitlint configuration. Use the one-shot agent CLI only for explicitly trusted repositories.',
        )
      }
      const requestedRoot = await resolveAgentRepoRoot(input.repo, repoRoot, extra.signal)
      if (requestedRoot !== repoRoot) {
        throw new AgentOperationError(
          'REPOSITORY_MISMATCH',
          `This coco MCP server is bound to '${repoRoot}'. Start another server for '${requestedRoot}'.`,
        )
      }
      const context = await createAgentOperationContext({
        repoRoot,
        signal: extra.signal,
        surface: 'mcp',
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

export function createCocoMcpServer(repoRoot: string): McpServer {
  const server = new McpServer({
    name: 'coco',
    version: BUILD_VERSION,
  }, {
    instructions: [
      `This server is bound to the git repository at ${repoRoot}.`,
      'All tools generate structured drafts or analysis only.',
      'No tool creates commits, writes repository files, posts comments, or mutates a forge.',
      'If local usage analytics are enabled, coco appends metadata-only call statistics to its user cache; prompts, diffs, and code are never recorded.',
      'Repository-defined prompts and executable commitlint configuration are never enabled by MCP tools.',
      'Prefer a supplied summary source when the calling agent already understands the change.',
    ].join(' '),
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

  return server
}

export async function startCocoMcpServer(repoRoot: string): Promise<void> {
  const server = createCocoMcpServer(repoRoot)
  await server.connect(new StdioServerTransport())
  process.stderr.write(`coco MCP server ${BUILD_VERSION} bound to ${repoRoot}\n`)
}
