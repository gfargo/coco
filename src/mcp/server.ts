import { fileURLToPath } from 'node:url'
import type { QualifiedConfig } from '@commitlint/types'
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
import { getLanguageContext } from '../lib/langchain/utils/languageContext'
import { formatCommitlintRulesForPrompt } from '../lib/utils/commitlintValidator'
import {
    AgentOperation,
    AgentOperationContext,
    AgentOperationError,
    asUntrustedChangeContext,
    BlameDataSchema,
    BlameRequestSchema,
    CapabilitiesRequestSchema,
    CapabilitiesResultSchema,
    ChangelogDataSchema,
    CommitApplyDataSchema,
    CommitApplyRequestSchema,
    CommitDraftDataSchema,
    CondenseDiffDataSchema,
    createAgentFailureEnvelope,
    createAgentMcpOutputSchema,
    createAgentOperationContext,
    describeRepoResolutionFailure,
    digestOf,
    getBranchContext,
    getRecentLog,
    getRepoConfig,
    getRepoStatus,
    getRepoTree,
    getStagedDiff,
    isPathWithinRoot,
    LintDataSchema,
    LintRequestSchema,
    MAX_BLAME_EXPLAIN_COMMITS,
    MAX_BLAME_EXPLAIN_LINES,
    McpCondenseDiffRequestSchema,
    McpTaskInputSchema,
    RecapDataSchema,
    RepoContextDataSchema,
    RepoContextRequestSchema,
    requiresRepository,
    resolveAgentDirectoryRoot,
    resolveAgentRepoRoot,
    ReviewDataSchema,
    runAgentOperation,
    runBlame,
    runCapabilities,
    runCommitApply,
    runCondenseDiff,
    runLint,
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
    inputSchema: McpTaskInputSchema,
    outputSchema: outputSchemaFor(operation),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, async (rawInput, extra) => {
    try {
      const input = McpTaskInputSchema.parse(rawInput)

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
      const result = await runAgentOperation(operation, {
        ...input,
        options: { ...input.options, trustRepositoryConfig: false },
      }, context)
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

/**
 * Registers `coco_commit_apply` — the only write-capable tool coco's MCP
 * server exposes, and only when the server was started with `--allow-write`.
 * It commits whatever is currently staged; it never runs `git add` and never
 * pushes. This uses a bespoke flat request/response shape (not the versioned
 * `AgentSuccessEnvelope` the generation tools share) since commit-apply has
 * no `source`/`options` bag and isn't part of `AgentOperation`.
 */
function registerCommitApplyTool(server: McpServer, boundRoot: string | undefined): void {
  server.registerTool('coco_commit_apply', {
    title: 'Create commit from staged changes',
    description: [
      'Create a git commit from whatever is currently staged in the index.',
      'Does NOT stage files (no `git add`) and does NOT push.',
      'Refuses with EMPTY_INDEX when nothing is staged.',
      'Only available when the server was started with `coco mcp --allow-write`.',
    ].join(' '),
    inputSchema: CommitApplyRequestSchema,
    outputSchema: CommitApplyDataSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  }, async (rawInput, extra) => {
    try {
      const input = CommitApplyRequestSchema.parse(rawInput)
      const repoRoot = await resolveEffectiveRepoRoot(server, input.repo, boundRoot, extra.signal)
      await assertClientAllowsRoot(server, repoRoot)
      const context = await createAgentOperationContext({
        repoRoot,
        requireRepository: true,
        signal: extra.signal,
        surface: 'mcp',
      })
      const result = await runCommitApply(input, context)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      }
    } catch (error) {
      const failure = toAgentOperationError(error)
      const errorPayload = {
        error: { code: failure.code, message: failure.message, retryable: failure.retryable },
      }
      return {
        isError: true,
        content: [{ type: 'text' as const, text: JSON.stringify(errorPayload, null, 2) }],
        structuredContent: errorPayload,
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
  mimeType: string = 'text/plain',
): void {
  server.registerResource(name, uri, {
    title,
    description,
    mimeType,
  }, async (resourceUri, extra) => {
    try {
      const repoRoot = await resolveEffectiveRepoRoot(server, undefined, boundRoot, extra.signal)
      await assertClientAllowsRoot(server, repoRoot)
      const context = await createAgentOperationContext({
        repoRoot,
        signal: extra.signal,
        surface: 'mcp',
      })
      const raw = await loader(context)
      const text = mimeType === 'application/json' ? raw.trim() : raw.trim() || 'No content available.'
      return {
        contents: [{
          uri: resourceUri.href,
          mimeType,
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

/**
 * Render a coco prompt template to text. The exported `PromptTemplate`
 * instances (`COMMIT_PROMPT`, `REVIEW_PROMPT`, etc.) are built with LangChain's
 * default f-string format, under which `{{var}}` is an escaped literal — so
 * `.format()` on those instances directly does not substitute anything.
 * Rendering must go through `getPrompt` with `templateFormat: 'mustache'`,
 * exactly as coco's own generation path does.
 */
async function renderPromptTemplate(
  template: PromptTemplate,
  variables: Record<string, string>,
): Promise<string> {
  const values: Record<string, string> = {}
  for (const variable of template.inputVariables) {
    values[variable] = variables[variable] ?? ''
  }
  const mustacheTemplate = getPrompt({
    template: template.template as string,
    variables: template.inputVariables,
    fallback: template,
  })
  return mustacheTemplate.format(values)
}

/**
 * Populate `commitlint_rules_context` from a caller-supplied JSON string
 * (the `QualifiedConfig['rules']` shape, e.g. read from the caller's own
 * commitlint config) via the same formatter coco's own commit generation
 * uses. This never reads repository-defined commitlint config — the client
 * must pass its own rules; malformed JSON degrades to no rules block rather
 * than failing prompt rendering.
 */
function buildCommitlintRulesContext(rulesJson: string | undefined): string {
  if (!rulesJson) return ''
  try {
    const rules = JSON.parse(rulesJson) as QualifiedConfig['rules']
    return formatCommitlintRulesForPrompt({ rules })
  } catch {
    return ''
  }
}

function branchNameContextFor(branchName: string | undefined): string {
  return branchName ? `Current git branch name: ${branchName}` : ''
}

type CocoPromptSpec = {
  name: string
  title: string
  description: string
  template: PromptTemplate
  argsSchema: Record<string, z.ZodType>
  buildVariables: (args: Record<string, string | undefined>) => Record<string, string>
}

const COMMIT_FORMAT_INSTRUCTIONS = 'Return ONLY a valid JSON object with string fields "title" (imperative, <=50 characters) and "body" (a longer detailed summary, ~300 characters). No markdown, no code fences, no extra text.'
const CONVENTIONAL_COMMIT_FORMAT_INSTRUCTIONS = 'Return ONLY a valid JSON object with string fields "title" (Conventional Commits format `type(scope): description`, <=50 characters) and "body" (<=280 characters). No markdown, no code fences, no extra text.'
const REVIEW_FORMAT_INSTRUCTIONS = 'Return a JSON array of findings with title, summary, severity (1-10), category, and filePath.'
const CHANGELOG_FORMAT_INSTRUCTIONS = 'Return a JSON object with string fields title and content.'
const RECAP_FORMAT_INSTRUCTIONS = 'Return a JSON object with string fields title and summary.'

/**
 * Curated, typed argument specs for coco's built-in prompt templates. Every
 * template variable NOT exposed here is filled from a fixed built-in default
 * (never from repository config) so the rendered prompt is fully runnable —
 * `conventions_context` and `commit_history` in particular always render
 * empty, preserving the invariant that a repository-defined `prompt` (or any
 * other repo-sourced instruction text) is never served over MCP.
 */
function commitPromptArgsSchema(): Record<string, z.ZodType> {
  return {
    summary: z.string().describe('Diff summary or description of the change to generate a commit message for. Wrapped in untrusted-content framing before rendering.'),
    commitlint_rules: z.string().optional().describe('JSON-encoded commitlint rules object (the `QualifiedConfig["rules"]` shape, e.g. `{"header-max-length":[2,"always",72]}`) used to populate the Commitlint Rules block. Omit for no rules constraint.'),
    branch_name: z.string().optional().describe('Current branch name, included as context if provided.'),
  }
}

function buildCommitPromptSpec(
  name: string,
  title: string,
  description: string,
  template: PromptTemplate,
  formatInstructions: string,
): CocoPromptSpec {
  return {
    name,
    title,
    description,
    template,
    argsSchema: commitPromptArgsSchema(),
    buildVariables: (args) => ({
      summary: asUntrustedChangeContext(args.summary ?? ''),
      format_instructions: formatInstructions,
      additional_context: '',
      commit_history: '',
      branch_name_context: branchNameContextFor(args.branch_name),
      commitlint_rules_context: buildCommitlintRulesContext(args.commitlint_rules),
      language_context: '',
      conventions_context: '',
    }),
  }
}

function buildReviewPromptSpec(): CocoPromptSpec {
  return {
    name: 'coco_review_prompt',
    title: 'Review prompt',
    description: "coco's built-in code review prompt template. Args: changes (required), language (optional).",
    template: REVIEW_PROMPT,
    argsSchema: {
      changes: z.string().describe('The diff or change content to review. Wrapped in untrusted-content framing before rendering.'),
      language: z.string().optional().describe('Write review feedback in this language, e.g. "Spanish". Defaults to English.'),
    },
    buildVariables: (args) => ({
      changes: asUntrustedChangeContext(args.changes ?? ''),
      format_instructions: REVIEW_FORMAT_INSTRUCTIONS,
      language_context: getLanguageContext(args.language, { taskDescription: 'code review feedback' }),
      conventions_context: '',
      additional_context: '',
    }),
  }
}

function buildChangelogPromptSpec(): CocoPromptSpec {
  return {
    name: 'coco_changelog_prompt',
    title: 'Changelog prompt',
    description: "coco's built-in changelog generation prompt template. Args: summary (required), additional_context (optional), author (optional).",
    template: CHANGELOG_PROMPT,
    argsSchema: {
      summary: z.string().describe('Summary of commits/diffs to generate a changelog from. Wrapped in untrusted-content framing before rendering.'),
      additional_context: z.string().optional().describe('Extra guidance to include in the prompt.'),
      author: z.string().optional().describe('If set, instructs the model to include author attribution when present in the supplied summary.'),
    },
    buildVariables: (args) => ({
      summary: asUntrustedChangeContext(args.summary ?? ''),
      format_instructions: CHANGELOG_FORMAT_INSTRUCTIONS,
      additional_context: args.additional_context ? `## Additional Context\n${args.additional_context}` : '',
      author_instructions: args.author
        ? 'Include author attribution when it is present in the supplied context.'
        : 'Do not invent author attribution; include commit references only when present.',
      language_context: '',
      conventions_context: '',
    }),
  }
}

function buildRecapPromptSpec(): CocoPromptSpec {
  return {
    name: 'coco_recap_prompt',
    title: 'Recap prompt',
    description: "coco's built-in recap generation prompt template. Args: changes (required), timeframe (optional).",
    template: RECAP_PROMPT,
    argsSchema: {
      changes: z.string().describe('The diff or change content to summarize. Wrapped in untrusted-content framing before rendering.'),
      timeframe: z.string().optional().describe('Human-readable timeframe the changes span, e.g. "the last 7 days".'),
    },
    buildVariables: (args) => ({
      changes: asUntrustedChangeContext(args.changes ?? ''),
      timeframe: args.timeframe || 'provided change context',
      format_instructions: RECAP_FORMAT_INSTRUCTIONS,
      language_context: '',
      conventions_context: '',
      additional_context: '',
    }),
  }
}

function registerCocoPrompt(server: McpServer, spec: CocoPromptSpec): void {
  server.registerPrompt(spec.name, {
    title: spec.title,
    description: spec.description,
    argsSchema: spec.argsSchema,
  }, async (args) => {
    const variables = spec.buildVariables(args as Record<string, string | undefined>)
    const text = await renderPromptTemplate(spec.template, variables)
    return {
      messages: [{
        role: 'user' as const,
        content: { type: 'text' as const, text },
      }],
    }
  })
}

export function createCocoMcpServer(repoRoot?: string, allowWrite = false): McpServer {
  const instructions = [
    repoRoot
      ? `This server is bound to the git repository at ${repoRoot}.`
      : 'This server resolves the target repository from the workspace roots declared by the MCP client, or from the `repo` field in each tool input.',
    'All generation and read tools produce structured drafts or analysis only; they never create commits, write repository files, post comments, or mutate a forge.',
    allowWrite
      ? 'This server was started with --allow-write: coco_commit_apply is also registered. It creates a git commit from whatever is currently staged — it never runs `git add` and never pushes.'
      : 'coco_commit_apply is NOT registered on this server; start it with `coco mcp --allow-write` to opt into that write-capable tool.',
    'coco_capabilities is a zero-token handshake -- call it first to learn whether coco is usable, for which operations, with which model routing, and within what limits, before spending on a generation call. It never requires a repository.',
    'review, changelog, and recap accept `options.dryRun: true` to return a `status: "planned"` token/model plan instead of generating output -- no inference call, though the change source is still resolved (a git read for repository scope) and the same safety checks still apply. commit-draft does not support dryRun.',
    'Resources (coco://repo/...) expose read-only repository context (status, staged diff, branch context, recent log, tracked-file tree, resolved config) so a client can browse without spending a tool call.',
    'Prompts expose coco\'s built-in commit, review, changelog, and recap templates, fully rendered from curated arguments, for the client to run on its own model. Caller-supplied change content is wrapped in untrusted-content framing before rendering; repository-defined config is never used to source prompt text.',
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
    inputSchema: McpCondenseDiffRequestSchema,
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
      const input = McpCondenseDiffRequestSchema.parse(rawInput)
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
      const result = await runCondenseDiff({ ...input, trustRepositoryConfig: false }, context)
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

  // coco_blame uses its own input schema (BlameRequestSchema) and dispatches
  // to runBlame. No LLM call, no API key required unless `explain: true`.
  // Read-only, root-confined, never reads repository-defined prompt overrides.
  server.registerTool('coco_blame', {
    title: 'Blame file',
    description: [
      'Attribute each line of a repo-relative file to its introducing commit (`git blame`).',
      'Restrict to a subset of lines with `lines` ("10:50", "10:", or "10" — 1-based, inclusive).',
      'Set `explain: true` to resolve each blamed commit and ask an LLM why that range was introduced — the response',
      'then omits raw `lines` and returns `explanations` instead, one entry per introducing commit.',
      `Capped at ${MAX_BLAME_EXPLAIN_LINES} lines and ${MAX_BLAME_EXPLAIN_COMMITS} distinct commits per \`explain\` call;`,
      'narrow `lines` for larger files or ranges. Uncommitted/staged lines have no introducing commit and are never explained.',
      'MCP tools never read repository-defined prompt overrides — the built-in explanation prompt is always used.',
      'Read-only; never writes repository files, creates commits, or calls a forge.',
    ].join(' '),
    inputSchema: BlameRequestSchema,
    outputSchema: createAgentMcpOutputSchema('blame', BlameDataSchema),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, async (rawInput, extra) => {
    const operation = 'blame' as const
    try {
      const input = BlameRequestSchema.parse(rawInput)
      const resolvedRepoRoot = await resolveEffectiveRepoRoot(server, input.repo, repoRoot, extra.signal)
      await assertClientAllowsRoot(server, resolvedRepoRoot)
      const context = await createAgentOperationContext({
        repoRoot: resolvedRepoRoot,
        signal: extra.signal,
        surface: 'mcp',
      })
      const result = await runBlame(input, context)
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

  // coco_lint uses its own input schema (LintRequestSchema) and dispatches
  // to runLint. No LLM call, no API key required. Read-only, root-confined;
  // --fix is intentionally not exposed (rewriting commit history is not
  // read-only).
  server.registerTool('coco_lint', {
    title: 'Lint commit messages',
    description: [
      "Validate the subject/body of each commit in a range against coco's built-in Conventional Commits rules.",
      'Range defaults to `<defaultBranch>..HEAD`; override with `since` (`<since>..HEAD`) or an explicit `range`',
      '(mutually exclusive). Merge commits are reported with status `skipped`.',
      'Repository-defined commitlint configuration (commitlint.config.js etc.) is never loaded by this tool, even when',
      "present in the repository — MCP tools do not execute repository-defined configuration. Results may differ from",
      '`coco lint` on the command line when the repository customizes its commitlint rules.',
      '`--fix` is not exposed here: rewriting commit history is not read-only.',
      'Read-only; never rewrites history, creates commits, or calls a forge.',
    ].join(' '),
    inputSchema: LintRequestSchema,
    outputSchema: createAgentMcpOutputSchema('lint', LintDataSchema),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async (rawInput, extra) => {
    const operation = 'lint' as const
    try {
      const input = LintRequestSchema.parse(rawInput)
      const resolvedRepoRoot = await resolveEffectiveRepoRoot(server, input.repo, repoRoot, extra.signal)
      await assertClientAllowsRoot(server, resolvedRepoRoot)
      const context = await createAgentOperationContext({
        repoRoot: resolvedRepoRoot,
        signal: extra.signal,
        surface: 'mcp',
      })
      const result = await runLint(input, context)
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

  if (allowWrite) registerCommitApplyTool(server, repoRoot)

  // coco_capabilities is the zero-token, no-repository handshake: it never
  // requires a repository, so repo resolution failures degrade to "no repo"
  // (used only for optional commitlint-config detection) rather than erroring.
  server.registerTool('coco_capabilities', {
    title: 'Coco capabilities',
    description: [
      'Zero-token handshake: reports whether coco is usable, for which operations, with which model routing, and',
      'within what limits -- before spending on a generation call. Call this once per session.',
      'No repository is required. When one is available (bound at server start, declared via client roots, or',
      'passed as `repo`), capabilities additionally reports repository-level details like commitlint config detection.',
      '`authenticationReady: false` means no usable API key/credential is configured for the active provider --',
      'generation calls would fail with AUTHENTICATION_REQUIRED.',
      'Reports token counts and model routing only -- no pricing or currency figures.',
      'Read-only; makes no LLM call.',
    ].join(' '),
    inputSchema: CapabilitiesRequestSchema,
    outputSchema: CapabilitiesResultSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async (rawInput, extra) => {
    try {
      const input = CapabilitiesRequestSchema.parse(rawInput)
      let resolvedRepoRoot: string | undefined
      try {
        resolvedRepoRoot = await resolveEffectiveRepoRoot(server, input.repo, repoRoot, extra.signal)
        await assertClientAllowsRoot(server, resolvedRepoRoot)
      } catch {
        // No repository available (or not declared as an allowed client
        // root) -- capabilities degrades to the repo-optional report rather
        // than failing, since it must work before any repository is known.
        resolvedRepoRoot = undefined
      }
      const result = await runCapabilities(resolvedRepoRoot)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      }
    } catch (error) {
      const failure = toAgentOperationError(error)
      const errorPayload = {
        error: { code: failure.code, message: failure.message, retryable: failure.retryable },
      }
      return {
        isError: true,
        content: [{ type: 'text' as const, text: JSON.stringify(errorPayload, null, 2) }],
        structuredContent: errorPayload,
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
  registerRepoResource(
    server,
    'coco_repo_tree',
    'coco://repo/tree',
    'Repository tree',
    'Depth-limited (≤3 levels), entry-capped tracked-file listing (`git ls-tree`). Read-only.',
    repoRoot,
    (context) => getRepoTree(context),
  )
  registerRepoResource(
    server,
    'coco_repo_config',
    'coco://repo/config',
    'Repository configuration',
    'Resolved (merged) coco configuration — provider, model, token limits, ignore patterns, telemetry state. Credentials omitted. Read-only.',
    repoRoot,
    getRepoConfig,
    'application/json',
  )

  registerCocoPrompt(server, buildCommitPromptSpec(
    'coco_commit_prompt',
    'Commit message prompt',
    "coco's built-in commit-message generation prompt template. Args: summary (required), commitlint_rules (optional), branch_name (optional).",
    COMMIT_PROMPT,
    COMMIT_FORMAT_INSTRUCTIONS,
  ))
  registerCocoPrompt(server, buildCommitPromptSpec(
    'coco_conventional_commit_prompt',
    'Conventional commit prompt',
    "coco's built-in Conventional Commits generation prompt template. Args: summary (required), commitlint_rules (optional), branch_name (optional).",
    CONVENTIONAL_COMMIT_PROMPT,
    CONVENTIONAL_COMMIT_FORMAT_INSTRUCTIONS,
  ))
  registerCocoPrompt(server, buildReviewPromptSpec())
  registerCocoPrompt(server, buildChangelogPromptSpec())
  registerCocoPrompt(server, buildRecapPromptSpec())

  return server
}

export async function startCocoMcpServer(repoRoot?: string, opts?: { allowWrite?: boolean }): Promise<void> {
  const allowWrite = opts?.allowWrite ?? false
  const server = createCocoMcpServer(repoRoot, allowWrite)
  await server.connect(new StdioServerTransport())
  const writeSuffix = allowWrite ? ', write mode enabled (coco_commit_apply registered)' : ''
  if (repoRoot) {
    process.stderr.write(`coco MCP server ${BUILD_VERSION} bound to ${repoRoot}${writeSuffix}\n`)
  } else {
    process.stderr.write(`coco MCP server ${BUILD_VERSION} started (repo resolved from client roots)${writeSuffix}\n`)
  }
}
