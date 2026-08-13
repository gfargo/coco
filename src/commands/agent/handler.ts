import { readFile } from 'node:fs/promises'
import { z } from 'zod'

import {
    AgentOperation,
    AgentOperationError,
    AgentTaskInputSchema,
    AGENT_PROTOCOL_VERSION,
    BlameDataSchema,
    BlameRequestSchema,
    ChangelogDataSchema,
    CommitDraftDataSchema,
    CondenseDiffDataSchema,
    CondenseDiffRequestSchema,
    ConflictResolveDataSchema,
    ConflictResolveRequestSchema,
    createAgentFailureEnvelope,
    createAgentInputJsonSchema,
    createAgentOperationContext,
    createAgentOutputSchema,
    createBlameInputJsonSchema,
    createCondenseDiffInputJsonSchema,
    createConflictResolveInputJsonSchema,
    createLintInputJsonSchema,
    createRepoContextInputJsonSchema,
    describeRepoResolutionFailure,
    LintDataSchema,
    LintRequestSchema,
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
    runCondenseDiff,
    runConflictResolve,
    runLint,
    runRepoContext,
    toAgentOperationError
} from '../../operations/agent'
import { armNonInteractiveUsageTelemetry } from '../utils/usageTelemetry'
import { AgentCommandArgv } from './config'

