import { StringOutputParser } from '@langchain/core/output_parsers'
import { PromptTemplate } from '@langchain/core/prompts'
import { z } from 'zod'
import { executeChain } from './executeChain'
import { getLlm } from './getLlm'
import { createSchemaParser, SchemaParserOptions } from './createSchemaParser'

export interface ExecuteChainWithSchemaOptions<T> extends SchemaParserOptions {
  maxAttempts?: number
  fallbackParser?: (text: string) => T
  onRetry?: (attempt: number, error: Error) => void
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
    maxAttempts = 3,
    fallbackParser,
    onRetry,
    onFallback,
    ...parserOptions
  } = options

  const parser = createSchemaParser(schema, llm, parserOptions)
  
  let attempts = 0
  
  while (attempts < maxAttempts) {
    try {
      const result = await executeChain({
        llm,
        prompt,
        variables,
        parser,
      })
      
      return result as T
    } catch (error) {
      attempts++
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      if (onRetry) {
        onRetry(attempts, error instanceof Error ? error : new Error(errorMessage))
      }
      
      if (attempts >= maxAttempts) {
        if (fallbackParser) {
          if (onFallback) {
            onFallback()
          }
          
          // Generate without structured parsing as fallback
          const fallbackResult = await executeChain({
            llm,
            prompt,
            variables,
            parser: new StringOutputParser(),
          })
          
          const fallbackText = typeof fallbackResult === 'string' ? fallbackResult : String(fallbackResult)
          return fallbackParser(fallbackText)
        } else {
          throw new Error(`Schema parsing failed after ${maxAttempts} attempts. Last error: ${errorMessage}`)
        }
      }
    }
  }
  
  throw new Error('Unexpected execution flow in executeChainWithSchema')
}