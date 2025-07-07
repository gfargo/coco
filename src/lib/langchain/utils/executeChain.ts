import { BaseOutputParser } from '@langchain/core/output_parsers'
import { PromptTemplate } from '@langchain/core/prompts'
import { RunnableRetry } from '@langchain/core/runnables'
import { handleLangChainError } from '../errorHandler'
import { LangChainExecutionError } from '../errors'
import { validateRequired } from '../validation'
import { getLlm } from './getLlm'

type ExecuteChainInput<T> = {
  variables: Record<string, unknown>
  prompt: PromptTemplate
  llm: ReturnType<typeof getLlm>
  parser: BaseOutputParser<T> | RunnableRetry
}

/**
 * Executes a LangChain pipeline with the provided LLM, prompt, variables, and parser.
 * @param params - The execution parameters
 * @returns The parsed result from the LLM chain
 * @throws LangChainExecutionError if the chain execution fails or returns empty results
 */
export const executeChain = async <T>({ llm, prompt, variables, parser }: ExecuteChainInput<T>): Promise<T> => {
  validateRequired(llm, 'llm', 'executeChain')
  validateRequired(prompt, 'prompt', 'executeChain')
  validateRequired(variables, 'variables', 'executeChain')
  validateRequired(parser, 'parser', 'executeChain')

  // Validate that variables is an object
  if (typeof variables !== 'object' || Array.isArray(variables)) {
    throw new LangChainExecutionError(
      'executeChain: Variables must be a non-array object',
      { variables, type: typeof variables, isArray: Array.isArray(variables) }
    )
  }

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
    if (error instanceof LangChainExecutionError) {
      throw error
    }
    
    // Wrap other errors with context
    handleLangChainError(error, 'executeChain: Chain execution failed', {
      promptInputVariables: prompt.inputVariables,
      variableKeys: Object.keys(variables),
      parserType: parser.constructor.name
    })
  }
}
