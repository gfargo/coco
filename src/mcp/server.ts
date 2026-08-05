import { fileURLToPath } from 'node:url'
import { PromptTemplate } from '@langchain/core/prompts'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { CHANGELOG_PROMPT } from '../commands/changelog/prompt'
import { COMMIT_PROMPT, CONVENTIONAL_COMMIT_PROMPT } from '../commands/commit/prompt'
import { RECAP_PROMPT } from '../commands/recap/prompt'
import { REVIEW_PROMPT } from '../commands/review/prompt'
import { BUILD_VERSION } from '../lib/buildInfo'
import { getPrompt } from '../lib/langchain/utils/getPrompt'
import {
    AgentOperation,
    AgentOperationContext,
    AgentOperationError,
    AgentTaskInputSchema,
    ChangelogDataSchema,
    CommitDraftDataSchema,
    CondenseDiffDataSchema,
    CondenseDiffRequestSchema,
    createAgentFailureEnvelope,
    createAgentMcpOutputSchema,
    createAgentOperationContext,
    describeRepoResolutionFailure,
    digestOf,
    getBranchContext,
    getRecentLog,
    getRepoStatus,
    getStagedDiff,
    isPathWithinRoot,
    RecapDataSchema,
    RepoContextDataSchema,
    RepoContextRequestSchema,
    requiresRepository,
    resolveAgentDirectoryRoot,
    resolveAgentRepoRoot,
    ReviewDataSchema,
    runAgentOperation,
    runCondenseDiff,
    runRepoContext,
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
    case 'repo-context':
      return createAgentMcpOutputSchema(operation, RepoContextDataSchema)
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

/**
 * Build a transport-agnostic progress reporter that forwards coco's internal
 * `fraction` (0.0-1.0) as the MCP-spec `progress`/`total` pair so clients can
 * render a determinate progress bar. Returns `undefined` when the client did
 * not supply a `progressToken` (progress notifications are opt-in per spec).
 */
function makeMcpProgressReporter(
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
): ((update: { message?: string; fraction?: number }) => void) | undefined {
  const progressToken = extra._meta?.progressToken
  if (progressToken === undefined) return undefined
  let lastProgress = 0
  return (update: { message?: string; fraction?: number }) => {
    if (typeof update.fraction === 'number' && Number.isFinite(update.fraction)) {
      // Clamp to [0,1] and keep non-decreasing so the bar only moves forward,
      // even if a later tick carries no fraction (e.g. streaming liveness ticks).
      lastProgress = Math.min(1, Math.max(lastProgress, update.fraction))
    }
    void extra.sendNotification({
      method: 'notifications/progress',
      params: {
        progressToken,
        progress: lastProgress,
        total: 1,
        message: update.message,
      },
    }).catch(() => {
      // Fire-and-forget: a client that closed its notification
      // channel mid-call must never fail the underlying operation.
    })
  }
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

      const needsRepo = requiresRepository(operation, input.source)
      let repoRoot: string
      let requireRepository: boolean

      if (needsRepo) {
        // Repository-derived sources and commit-draft require a real repository.
        try {
          repoRoot = await resolveEffectiveRepoRoot(server, input.repo, boundRoot, extra.signal)
        } catch (error) {
          if (error instanceof AgentOperationError && error.code === 'INVALID_REPOSITORY' && operation === 'commit-draft') {
            throw new AgentOperationError(
              'INVALID_REPOSITORY',
              `commit-draft requires a git repository: it reads branch context and recent commit history even when a prepared summary is supplied (${describeRepoResolutionFailure(error)}).`,
              false,
            )
          }
          throw error
        }
        await assertClientAllowsRoot(server, repoRoot)
        requireRepository = true
      } else {
        // Supplied-source operations: try repo resolution for head verification,
        // but skip it gracefully when no repository is available or declared.
        try {
          repoRoot = await resolveEffectiveRepoRoot(server, input.repo, boundRoot, extra.signal)
          await assertClientAllowsRoot(server, repoRoot)
          requireRepository = true
        } catch (error) {
          if (error instanceof AgentOperationError) {
            // Re-throw confinement/cancellation errors — these are real policy
            // violations, not "no repo" conditions.
            if (error.code === 'REPOSITORY_OUTSIDE_ROOT' || error.code === 'REPOSITORY_MISMATCH' || error.code === 'CANCELLED') throw error
            // INVALID_REPOSITORY is expected when the client has no git roots
            // and no repo field was supplied. Fall back to cwd for config only.
          } else {
            throw error
          }
          // Use process.cwd() for config discovery only — never bound as a repo.
          repoRoot = resolveAgentDirectoryRoot(process.cwd())
          requireRepository = false
        }
      }

      const onProgress = makeMcpProgressReporter(extra)
      const context = await createAgentOperationContext({
        repoRoot,
        requireRepository,
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

function registerRepoResource(
  server: McpServer,
  name: string,
  uri: string,
  title: string,
  description: string,
  boundRoot: string | undefined,
  loader: (context: AgentOperationContext) => Promise<string>,
): void {
  server.registerResource(name, uri, {
    title,
    description,
    mimeType: 'text/plain',
  }, async (resourceUri, extra) => {
    try {
      const repoRoot = await resolveEffectiveRepoRoot(server, undefined, boundRoot, extra.signal)
      await assertClientAllowsRoot(server, repoRoot)
      const context = await createAgentOperationContext({
        repoRoot,
        signal: extra.signal,
        surface: 'mcp',
      })
      const text = (await loader(context)).trim() || 'No content available.'
      return {
        contents: [{
          uri: resourceUri.href,
          mimeType: 'text/plain',
          text,
          _meta: { digest: digestOf(text) },
        }],
      }
    } catch (error) {
      const failure = toAgentOperationError(error)
      return {
        contents: [{
          uri: resourceUri.href,
          mimeType: 'application/json',
          text: JSON.stringify({
            error: { code: failure.code, message: failure.message, retryable: failure.retryable },
          }, null, 2),
        }],
      }
    }
  })
}

async function renderPromptTemplate(
  template: PromptTemplate,
  args: Record<string, string | undefined>,
): Promise<string> {
  const values: Record<string, string> = {}
  for (const variable of template.inputVariables) {
    values[variable] = args[variable] ?? ''
  }
  // The coco prompt templates use `{{var}}` (mustache) placeholders; PromptTemplate.format
  // on the module-level instances defaults to f-string and would leave them unrendered.
  const mustacheTemplate = getPrompt({
    template: template.template as string,
    variables: template.inputVariables,
    fallback: template,
  })
  return mustacheTemplate.format(values)
}

function registerCocoPrompt(
  server: McpServer,
  name: string,
  title: string,
  description: string,
  template: PromptTemplate,
): void {
  const argsSchema = Object.fromEntries(
    template.inputVariables.map((variable) => [
      variable,
      z.string().optional().describe(`Value for the \`${variable}\` template variable. Defaults to empty.`),
    ]),
  )
  server.registerPrompt(name, { title, description, argsSchema }, async (args) => {
    const text = await renderPromptTemplate(template, args as Record<string, string | undefined>)
    return {
      messages: [{
        role: 'user' as const,
        content: { type: 'text' as const, text },
      }],
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
    'Resources (coco://repo/...) expose read-only repository context (status, staged diff, branch context, recent log) so a client can browse without spending a tool call.',
    'Prompts expose coco\'s built-in commit, review, changelog, and recap templates for reuse by any MCP client.',
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
      const onProgress = makeMcpProgressReporter(extra)
      const context = await createAgentOperationContext({
        repoRoot: resolvedRepoRoot,
        signal: extra.signal,
        surface: 'mcp',
        onProgress,
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

  // coco_repo_context uses its own input schema (RepoContextRequestSchema) and
  // dispatches to runRepoContext. No LLM call, no API key required.
  // Read-only, root-confined, no diff content in the response.
  server.registerTool('coco_repo_context', {
    title: 'Repository context',
    description: [
      'Return a bounded, structured snapshot of the repository state: branch/upstream/divergence,',
      'working-tree status (staged, unstaged, untracked, conflicted) with rename-aware numstat,',
      'recent commit history, in-progress operation (merge/rebase/cherry-pick) with conflict file list,',
      'and repository capabilities (forge, commitlint config, worktree, shallow).',
      'Section selection via `include` — defaults to ["branch","status"].',
      'Every list is capped and reports totalCount + truncated.',
      'No diff/patch content is ever included. No LLM call, no API key required.',
      'Read-only; never writes repository files, creates commits, or calls a forge.',
    ].join(' '),
    inputSchema: RepoContextRequestSchema,
    outputSchema: outputSchemaFor('repo-context'),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async (rawInput, extra) => {
    const repoContextOperation = 'repo-context' as const
    try {
      const input = RepoContextRequestSchema.parse(rawInput)
      const resolvedRepoRoot = await resolveEffectiveRepoRoot(server, input.repo, repoRoot, extra.signal)
      await assertClientAllowsRoot(server, resolvedRepoRoot)
      const context = await createAgentOperationContext({
        repoRoot: resolvedRepoRoot,
        signal: extra.signal,
        surface: 'mcp',
      })
      const result = await runRepoContext(input, context)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      }
    } catch (error) {
      const failure = createAgentFailureEnvelope(repoContextOperation, toAgentOperationError(error))
      return {
        isError: true,
        content: [{ type: 'text' as const, text: JSON.stringify(failure, null, 2) }],
        structuredContent: failure,
      }
    }
  })

  registerRepoResource(
    server,
    'coco_repo_status',
    'coco://repo/status',
    'Repository status',
    'Current working tree status (`git status --porcelain=v1 -b`). Read-only.',
    repoRoot,
    getRepoStatus,
  )
  registerRepoResource(
    server,
    'coco_repo_diff_staged',
    'coco://repo/diff/staged',
    'Staged diff',
    'Diff of currently staged changes (`git diff --cached`). Read-only.',
    repoRoot,
    getStagedDiff,
  )
  registerRepoResource(
    server,
    'coco_repo_branch_context',
    'coco://repo/branch-context',
    'Branch context',
    'Current branch name, upstream, and ahead/behind counts. Read-only.',
    repoRoot,
    getBranchContext,
  )
  registerRepoResource(
    server,
    'coco_repo_log_recent',
    'coco://repo/log/recent',
    'Recent commit log',
    'Recent commit history (`git log --oneline`, bounded to 20 entries). Read-only.',
    repoRoot,
    (context) => getRecentLog(context),
  )

  registerCocoPrompt(
    server,
    'coco_commit_prompt',
    'Commit message prompt',
    "coco's built-in commit-message generation prompt template.",
    COMMIT_PROMPT,
  )
  registerCocoPrompt(
    server,
    'coco_conventional_commit_prompt',
    'Conventional commit prompt',
    "coco's built-in Conventional Commits generation prompt template.",
    CONVENTIONAL_COMMIT_PROMPT,
  )
  registerCocoPrompt(
    server,
    'coco_review_prompt',
    'Review prompt',
    "coco's built-in code review prompt template.",
    REVIEW_PROMPT,
  )
  registerCocoPrompt(
    server,
    'coco_changelog_prompt',
    'Changelog prompt',
    "coco's built-in changelog generation prompt template.",
    CHANGELOG_PROMPT,
  )
  registerCocoPrompt(
    server,
    'coco_recap_prompt',
    'Recap prompt',
    "coco's built-in recap generation prompt template.",
    RECAP_PROMPT,
  )

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
