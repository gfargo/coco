import { LLMChain, LLMChainInput } from 'langchain/chains'

type LLMInput = {
  variables: Record<string, unknown>
} & LLMChainInput

export const llm = async ({ llm, prompt, variables }: LLMInput) => {
  const chain = new LLMChain({ llm, prompt })
  const res = await chain.call(variables)

  if (res.error) throw new Error(res.error)

  return res.text.trim()
}
