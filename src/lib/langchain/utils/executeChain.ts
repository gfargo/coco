import { BaseOutputParser } from '@langchain/core/output_parsers'
import { PromptTemplate } from '@langchain/core/prompts'
import { RunnableRetry } from '@langchain/core/runnables'
import { handleLangChainError, isNetworkError } from '../errorHandler'
import { LangChainExecutionError, LangChainNetworkError } from '../errors'
import { validateRequired } from '../validation'
import { getLlm } from './getLlm'

type ExecuteChainInput<T> = {
  variables: Record<string, unknown>
  prompt: PromptTemplate
  llm: ReturnType<typeof getLlm>
  parser: BaseOutputParser<T> | RunnableRetry
  /** Optional provider name for better error messages */
  provider?: string
  /** Optional endpoint URL for better error messages */
  endpoint?: string
}

/**
 * Extracts provider and endpoint info from LLM instance if available
 */
function extractLlmInfo(llm: ReturnType<typeof getLlm>): { provider?: string; endpoint?: string } {
  const info: { provider?: string; endpoint?: string } = {}

  // Try to extract provider from class name
  const className = llm?.constructor?.name || ''
  if (className.includes('Ollama')) {
    info.provider = 'ollama'
    // Try to get baseUrl from ollama instance
    if ('lc_kwargs' in llm && typeof llm.lc_kwargs === 'object' && llm.lc_kwargs !== null) {
      const kwargs = llm.lc_kwargs as Record<string, unknown>
      if (typeof kwargs.baseUrl === 'string') {
        info.endpoint = kwargs.baseUrl
      }
    }
  } else if (className.includes('OpenAI')) {
    info.provider = 'openai'
  } else if (className.includes('Anthropic')) {
    info.provider = 'anthropic'
  }

  return info
}

/**
 * Executes a LangChain pipeline with the provided LLM, prompt, variables, and parser.
 * @param params - The execution parameters
 * @returns The parsed result from the LLM chain
 * @throws LangChainExecutionError if the chain execution fails or returns empty results
 * @throws LangChainNetworkError if a network/connection error occurs
 */
export const executeChain = async <T>({
  llm,
  prompt,
  variables,
  parser,
  provider,
  endpoint,
}: ExecuteChainInput<T>): Promise<T> => {
  validateRequired(llm, 'llm', 'executeChain')
  validateRequired(prompt, 'prompt', 'executeChain')
  validateRequired(variables, 'variables', 'executeChain')
  validateRequired(parser, 'parser', 'executeChain')

  // Validate that variables is an object
  if (typeof variables !== 'object' || Array.isArray(variables)) {
    throw new LangChainExecutionError('executeChain: Variables must be a non-array object', {
      variables,
      type: typeof variables,
      isArray: Array.isArray(variables),
    })
  }

  // Extract LLM info for error reporting if not provided
  const llmInfo = extractLlmInfo(llm)
  const effectiveProvider = provider || llmInfo.provider
  const effectiveEndpoint = endpoint || llmInfo.endpoint

  try {
    const chain = prompt.pipe(llm).pipe(parser)
    const result = await chain.invoke(variables)

    if (result === null || result === undefined) {
      throw new LangChainExecutionError(
        'executeChain: Chain execution returned null or undefined result',
        { variables, promptInputVariables: prompt.inputVariables }
      )
    }

    return result
  } catch (error) {
    // Re-throw LangChain errors as-is
    if (error instanceof LangChainExecutionError || error instanceof LangChainNetworkError) {
      throw error
    }

    // Check for network errors and throw specific error type
    if (error instanceof Error && isNetworkError(error)) {
      throw new LangChainNetworkError(error.message, effectiveEndpoint, effectiveProvider, {
        originalError: error.name,
        originalMessage: error.message,
        stack: error.stack,
        promptInputVariables: prompt.inputVariables,
        variableKeys: Object.keys(variables),
        parserType: parser.constructor.name,
      })
    }

    // Wrap other errors with context
    handleLangChainError(error, 'executeChain: Chain execution failed', {
      promptInputVariables: prompt.inputVariables,
      variableKeys: Object.keys(variables),
      parserType: parser.constructor.name,
      provider: effectiveProvider,
      endpoint: effectiveEndpoint,
    })
  }
}
