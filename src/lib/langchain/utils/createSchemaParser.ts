import { StructuredOutputParser } from '@langchain/core/output_parsers'
import { PromptTemplate } from '@langchain/core/prompts'
import { OutputFixingParser } from 'langchain/output_parsers'
import { z } from 'zod'
import { getLlm } from './getLlm'

export interface SchemaParserOptions {
  maxRetries?: number
  retryTemplate?: string
}

/**
 * Creates a parser with built-in retry logic for schema-based generation
 * @param schema - Zod schema for the expected output structure
 * @param llm - LLM instance for retry attempts
 * @param options - Configuration options for retry behavior
 * @returns OutputFixingParser configured with retry logic
 */
export function createSchemaParser<T>(
  schema: z.ZodSchema<T>,
  llm: ReturnType<typeof getLlm>,
  options: SchemaParserOptions = {}
) {
  const { retryTemplate } = options

  const baseParser = new StructuredOutputParser(schema)
  
  const defaultRetryTemplate = `The following text failed to parse as valid JSON. Please convert it into a valid JSON object that matches the required schema.

## Text to fix:
{completion}

## Instructions: 
{instructions}

You must return ONLY valid JSON that matches the schema exactly. Do not include any additional text, explanations, or markdown formatting:`

  const retryPromptTemplate = new PromptTemplate({
    template: retryTemplate || defaultRetryTemplate,
    inputVariables: ['completion', 'instructions'],
  })

  const retryChain = retryPromptTemplate.pipe(llm).pipe(baseParser)

  return new OutputFixingParser({
    parser: baseParser,
    retryChain: retryChain,
  })
}