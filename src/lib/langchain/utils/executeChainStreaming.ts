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
import {
  estimatePromptTokens,
  LlmCallMetadata,
  logLlmCall,
} from './observability'

/**
 * A single tick of streamed output from the LLM. The shape mirrors what
 * downstream UX surfaces actually need to render incrementally:
 *
 *   - `text` — the raw text fragment that arrived in this tick. Usually
 *     a handful of characters (one or two tokens). Use this when you
 *     want to write deltas directly to a stream.
 *   - `accumulated` — every fragment concatenated since the stream
 *     started. Use this when you'd rather diff or re-render against the
 *     full text so far. Cheap to compute (the helper tracks it anyway),
 *     handed off so callers don't each re-implement the concat.
 *
 * Intentionally a small fixed shape — no partial parsed object, no
 * delta diffing, no token-count estimates. Phase 1 streams raw text
 * only; richer streaming (incremental parsed JSON for structured
 * outputs) lands in a later phase if the UX needs it.
 */
export interface StreamingChunk {
  text: string
  accumulated: string
}

export type StreamChunkHandler = (chunk: StreamingChunk) => void

export interface ExecuteChainStreamingInput<T> {
  variables: Record<string, unknown>
  prompt: PromptTemplate
  llm: ReturnType<typeof getLlm>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parser: Runnable<any, T>
  /**
   * Called for each text chunk as it streams in from the model. The
   * handler should be cheap — chunks arrive every few milliseconds.
   * Defer heavy work (full re-renders, network writes) to a debounce
   * or to completion.
   *
   * Errors thrown by the callback are caught and logged but do NOT
   * abort the stream. The final result still resolves with whatever
   * the parser produces from the fully-accumulated text. This is
   * intentional: a bad render handler shouldn't lose the user's LLM
   * spend mid-call.
   */
  onChunk: StreamChunkHandler
  /**
   * Optional `AbortSignal` for user-initiated cancellation (#881
   * phase 3). Forwarded into `chain.stream(variables, { signal })` so
   * LangChain tears down the underlying HTTP request as soon as the
   * signal fires. When the signal aborts mid-stream, this helper
   * throws a `LangChainCancelledError` carrying whatever text was
   * accumulated up to the cancel point.
   *
   * Cancel is distinct from error: callers should `catch` the
   * cancellation class explicitly and treat it as a user intent (no
   * red status line, no retry, just clean up). A pre-aborted signal
   * is checked once before the stream opens so callers don't even
   * pay for the request setup when they've already changed their
   * mind.
   */
  signal?: AbortSignal
  /** Optional provider name for better error messages. */
  provider?: string
  /** Optional endpoint URL for better error messages. */
  endpoint?: string
  logger?: Logger
  tokenizer?: TokenCounter
  metadata?: Partial<LlmCallMetadata>
}


/**
 * Coerce one streamed chunk into its text fragment. LangChain's
 * `prompt.pipe(llm).stream(...)` yields `BaseMessageChunk` instances
 * whose `.content` is sometimes a string and sometimes an array of
 * content parts (multi-modal models, tool calls). We only care about
 * the textual delta here; non-text parts are silently dropped because
 * phase 1's surfaces (stdout + status-line copy) can't render them
 * anyway.
 */
function coerceChunkText(messageChunk: unknown): string {
  if (typeof messageChunk === 'string') return messageChunk
  if (messageChunk && typeof messageChunk === 'object' && 'content' in messageChunk) {
    const content = (messageChunk as { content: unknown }).content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      // Multi-part content array — concatenate the text parts only.
      return content
        .map((part) => {
          if (typeof part === 'string') return part
          if (part && typeof part === 'object' && 'text' in part && typeof (part as { text: unknown }).text === 'string') {
            return (part as { text: string }).text
          }
          return ''
        })
        .join('')
    }
  }
  return ''
}

