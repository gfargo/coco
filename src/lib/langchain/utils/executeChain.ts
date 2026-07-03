import { PromptTemplate } from '@langchain/core/prompts'
import { Runnable } from '@langchain/core/runnables'
import { handleLangChainError, isNetworkError } from '../errorHandler'
import {
  LangChainCancelledError,
  LangChainExecutionError,
  LangChainNetworkError,
} from '../errors'
import { validateRequired } from '../validation'
import { getLlm } from './getLlm'
import { getLlmMetadata } from './llmMetadata'
import { Logger } from '../../utils/logger'
import { TokenCounter } from '../../utils/tokenizer'
import { estimatePromptTokens, LlmCallMetadata, logLlmCall } from './observability'

type ExecuteChainInput<T> = {
  variables: Record<string, unknown>
  prompt: PromptTemplate
  llm: ReturnType<typeof getLlm>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parser: Runnable<any, T>
  /** Optional provider name for better error messages */
  provider?: string
  /** Optional endpoint URL for better error messages */
  endpoint?: string
  logger?: Logger
  tokenizer?: TokenCounter
  metadata?: Partial<LlmCallMetadata>
  /**
   * Optional user-cancellation signal (#1338). Forwarded into
   * `chain.invoke(variables, { signal })` so the underlying HTTP
   * request tears down when the signal fires. Aborts surface as
   * `LangChainCancelledError` — the same contract as
   * `executeChainStreaming` — so callers can treat a cancel as user
   * intent rather than a failure.
   */
  signal?: AbortSignal
}

/**
 * Executes a LangChain pipeline with the provided LLM, prompt, variables, and parser.
 * @param params - The execution parameters
 * @returns The parsed result from the LLM chain
 * @throws LangChainExecutionError if the chain execution fails or returns empty results
 * @throws LangChainNetworkError if a network/connection error occurs
 */
export const executeChain = async <T>({
  llm,
  prompt,
  variables,
  parser,
  provider,
  endpoint,
  logger,
  tokenizer,
  metadata,
  signal,
}: ExecuteChainInput<T>): Promise<T> => {
  validateRequired(llm, 'llm', 'executeChain')
  validateRequired(prompt, 'prompt', 'executeChain')
  validateRequired(variables, 'variables', 'executeChain')
  validateRequired(parser, 'parser', 'executeChain')

  // Validate that variables is an object
  if (typeof variables !== 'object' || Array.isArray(variables)) {
    throw new LangChainExecutionError('executeChain: Variables must be a non-array object', {
      variables,
      type: typeof variables,
      isArray: Array.isArray(variables),
    })
  }

  // Extract LLM info for error reporting if not provided
  const llmInfo = getLlmMetadata(llm)
  const effectiveProvider = provider || llmInfo.provider
  const effectiveEndpoint = endpoint || llmInfo.endpoint

  // Pre-aborted signal: the user cancelled between scheduling and
  // request setup. Bail before any network activity — same contract as
  // executeChainStreaming.
  if (signal?.aborted) {
    throw new LangChainCancelledError('executeChain: Cancelled before invocation', undefined, {
      provider: effectiveProvider,
      endpoint: effectiveEndpoint,
    })
  }

  try {
    const renderedPrompt = await prompt.format(variables)
    const promptTokens = estimatePromptTokens(tokenizer, renderedPrompt)

    const chain = prompt.pipe(llm).pipe(parser)
    const startedAt = Date.now()
    const result = (await chain.invoke(variables, signal ? { signal } : undefined)) as T
    const elapsedMs = Date.now() - startedAt

    logLlmCall(logger, {
      task: metadata?.task || 'chain',
      provider: effectiveProvider,
      parserType: parser.constructor.name,
      variableKeys: Object.keys(variables),
      promptTokens,
      elapsedMs,
      ...metadata,
    })

    if (result === null || result === undefined) {
      throw new LangChainExecutionError(
        'executeChain: Chain execution returned null or undefined result',
        { variables, promptInputVariables: prompt.inputVariables }
      )
    }

    return result
  } catch (error) {
    // Cancellation classifier (#1338) — mirrors executeChainStreaming:
    // an aborted user signal (post-throw check) or a thrown standard
    // `AbortError` means "user wanted out", not "the call failed".
    const aborted =
      signal?.aborted ||
      (error instanceof Error && error.name === 'AbortError')
    if (aborted && !(error instanceof LangChainCancelledError)) {
      throw new LangChainCancelledError(
        error instanceof Error ? error.message : 'Chain invocation aborted by user',
        undefined,
        { provider: effectiveProvider, endpoint: effectiveEndpoint },
      )
    }

    // Re-throw LangChain errors as-is
    if (
      error instanceof LangChainExecutionError ||
      error instanceof LangChainNetworkError ||
      error instanceof LangChainCancelledError
    ) {
      throw error
    }

    // Check for network errors and throw specific error type
    if (error instanceof Error && isNetworkError(error)) {
      throw new LangChainNetworkError(error.message, effectiveEndpoint, effectiveProvider, {
        originalError: error.name,
        originalMessage: error.message,
        stack: error.stack,
        promptInputVariables: prompt.inputVariables,
        variableKeys: Object.keys(variables),
        parserType: parser.constructor.name,
      })
    }

    // Wrap other errors with context
    handleLangChainError(error, 'executeChain: Chain execution failed', {
      promptInputVariables: prompt.inputVariables,
      variableKeys: Object.keys(variables),
      parserType: parser.constructor.name,
      provider: effectiveProvider,
      endpoint: effectiveEndpoint,
    })
  }
}
