import { Logger } from '../../utils/logger'
import { TokenCounter } from '../../utils/tokenizer'

export type LlmCallMetadata = {
  task: string
  command?: string
  provider?: string
  model?: string
  retryAttempt?: number
  parserType?: string
  variableKeys?: string[]
  promptTokens?: number
  elapsedMs?: number
  inputDocuments?: number
  inputChunks?: number
}

type LlmTelemetrySummary = {
  calls: number
  promptTokens: number
  elapsedMs: number
  inputDocuments: number
  inputChunks: number
  tasks: Set<string>
  models: Set<string>
}

const telemetryByCommand = new Map<string, LlmTelemetrySummary>()

export function estimatePromptTokens(
  tokenizer: TokenCounter | undefined,
  renderedPrompt: string
): number | undefined {
  if (!tokenizer) return undefined

  try {
    return tokenizer(renderedPrompt)
  } catch {
    return undefined
  }
}

export function logLlmCall(logger: Logger | undefined, metadata: LlmCallMetadata): void {
  if (!logger) return

  recordLlmTelemetry(metadata)

  const fields = [
    `task=${metadata.task}`,
    metadata.command ? `command=${metadata.command}` : undefined,
    metadata.provider ? `provider=${metadata.provider}` : undefined,
    metadata.model ? `model=${metadata.model}` : undefined,
    metadata.retryAttempt ? `retryAttempt=${metadata.retryAttempt}` : undefined,
    metadata.promptTokens !== undefined ? `promptTokens=${metadata.promptTokens}` : undefined,
    metadata.elapsedMs !== undefined ? `elapsedMs=${metadata.elapsedMs}` : undefined,
    metadata.inputDocuments !== undefined ? `inputDocuments=${metadata.inputDocuments}` : undefined,
    metadata.inputChunks !== undefined ? `inputChunks=${metadata.inputChunks}` : undefined,
    metadata.parserType ? `parser=${metadata.parserType}` : undefined,
    metadata.variableKeys?.length ? `variableKeys=${metadata.variableKeys.join(',')}` : undefined,
  ].filter(Boolean)

  logger.verbose(`[llm] ${fields.join(' ')}`, { color: 'cyan' })
}

function recordLlmTelemetry(metadata: LlmCallMetadata): void {
  const command = metadata.command || 'unknown'
  const current = telemetryByCommand.get(command) || {
    calls: 0,
    promptTokens: 0,
    elapsedMs: 0,
    inputDocuments: 0,
    inputChunks: 0,
    tasks: new Set<string>(),
    models: new Set<string>(),
  }

  current.calls += 1
  current.promptTokens += metadata.promptTokens || 0
  current.elapsedMs += metadata.elapsedMs || 0
  current.inputDocuments += metadata.inputDocuments || 0
  current.inputChunks += metadata.inputChunks || 0
  current.tasks.add(metadata.task)

  if (metadata.model) {
    current.models.add(metadata.model)
  }

  telemetryByCommand.set(command, current)
}

export function logLlmTelemetrySummary(logger: Logger | undefined, command: string): string | undefined {
  if (!logger) return undefined

  const summary = telemetryByCommand.get(command)
  if (!summary || summary.calls === 0) return undefined

  const fields = [
    `command=${command}`,
    `calls=${summary.calls}`,
    summary.promptTokens > 0 ? `promptTokens=${summary.promptTokens}` : undefined,
    summary.elapsedMs > 0 ? `elapsedMs=${summary.elapsedMs}` : undefined,
    summary.inputDocuments > 0 ? `inputDocuments=${summary.inputDocuments}` : undefined,
    summary.inputChunks > 0 ? `inputChunks=${summary.inputChunks}` : undefined,
    summary.tasks.size > 0 ? `tasks=${[...summary.tasks].join(',')}` : undefined,
    summary.models.size > 0 ? `models=${[...summary.models].join(',')}` : undefined,
  ].filter(Boolean)
  const message = `[llm:summary] ${fields.join(' ')}`

  logger.verbose(message, { color: 'cyan' })
  telemetryByCommand.delete(command)
  return message
}

export function resetLlmTelemetry(): void {
  telemetryByCommand.clear()
}
