import { ServiceModel } from '../config/types'
import { encoding_for_model } from 'tiktoken'

export type BPE_Tokenizer = Awaited<ReturnType<typeof getTikToken>>
export type TokenCounter = Awaited<ReturnType<typeof getTokenCounter>>

export const getTikToken = async (modelName: ServiceModel) => {
  return await encoding_for_model(modelName)
}

export const getTokenCount = (tokenizer: BPE_Tokenizer) => (text: string) => {
  // console.log('Running GetTokenCount', { tokenizer, length: text.length })
  const tokens = tokenizer.encode(text)
  // console.log('Tokens', { tokenCount: tokens.length })
  return tokens.length
}

export const getTokenCounter = async (modelName: ServiceModel) =>
  getTikToken(modelName).then(getTokenCount)