function emit(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

async function readRequest(input?: string): Promise<unknown> {
  if (!input && process.stdin.isTTY) return {}
  let raw: string
  if (input && input !== '-') {
    raw = await readFile(input, 'utf8')
  } else {
    process.stdin.setEncoding('utf8')
    const chunks: string[] = []
    for await (const chunk of process.stdin) chunks.push(String(chunk))
    raw = chunks.join('')
  }
  if (!raw.trim()) return {}
  return JSON.parse(raw)
}

function outputSchemaFor(operation: AgentOperation) {
  switch (operation) {
    case 'commit-draft':
      return createAgentOutputSchema(operation, CommitDraftDataSchema)
    case 'review':
      return createAgentOutputSchema(operation, ReviewDataSchema)
    case 'changelog':
      return createAgentOutputSchema(operation, ChangelogDataSchema)
    case 'recap':
      return createAgentOutputSchema(operation, RecapDataSchema)
    case 'condense-diff':
      return createAgentOutputSchema(operation, CondenseDiffDataSchema)
    case 'repo-context':
      return createAgentOutputSchema(operation, RepoContextDataSchema)
    case 'blame':
      return createAgentOutputSchema(operation, BlameDataSchema)
    case 'lint':
      return createAgentOutputSchema(operation, LintDataSchema)
    case 'conflict-resolve':
      return createAgentOutputSchema(operation, ConflictResolveDataSchema)
  }
}

function emitSchema(operation: AgentOperation): void {
  const isCondense = operation === 'condense-diff'
  const isRepoContext = operation === 'repo-context'
  const isBlame = operation === 'blame'
  const isLint = operation === 'lint'
  const isConflictResolve = operation === 'conflict-resolve'
  emit({
    version: AGENT_PROTOCOL_VERSION,
    operation,
    input: isCondense
      ? createCondenseDiffInputJsonSchema()
      : isRepoContext
      ? createRepoContextInputJsonSchema()
      : isBlame
      ? createBlameInputJsonSchema()
      : isLint
      ? createLintInputJsonSchema()
      : isConflictResolve
      ? createConflictResolveInputJsonSchema()
      : createAgentInputJsonSchema(),
    output: z.toJSONSchema(outputSchemaFor(operation)),
  })
}

export async function handler(argv: AgentCommandArgv): Promise<void> {
  if (argv.operation === 'schema') {
    emitSchema(argv.task!)
    return
  }

  if (argv.operation === 'capabilities') {
    // Zero-token, no-repository handshake: unlike every other operation,
    // failing to resolve a repository is not an error here -- it degrades
    // to the repo-optional report (used only for commitlint-config
    // detection), since capabilities must work before any repository is
    // known. Deliberately outside AgentOperation/AgentTaskInputSchema (see
    // CapabilitiesResultSchema), so it can't share the versioned envelope
    // failure handling below.
    const controller = new AbortController()
    const abort = () => controller.abort()
    process.once('SIGINT', abort)
    try {
      let repoRoot: string | undefined
      try {
        repoRoot = await resolveAgentRepoRoot(argv.repo, undefined, controller.signal)
      } catch {
        repoRoot = undefined
      }
      emit(await runCapabilities(repoRoot))
    } catch (error) {
      const failure = toAgentOperationError(error)
      emit({ error: { code: failure.code, message: failure.message, retryable: failure.retryable } })
      process.exitCode = failure.code === 'CANCELLED' ? 130 : 1
    } finally {
      process.removeListener('SIGINT', abort)
    }
    return
  }

  const operation = argv.operation
  const controller = new AbortController()
  const abort = () => controller.abort()
  process.once('SIGINT', abort)

  try {
    const raw = await readRequest(argv.input)

    if (operation === 'condense-diff') {
      // condense-diff uses its own request schema — parse and dispatch separately.
      const input = CondenseDiffRequestSchema.parse(raw)
      const repoRoot = await resolveAgentRepoRoot(argv.repo || input.repo, undefined, controller.signal)
      process.chdir(repoRoot)
      await armNonInteractiveUsageTelemetry(argv, repoRoot)
      const context = await createAgentOperationContext({
        repoRoot,
        signal: controller.signal,
        surface: 'agent-cli',
      })
      emit(await runCondenseDiff(input, context))
    } else if (operation === 'repo-context') {
      // repo-context uses its own request schema — parse and dispatch separately.
      // No LLM call, no API key required. No trustRepositoryConfig opt-in needed
      // (this path only reads git state, never repo-defined prompts or commitlint).
      const input = RepoContextRequestSchema.parse(raw)
      const repoRoot = await resolveAgentRepoRoot(argv.repo || input.repo, undefined, controller.signal)
      process.chdir(repoRoot)
      await armNonInteractiveUsageTelemetry(argv, repoRoot)
      const context = await createAgentOperationContext({
        repoRoot,
        signal: controller.signal,
        surface: 'agent-cli',
      })
      emit(await runRepoContext(input, context))
    } else if (operation === 'blame') {
      // blame uses its own request schema — parse and dispatch separately.
      // No LLM call, no API key required, unless the request sets `explain: true`.
      const input = BlameRequestSchema.parse(raw)
      const repoRoot = await resolveAgentRepoRoot(argv.repo || input.repo, undefined, controller.signal)
      process.chdir(repoRoot)
      await armNonInteractiveUsageTelemetry(argv, repoRoot)
      const context = await createAgentOperationContext({
        repoRoot,
        signal: controller.signal,
        surface: 'agent-cli',
      })
      emit(await runBlame(input, context))
    } else if (operation === 'lint') {
      // lint uses its own request schema — parse and dispatch separately.
      // No LLM call, no API key required. Never loads repository-defined
      // commitlint configuration — see runLint.
      const input = LintRequestSchema.parse(raw)
      const repoRoot = await resolveAgentRepoRoot(argv.repo || input.repo, undefined, controller.signal)
      process.chdir(repoRoot)
      await armNonInteractiveUsageTelemetry(argv, repoRoot)
      const context = await createAgentOperationContext({
        repoRoot,
        signal: controller.signal,
        surface: 'agent-cli',
      })
      emit(await runLint(input, context))
    } else if (operation === 'conflict-resolve') {
      // conflict-resolve uses its own request schema — parse and dispatch
      // separately. Never writes to the working tree; requires an API key
      // for the configured provider, like blame --explain. See runConflictResolve.
      const input = ConflictResolveRequestSchema.parse(raw)
      const repoRoot = await resolveAgentRepoRoot(argv.repo || input.repo, undefined, controller.signal)
      process.chdir(repoRoot)
      await armNonInteractiveUsageTelemetry(argv, repoRoot)
      const context = await createAgentOperationContext({
        repoRoot,
        signal: controller.signal,
        surface: 'agent-cli',
      })
      emit(await runConflictResolve(input, context))
    } else {
      const input = AgentTaskInputSchema.parse(raw)
      const needsRepo = requiresRepository(operation, input.source)
      let repoRoot: string
      let requireRepository: boolean

      if (needsRepo) {
        // Repository-derived sources and commit-draft always require a real repo.
        try {
          repoRoot = await resolveAgentRepoRoot(argv.repo || input.repo, undefined, controller.signal)
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
        requireRepository = true
      } else {
        // Supplied-source operations (review, changelog, recap with patch/summary/files):
        // try to resolve a repo for head verification, but fall back gracefully if none exists.
        try {
          repoRoot = await resolveAgentRepoRoot(argv.repo || input.repo, undefined, controller.signal)
          requireRepository = true
        } catch (error) {
          if (error instanceof AgentOperationError) {
            // Re-throw confinement/cancellation errors — these are real policy violations.
            if (error.code === 'REPOSITORY_OUTSIDE_ROOT' || error.code === 'CANCELLED') throw error
            // INVALID_REPOSITORY is expected when running from a non-git directory.
            // Fall back to using the requested path (or cwd) as just a directory.
          } else {
            throw error
          }
          repoRoot = resolveAgentDirectoryRoot(argv.repo || input.repo || process.cwd())
          requireRepository = false
        }
      }

      // Config discovery still uses cwd. The agent CLI is a one-shot process,
      // so changing it once before creating the explicit git context is safe.
      // Repository-defined prompts and executable commitlint config remain off
      // unless the request explicitly sets trustRepositoryConfig.
      process.chdir(repoRoot)
      await armNonInteractiveUsageTelemetry(argv, repoRoot)
      const context = await createAgentOperationContext({
        repoRoot,
        requireRepository,
        signal: controller.signal,
        surface: 'agent-cli',
      })
      emit(await runAgentOperation(operation, input, context))
    }
  } catch (error) {
    const normalized = error instanceof SyntaxError
      ? new AgentOperationError('INVALID_JSON', error.message)
      : toAgentOperationError(error)
    emit(createAgentFailureEnvelope(operation, normalized))
    process.exitCode = normalized.code === 'CANCELLED' ? 130 : 1
  } finally {
    process.removeListener('SIGINT', abort)
  }
}