/**
 * Streaming variant of `executeChain`. Pipes the prompt into the LLM,
 * consumes the resulting async iterable, fires `onChunk` with each text
 * fragment as it arrives, and runs the supplied parser against the
 * fully-accumulated text on completion. Returns the parsed result.
 *
 * Why a separate function instead of an `onChunk?` flag on
 * `executeChain`? Two reasons:
 *
 *   1. The two paths have meaningfully different failure modes — a
 *      half-streamed result can be salvaged with a best-effort parse;
 *      an `invoke()` failure can't. Separate functions let each handle
 *      its own error shape cleanly.
 *   2. Callers should make an explicit choice about whether they want
 *      streaming. Adding it as an opt-in flag on `executeChain` makes
 *      it tempting to plumb `onChunk` from random surfaces; a separate
 *      helper makes the call site say "yes, this needs streaming."
 *
 * No automatic fallback to non-streaming `executeChain` when streaming
 * fails — by design. Callers that want fallback should `catch` this
 * function and call `executeChain` themselves. Keeps the helper focused
 * on the streaming path and the fallback policy explicit at the call
 * site (different commands may want different fallback strategies).
 */
export async function executeChainStreaming<T>({
  llm,
  prompt,
  variables,
  parser,
  onChunk,
  signal,
  provider,
  endpoint,
  logger,
  tokenizer,
  metadata,
}: ExecuteChainStreamingInput<T>): Promise<T> {
  validateRequired(llm, 'llm', 'executeChainStreaming')
  validateRequired(prompt, 'prompt', 'executeChainStreaming')
  validateRequired(variables, 'variables', 'executeChainStreaming')
  validateRequired(parser, 'parser', 'executeChainStreaming')
  validateRequired(onChunk, 'onChunk', 'executeChainStreaming')

  if (typeof variables !== 'object' || Array.isArray(variables)) {
    throw new LangChainExecutionError(
      'executeChainStreaming: Variables must be a non-array object',
      { variables, type: typeof variables, isArray: Array.isArray(variables) },
    )
  }

  // Pre-flight abort check (#881 phase 3). Callers that ran the cancel
  // path before reaching here shouldn't pay for prompt rendering or
  // request setup. Match the contract `chain.stream(..., { signal })`
  // would have honoured — throw `LangChainCancelledError` rather than
  // a bare `AbortError`.
  if (signal?.aborted) {
    throw new LangChainCancelledError(
      'executeChainStreaming: Aborted before stream opened',
      '',
    )
  }

  const llmInfo = getLlmMetadata(llm)
  const effectiveProvider = provider || llmInfo.provider
  const effectiveEndpoint = endpoint || llmInfo.endpoint

  let accumulated = ''
  try {
    const renderedPrompt = await prompt.format(variables)
    const promptTokens = estimatePromptTokens(tokenizer, renderedPrompt)

    const chain = prompt.pipe(llm)
    const startedAt = Date.now()
    // Forward the signal into LangChain's RunnableConfig. The HTTP
    // transport (openai / anthropic / ollama clients) honours it and
    // tears down the connection rather than waiting for the model to
    // finish. The async iterator throws an AbortError that we
    // classify below.
    const stream = await chain.stream(variables, signal ? { signal } : undefined)

    let chunkCount = 0
    let callbackFailureCount = 0
    // Audit finding #13: cap consecutive callback failures so a
    // genuinely broken render handler can't tie up the LLM call
    // silently for the user's entire wait. Five strikes (out of an
    // expected ~50-500 chunks for a normal commit message) is enough
    // to ride out a transient blip but small enough to bail before
    // the user finishes waiting on a useless stream.
    const MAX_CALLBACK_FAILURES = 5
    for await (const messageChunk of stream) {
      const text = coerceChunkText(messageChunk)
      if (!text) continue
      accumulated += text
      chunkCount += 1
      try {
        onChunk({ text, accumulated })
        // Successful callback resets the consecutive-failure counter —
        // we only bail on a STREAK of failures, not on isolated ones.
        callbackFailureCount = 0
      } catch (callbackError) {
        // Deliberately swallow callback errors so a bad render handler
        // can't tank the entire LLM call. Log at verbose so users with
        // verbose mode on can still see what happened.
        callbackFailureCount += 1
        logger?.verbose(
          `executeChainStreaming: onChunk handler threw (${callbackFailureCount}/${MAX_CALLBACK_FAILURES}): ${
            callbackError instanceof Error ? callbackError.message : String(callbackError)
          }`,
          { color: 'yellow' },
        )
        if (callbackFailureCount >= MAX_CALLBACK_FAILURES) {
          logger?.verbose(
            `executeChainStreaming: bailing stream — ${MAX_CALLBACK_FAILURES} consecutive callback failures suggest a broken render handler.`,
            { color: 'red' },
          )
          throw new LangChainExecutionError(
            `executeChainStreaming: render handler failed ${MAX_CALLBACK_FAILURES} times in a row; aborting stream so the failure surfaces to the caller.`,
            { accumulatedLength: accumulated.length, chunkCount },
          )
        }
      }
    }

    if (!accumulated) {
      throw new LangChainExecutionError(
        'executeChainStreaming: Stream completed with no text chunks',
        { variables, promptInputVariables: prompt.inputVariables },
      )
    }

    const result = (await parser.invoke(accumulated)) as T
    const elapsedMs = Date.now() - startedAt

    logLlmCall(logger, {
      task: metadata?.task || 'chain-streaming',
      provider: effectiveProvider,
      parserType: parser.constructor.name,
      variableKeys: Object.keys(variables),
      promptTokens,
      elapsedMs,
      // Surfaced in observability so consumers can spot the streaming
      // path in their logs without correlating across tools. `chunks`
      // doubles as a sanity check (a streaming call that delivered 1
      // chunk is functionally identical to a non-streaming one).
      streamed: true,
      streamChunks: chunkCount,
      ...metadata,
    })

    if (result === null || result === undefined) {
      throw new LangChainExecutionError(
        'executeChainStreaming: Parser returned null or undefined from streamed text',
        {
          variables,
          promptInputVariables: prompt.inputVariables,
          accumulatedLength: accumulated.length,
        },
      )
    }

    return result
  } catch (error) {
    // Cancellation classifier (#881 phase 3). Three signals: an
    // explicitly aborted user signal (post-throw check) or a thrown
    // `AbortError` from the standard DOM API. Either means "user
    // wanted out," not "the call failed." Wrap the raw error so
    // callers can pattern-match on `LangChainCancelledError` and
    // carry the partial accumulated text in case the caller wants
    // to salvage anything.
    //
    // Audit finding #8: an earlier implementation also fell back to
    // `error.message.includes('aborted')` as a third signal. That
    // substring heuristic is footgun-shaped — legitimate provider
    // errors ("model not aborted properly", future API copy) would
    // misclassify as user cancels. Dropped; rely on the structured
    // signal (`signal.aborted`) and the standard error class
    // (`name === 'AbortError'`).
    const aborted =
      signal?.aborted ||
      (error instanceof Error && error.name === 'AbortError')
    if (aborted) {
      throw new LangChainCancelledError(
        error instanceof Error ? error.message : 'Streaming aborted by user',
        accumulated,
        {
          provider: effectiveProvider,
          endpoint: effectiveEndpoint,
        },
      )
    }
    if (
      error instanceof LangChainExecutionError ||
      error instanceof LangChainNetworkError ||
      error instanceof LangChainCancelledError
    ) {
      throw error
    }

    if (error instanceof Error && isNetworkError(error)) {
      throw new LangChainNetworkError(error.message, effectiveEndpoint, effectiveProvider, {
        originalError: error.name,
        originalMessage: error.message,
        stack: error.stack,
        promptInputVariables: prompt.inputVariables,
        variableKeys: Object.keys(variables),
        parserType: parser.constructor.name,
        streamed: true,
      })
    }

    handleLangChainError(error, 'executeChainStreaming: Stream execution failed', {
      promptInputVariables: prompt.inputVariables,
      variableKeys: Object.keys(variables),
      parserType: parser.constructor.name,
      provider: effectiveProvider,
      endpoint: effectiveEndpoint,
      streamed: true,
    })
  }
}
