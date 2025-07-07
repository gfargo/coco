import { StringOutputParser } from '@langchain/core/output_parsers'
import { PromptTemplate } from '@langchain/core/prompts'
import { z } from 'zod'
import { withRetry, type RetryOptions } from '../../utils/retry'
import { createSchemaParser, SchemaParserOptions } from './createSchemaParser'
import { executeChain } from './executeChain'
import { getLlm } from './getLlm'

export interface ExecuteChainWithSchemaOptions<T> extends SchemaParserOptions {
  /** Options for retry behavior - uses general retry utility */
  retryOptions?: RetryOptions
  /** Fallback parser to use if schema parsing fails completely */
  fallbackParser?: (text: string) => T
  /** Called when fallback parser is used */
  onFallback?: () => void
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
  llm: ReturnType<typeof getLlm>,
  prompt: PromptTemplate,
  variables: Record<string, unknown>,
  options: ExecuteChainWithSchemaOptions<T> = {}
): Promise<T> {
  const {
    retryOptions = { maxAttempts: 3 },
    fallbackParser,
    onFallback,
    ...parserOptions
  } = options
  
  const parser = createSchemaParser(schema, llm, parserOptions)

  const operation = async (): Promise<T> => {
    const result = await executeChain({
      llm,
      prompt,
      variables,
      parser,
    })
    
    return result as T
  }
  
  try {
    return await withRetry(operation, retryOptions)
  } catch (error) {
    if (fallbackParser) {
      if (onFallback) {
        onFallback()
      }
      
      const fallbackResult = await executeChain({
        llm,
        prompt,
        variables,
        parser: new StringOutputParser(),
      })
      
      const fallbackText = typeof fallbackResult === 'string' ? fallbackResult : String(fallbackResult)
      return fallbackParser(fallbackText)
    }
    
    // No fallback available, re-throw the error
    throw error
  }
}