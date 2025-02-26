import { BaseOutputParser } from '@langchain/core/output_parsers'

import { PromptTemplate } from '@langchain/core/prompts'
import { getLlm } from './getLlm'

type ExecuteChainInput<T> = {
  variables: Record<string, unknown>
  prompt: PromptTemplate
  llm: ReturnType<typeof getLlm>
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error - This is a generic type 
  parser: BaseOutputParser<T>
}

export const executeChain = async <T>({ llm, prompt, variables, parser }: ExecuteChainInput<T>) => {
  if (!llm || !prompt || !variables) {
    throw new Error('The input parameters "llm", "prompt", and "variables" are all required.')
  }

  const chain = prompt.pipe(llm).pipe(parser)

  let res

  try {
    res = await chain.invoke(variables)
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`LLMChain call error: ${error.message}`)
    }
  }

  if (!res) {
    throw new Error('Empty response from LLMChain call')
  }

  return res
}
