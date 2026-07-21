import type { AIMessage } from '@langchain/core/messages'
import { OutputParserException } from '@langchain/core/output_parsers'
import type { LLMResult } from '@langchain/core/outputs'
import { PromptTemplate } from '@langchain/core/prompts'
import { Runnable } from '@langchain/core/runnables'
import { handleLangChainError, isNetworkError } from '../errorHandler'
import {
  LangChainCancelledError,
  LangChainExecutionError,
  LangChainNetworkError,
  LangChainSchemaParseError,
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
  llm: Awaited<ReturnType<typeof getLlm>>
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

    // `pipe(parser)` means the intermediate `AIMessage` (and its
    // `usage_metadata`) is consumed internally before `executeChain` sees
    // the parsed result — the callback is the only way to observe it.
    // Providers attach `usage_metadata.output_tokens` on the completed
    // chat-model run; older/proxied providers may only populate the
    // legacy `llmOutput.tokenUsage.completionTokens`. Left `undefined`
    // (never defaulted to 0) when neither is present.
    let completionTokens: number | undefined
    const usageCallback = {
      handleLLMEnd: (output: LLMResult) => {
        const generation = output.generations[0]?.[0] as { message?: AIMessage } | undefined
        const outputTokens = generation?.message?.usage_metadata?.output_tokens
        if (typeof outputTokens === 'number') {
          completionTokens = outputTokens
          return
        }
        const legacyCompletionTokens = output.llmOutput?.tokenUsage?.completionTokens
        if (typeof legacyCompletionTokens === 'number') {
          completionTokens = legacyCompletionTokens
        }
      },
    }

    const result = (await chain.invoke(variables, {
      ...(signal ? { signal } : {}),
      callbacks: [usageCallback],
    })) as T
    const elapsedMs = Date.now() - startedAt

    logLlmCall(logger, {
      task: metadata?.task || 'chain',
      provider: effectiveProvider,
      parserType: parser.constructor.name,
      variableKeys: Object.keys(variables),
      promptTokens,
      completionTokens,
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

    // Schema/format parse failures (#1460 / OSS-503): classify separately
    // from a generic LangChainExecutionError so `withRetry`'s default
    // predicate can skip retrying an identical call that's unlikely to
    // parse differently the second time.
    if (error instanceof OutputParserException) {
      throw new LangChainSchemaParseError(
        `executeChain: Failed to parse schema output: ${error.message}`,
        {
          promptInputVariables: prompt.inputVariables,
          variableKeys: Object.keys(variables),
          parserType: parser.constructor.name,
          provider: effectiveProvider,
          endpoint: effectiveEndpoint,
        }
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
