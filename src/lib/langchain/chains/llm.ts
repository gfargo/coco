import { LLMChain, LLMChainInput } from 'langchain/chains'

type LLMInput = {
  variables: Record<string, unknown>
} & LLMChainInput

export const llm = async ({ llm, prompt, variables }: LLMInput) => {
  if (!llm || !prompt || !variables) {
    throw new Error('The input parameters "llm", "prompt", and "variables" are all required.')
  }

  const chain = new LLMChain({ llm, prompt })

  let res

  try {
    res = await chain.call(variables)
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`LLMChain call error: ${error.message}`)
    }
  }

  if (!res) {
    throw new Error('Empty response from LLMChain call')
  }

  if (res.error) {
    throw new Error(`LLMChain response error: ${res.error}`)
  }

  return res.text.trim()
}
