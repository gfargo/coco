import { PromptTemplate } from '@langchain/core/prompts'
import { getLlm } from "./getLlm";

type ExecuteChainInput = {
  variables: Record<string, unknown>,
  prompt: PromptTemplate,
  llm: ReturnType<typeof getLlm>
}

export const executeChain = async ({ llm, prompt, variables }: ExecuteChainInput) => {
  if (!llm || !prompt || !variables) {
    throw new Error('The input parameters "llm", "prompt", and "variables" are all required.')
  }

  const chain = prompt.pipe(llm)

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
  
  return res.trim()
}
