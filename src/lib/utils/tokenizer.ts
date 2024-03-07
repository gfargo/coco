import { TiktokenModel } from 'langchain/dist/types/openai-types'
import { encoding_for_model } from 'tiktoken'

export type BPE_Tokenizer = Awaited<ReturnType<typeof getTikToken>>
export type TokenCounter = Awaited<ReturnType<typeof getTokenCounter>>

export const getTikToken = async (modelName: TiktokenModel) => {
  return await encoding_for_model(modelName)
}
export const getTokenCounter = async (modelName: TiktokenModel) => {
  return getTikToken(modelName).then((tokenizer: BPE_Tokenizer) => (text: string) => {
    // console.log('Running GetTokenCount', { tokenizer, length: text.length })
    const tokens = tokenizer.encode(text)
    // console.log('Tokens', { tokenCount: tokens.length })
    return tokens.length
  })
}
