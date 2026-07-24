import { readFile } from 'node:fs/promises'
import { z } from 'zod'

import {
    AgentOperation,
    AgentOperationError,
    AgentTaskInputSchema,
    AGENT_PROTOCOL_VERSION,
    ChangelogDataSchema,
    CommitDraftDataSchema,
    createAgentFailureEnvelope,
    createAgentInputJsonSchema,
    createAgentOperationContext,
    createAgentOutputSchema,
    RecapDataSchema,
    resolveAgentRepoRoot,
    ReviewDataSchema,
    runAgentOperation,
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
  }
}

function emitSchema(operation: AgentOperation): void {
  emit({
    version: AGENT_PROTOCOL_VERSION,
    operation,
    input: createAgentInputJsonSchema(),
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
    const input = AgentTaskInputSchema.parse(raw)
    const repoRoot = await resolveAgentRepoRoot(argv.repo || input.repo, undefined, controller.signal)
    // Config discovery still uses cwd. The agent CLI is a one-shot process,
    // so changing it once before creating the explicit git context is safe.
    // Repository-defined prompts and executable commitlint config remain off
    // unless the request explicitly sets trustRepositoryConfig.
    process.chdir(repoRoot)
    await armNonInteractiveUsageTelemetry(argv, repoRoot)
    const context = await createAgentOperationContext({
      repoRoot,
      signal: controller.signal,
      surface: 'agent-cli',
    })
    emit(await runAgentOperation(operation, input, context))
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
