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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parser: any = createSchemaParser(schema, parserOptions)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let effectiveLlm: any = llm

  if (structuredOutputSupport) {
    const method = structuredOutputSupport === 'json-schema' ? 'jsonSchema' : 'jsonMode'
    // `as never`/`Function` casts: the resolved provider's chat model overrides
    // `withStructuredOutput`, but that isn't reflected in the narrow
    // `Awaited<ReturnType<typeof getLlm>>` union `executeChainWithSchema` is
    // typed against (same rationale as `createSchemaParser.ts:54`).
    effectiveLlm = (
      llm as unknown as { withStructuredOutput: (schema: unknown, config: { method: string }) => unknown }
    ).withStructuredOutput(schema as never, { method })
    // The model now returns the schema-shaped object directly — no text to
    // parse, so the chain's parser stage is an identity passthrough.
    parser = new RunnablePassthrough()
  }

  let attempt = 0

  const operation = async (): Promise<T> => {
    attempt++
    const result = await executeChain({
      llm: effectiveLlm,
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

  try {
    return await withRetry(operation, retryOptions)
  } catch (error) {
    // A user abort is intent, not a parse failure — never degrade it
    // into the fallback path (which would fire ANOTHER llm call on an
    // already-cancelled interaction).
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
