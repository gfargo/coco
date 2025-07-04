import { PromptTemplate } from '@langchain/core/prompts'
import { handleLangChainError } from '../errorHandler'
import { LangChainExecutionError, LangChainValidationError } from '../errors'
import { validateNonEmptyArray, validateNonEmptyString, validateRequired } from '../validation'

export type CreatePromptInput = {
  template?: string
  variables: string[]
  fallback?: PromptTemplate
}

/**
 * Creates a PromptTemplate from a template string or returns a fallback template.
 * 
 * @param params - The prompt creation parameters
 * @returns A configured PromptTemplate instance
 * @throws LangChainValidationError if neither template nor fallback is provided or if parameters are invalid
 * @throws LangChainExecutionError if PromptTemplate instantiation fails
 */
export function getPrompt({ template, variables, fallback }: CreatePromptInput): PromptTemplate {
  // Validate that we have either a template or fallback
  if (!template && !fallback) {
    throw new LangChainValidationError(
      'getPrompt: Must provide either a template string or a fallback PromptTemplate',
      { hasTemplate: !!template, hasFallback: !!fallback, variables }
    )
  }

  // Validate variables array
  validateRequired(variables, 'variables', 'getPrompt')
  validateNonEmptyArray(variables, 'variables', 'getPrompt')

  // If using template, validate it and create PromptTemplate
  if (template) {
    validateNonEmptyString(template, 'template', 'getPrompt')
    
    try {
      return new PromptTemplate({
        template,
        inputVariables: variables,
        templateFormat: 'mustache',
      })
    } catch (error) {
      handleLangChainError(error, 'getPrompt: Failed to create PromptTemplate', {
        template: template.substring(0, 100) + (template.length > 100 ? '...' : ''),
        variables,
        templateFormat: 'mustache'
      })
    }
  }

  // Validate fallback if using it
  if (fallback) {
    validateRequired(fallback, 'fallback', 'getPrompt')
    
    if (!(fallback instanceof PromptTemplate)) {
      throw new LangChainValidationError(
        'getPrompt: Fallback must be a PromptTemplate instance',
        { fallbackType: typeof fallback, fallbackConstructor: (fallback as object).constructor?.name }
      )
    }
    
    return fallback
  }

  // This should never be reached, but TypeScript requires it
  throw new LangChainExecutionError(
    'getPrompt: Unexpected execution path - neither template nor fallback available',
    { template, fallback, variables }
  )
}
