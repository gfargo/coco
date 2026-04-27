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
  inputDocuments?: number
  inputChunks?: number
}

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

  const fields = [
    `task=${metadata.task}`,
    metadata.command ? `command=${metadata.command}` : undefined,
    metadata.provider ? `provider=${metadata.provider}` : undefined,
    metadata.model ? `model=${metadata.model}` : undefined,
    metadata.retryAttempt ? `retryAttempt=${metadata.retryAttempt}` : undefined,
    metadata.promptTokens !== undefined ? `promptTokens=${metadata.promptTokens}` : undefined,
    metadata.inputDocuments !== undefined ? `inputDocuments=${metadata.inputDocuments}` : undefined,
    metadata.inputChunks !== undefined ? `inputChunks=${metadata.inputChunks}` : undefined,
    metadata.parserType ? `parser=${metadata.parserType}` : undefined,
    metadata.variableKeys?.length ? `variableKeys=${metadata.variableKeys.join(',')}` : undefined,
  ].filter(Boolean)

  logger.verbose(`[llm] ${fields.join(' ')}`, { color: 'cyan' })
}
