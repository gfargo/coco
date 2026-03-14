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
export function createSchemaParser<S extends z.ZodType>(
  schema: S,
  llm: ReturnType<typeof getLlm>,
  options: SchemaParserOptions = {}
): StructuredOutputParser<S> {
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
    return StructuredOutputParser.fromZodSchema(schema)
  } catch (error) {
    handleLangChainError(error, 'createSchemaParser: Failed to create schema parser', {
      schemaName: schema.constructor.name,
      llmType: llm.constructor.name,
      hasRetryTemplate: !!retryTemplate,
    })
  }
}