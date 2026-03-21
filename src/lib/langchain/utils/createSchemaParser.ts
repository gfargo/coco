import { StructuredOutputParser } from '@langchain/core/output_parsers'
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
 * Creates a StructuredOutputParser for schema-based generation
 * @param schema - Zod schema for the expected output structure
 * @param llm - LLM instance (kept for API compatibility)
 * @param options - Configuration options
 * @returns StructuredOutputParser configured with the provided schema
 * @throws LangChainExecutionError if parser creation fails
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createSchemaParser(
  schema: z.ZodType,
  llm: ReturnType<typeof getLlm>,
  options: SchemaParserOptions = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  validateRequired(schema, 'schema', 'createSchemaParser')
  validateRequired(llm, 'llm', 'createSchemaParser')
  validateRequired(options, 'options', 'createSchemaParser')

  if (typeof schema.parse !== 'function') {
    throw new LangChainExecutionError(
      'createSchemaParser: Schema must be a valid Zod schema with a parse method',
      { schemaType: typeof schema, hasParseMethod: typeof schema.parse }
    )
  }

  if (typeof options !== 'object' || Array.isArray(options)) {
    throw new LangChainExecutionError('createSchemaParser: Options must be a non-array object', {
      options,
      type: typeof options,
      isArray: Array.isArray(options),
    })
  }

  const { retryTemplate } = options

  if (retryTemplate !== undefined && typeof retryTemplate !== 'string') {
    throw new LangChainExecutionError(
      'createSchemaParser: retryTemplate must be a string when provided',
      { retryTemplate, type: typeof retryTemplate }
    )
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return StructuredOutputParser.fromZodSchema(schema as any)
  } catch (error) {
    handleLangChainError(error, 'createSchemaParser: Failed to create schema parser', {
      schemaName: schema.constructor.name,
      llmType: llm.constructor.name,
      hasRetryTemplate: !!retryTemplate,
    })
  }
}