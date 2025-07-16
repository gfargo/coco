import { StructuredOutputParser } from '@langchain/core/output_parsers'
import { PromptTemplate } from '@langchain/core/prompts'
import { OutputFixingParser } from 'langchain/output_parsers'
import { z } from 'zod'
import { handleLangChainError } from '../errorHandler'
import { LangChainExecutionError } from '../errors'
import { validateRequired } from '../validation'
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
 * @throws LangChainExecutionError if parser creation fails
 */
export function createSchemaParser<T>(
  schema: z.ZodSchema<T>,
  llm: ReturnType<typeof getLlm>,
  options: SchemaParserOptions = {}
): OutputFixingParser<T> {
  validateRequired(schema, 'schema', 'createSchemaParser')
  validateRequired(llm, 'llm', 'createSchemaParser')
  validateRequired(options, 'options', 'createSchemaParser')

  // Validate schema is actually a Zod schema
  if (typeof schema.parse !== 'function') {
    throw new LangChainExecutionError(
      'createSchemaParser: Schema must be a valid Zod schema with a parse method',
      { schemaType: typeof schema, hasParseMethod: typeof schema.parse }
    )
  }

  // Validate options structure
  if (typeof options !== 'object' || Array.isArray(options)) {
    throw new LangChainExecutionError(
      'createSchemaParser: Options must be a non-array object',
      { options, type: typeof options, isArray: Array.isArray(options) }
    )
  }

  const { retryTemplate } = options

  // Validate retryTemplate if provided
  if (retryTemplate !== undefined && typeof retryTemplate !== 'string') {
    throw new LangChainExecutionError(
      'createSchemaParser: retryTemplate must be a string when provided',
      { retryTemplate, type: typeof retryTemplate }
    )
  }

  try {
    // @ts-expect-error - StructuredOutputParser constructor type issue with Zod schema
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
  } catch (error) {
    handleLangChainError(error, 'createSchemaParser: Failed to create schema parser', {
      schemaName: schema.constructor.name,
      llmType: llm.constructor.name,
      hasRetryTemplate: !!retryTemplate
    })
  }
}