import { readFile } from 'node:fs/promises'
import { z } from 'zod'

import {
    AgentOperation,
    AgentOperationError,
    AgentTaskInputSchema,
    AGENT_PROTOCOL_VERSION,
    ChangelogDataSchema,
    CommitDraftDataSchema,
    CondenseDiffDataSchema,
    CondenseDiffRequestSchema,
    createAgentFailureEnvelope,
    createAgentInputJsonSchema,
    createAgentOperationContext,
    createAgentOutputSchema,
    createCondenseDiffInputJsonSchema,
    describeRepoResolutionFailure,
    RecapDataSchema,
    requiresRepository,
    resolveAgentDirectoryRoot,
    resolveAgentRepoRoot,
    ReviewDataSchema,
    runAgentOperation,
    runCondenseDiff,
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
  }
}

function emitSchema(operation: AgentOperation): void {
  const isCondense = operation === 'condense-diff'
  emit({
    version: AGENT_PROTOCOL_VERSION,
    operation,
    input: isCondense ? createCondenseDiffInputJsonSchema() : createAgentInputJsonSchema(),
    output: z.toJSONSchema(outputSchemaFor(operation)),
  })
}

export async function handler(argv: AgentCommandArgv): Promise<void> {
  if (argv.operation === 'schema') {
    emitSchema(argv.task!)
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
