import { StringOutputParser } from '@langchain/core/output_parsers'
import { PromptTemplate } from '@langchain/core/prompts'
import { RunnablePassthrough } from '@langchain/core/runnables'
import { z } from 'zod'
import { LangChainCancelledError } from '../errors'
import { findProviderDefinition } from '../providers/registry'
import { withRetry, type RetryOptions } from '../../utils/retry'
import { Logger } from '../../utils/logger'
import { TokenCounter } from '../../utils/tokenizer'
import { createSchemaParser, SchemaParserOptions } from './createSchemaParser'
import { executeChain } from './executeChain'
import { getLlm } from './getLlm'
import { getLlmMetadata } from './llmMetadata'
import { LlmCallMetadata } from './observability'

export interface ExecuteChainWithSchemaOptions<T> extends SchemaParserOptions {
  /** Options for retry behavior - uses general retry utility */
  retryOptions?: RetryOptions
  /** Fallback parser to use if schema parsing fails completely */
  fallbackParser?: (text: string) => T
  /** Called when fallback parser is used */
  onFallback?: () => void
  logger?: Logger
  tokenizer?: TokenCounter
  metadata?: Partial<LlmCallMetadata>
  /**
   * Optional user-cancellation signal (#1338 pattern). Forwarded into
   * `executeChain` so the underlying HTTP request tears down when the
   * signal fires. Aborts surface as `LangChainCancelledError`, are
   * never retried, and skip the fallback parser.
   */
  signal?: AbortSignal
}

/**
 * Unwraps zod optional/nullable/default/pipe wrappers to find the innermost
 * type, then checks whether it's a `ZodObject`. Providers' native structured
 * output (`response_format: json_schema`) requires an object-rooted JSON
 * Schema — array-rooted schemas (e.g. `z.preprocess(fn, z.array(...))`, used
 * by the review feedback schema) are rejected, so those must stay on the text
 * parser path where `z.preprocess`'s normalization also still runs.
 *
 * zod v4 represents `z.preprocess(...)` as a `ZodPreprocess` (a `ZodPipe`
 * subclass) whose `_def.out` is the target schema — there's no separate
 * `ZodEffects` wrapper as in zod v3.
 */
function isObjectRootSchema(schema: z.ZodTypeAny): boolean {
  let current: z.ZodTypeAny = schema
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (current instanceof z.ZodObject) {
      return true
    }
    if (
      current instanceof z.ZodOptional ||
      current instanceof z.ZodNullable ||
      current instanceof z.ZodDefault
    ) {
      // `as z.ZodTypeAny`: zod v4's internal `$ZodType` def shape is a
      // structurally narrower base than the public `ZodType` class this
      // function is typed against.
      current = current._def.innerType as z.ZodTypeAny
      continue
    }
    if (current instanceof z.ZodPipe) {
      current = current._def.out as z.ZodTypeAny
      continue
    }
    return false
  }
}

/**
 * High-level function that combines chain execution with schema-based parsing
 * Includes automatic retry logic and graceful degradation
 * @param schema - Zod schema for the expected output structure
 * @param llm - LLM instance
 * @param prompt - Prompt template
 * @param variables - Variables for the prompt
 * @param options - Configuration options
 * @returns Parsed result matching the schema type
 */
export async function executeChainWithSchema<T>(
  schema: z.ZodSchema<T>,
  llm: Awaited<ReturnType<typeof getLlm>>,
  prompt: PromptTemplate,
  variables: Record<string, unknown>,
  options: ExecuteChainWithSchemaOptions<T> = {}
): Promise<T> {
  const {
    retryOptions = { maxAttempts: 3 },
    fallbackParser,
    onFallback,
    logger,
    tokenizer,
    metadata,
    signal,
    ...parserOptions
  } = options

  const llmInfo = getLlmMetadata(llm)
  const structuredOutputSupport = llmInfo.provider
    ? findProviderDefinition(llmInfo.provider)?.supportsStructuredOutput
    : undefined

  const useStructured = !!structuredOutputSupport && isObjectRootSchema(schema)

  // `provider`/`endpoint` are threaded through explicitly (rather than
  // re-derived from `effectiveLlm`) because the structured-output runnable
  // built below is a fresh object returned by `withStructuredOutput` and was
  // never registered in the `llmMetadata` WeakMap that `getLlmMetadata` reads.
  const runLegacy = async (): Promise<T> => {
    const parser = createSchemaParser(schema, parserOptions)
    let attempt = 0
    const operation = async (): Promise<T> => {
      attempt++
      const result = await executeChain({
        llm,
        prompt,
        variables,
        parser,
        provider: llmInfo.provider,
        endpoint: llmInfo.endpoint,
        logger,
        tokenizer,
        signal,
        metadata: {
          task: 'schema-chain',
          ...metadata,
          retryAttempt: attempt,
        },
      })

      return result as T
    }

    return withRetry(operation, retryOptions)
  }

  if (useStructured) {
    try {
      const method = structuredOutputSupport === 'json-schema' ? 'jsonSchema' : 'jsonMode'
      // `as never`/`Function` casts: the resolved provider's chat model overrides
      // `withStructuredOutput`, but that isn't reflected in the narrow
      // `Awaited<ReturnType<typeof getLlm>>` union `executeChainWithSchema` is
      // typed against (same rationale as `createSchemaParser.ts:54`).
      const structuredLlm = (
        llm as unknown as { withStructuredOutput: (schema: unknown, config: { method: string }) => unknown }
      ).withStructuredOutput(schema as never, { method }) as Awaited<ReturnType<typeof getLlm>>
      // The model now returns the schema-shaped object directly — no text to
      // parse, so the chain's parser stage is an identity passthrough.
      const parser = new RunnablePassthrough()

      let attempt = 0
      const operation = async (): Promise<T> => {
        attempt++
        const result = await executeChain({
          llm: structuredLlm,
          prompt,
          variables,
          parser,
          provider: llmInfo.provider,
          endpoint: llmInfo.endpoint,
          logger,
          tokenizer,
          signal,
          metadata: {
            task: 'schema-chain',
            ...metadata,
            retryAttempt: attempt,
          },
        })

        return result as T
      }

      return await withRetry(operation, retryOptions)
    } catch (error) {
      // A user abort is intent, not a parse failure — never degrade it
      // into the legacy/fallback path (which would fire ANOTHER llm call
      // on an already-cancelled interaction).
      if (error instanceof LangChainCancelledError) {
        throw error
      }
      logger?.verbose('native structured output failed; degrading to text parser')
      // Fall through to the legacy text-parser path below. This makes the
      // native path strictly non-regressing even for callers (e.g.
      // `splitPlanGenerator`) that supply no `fallbackParser` of their own.
    }
  }

  try {
    return await runLegacy()
  } catch (error) {
    if (error instanceof LangChainCancelledError) {
      throw error
    }
    if (fallbackParser) {
      if (onFallback) {
        onFallback()
      }

      const fallbackResult = await executeChain({
        llm,
        prompt,
        variables,
        parser: new StringOutputParser(),
        logger,
        tokenizer,
        signal,
        metadata: {
          task: 'schema-chain-fallback',
          ...metadata,
        },
      })

      const fallbackText = typeof fallbackResult === 'string' ? fallbackResult : String(fallbackResult)
      return fallbackParser(fallbackText)
    }

    // No fallback available, re-throw the error
    throw error
  }
}
