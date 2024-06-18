import { encoding_for_model, TiktokenModel } from 'tiktoken'

export type BPE_Tokenizer = Awaited<ReturnType<typeof getTikToken>>
export type TokenCounter = Awaited<ReturnType<typeof getTokenCounter>>

/**
 * Retrieves a TikToken for the specified model.
 *
 * @param {TiktokenModel} modelName - The name of the TiktokenModel.
 * @returns A Promise that resolves to the TikToken.
 */
export const getTikToken = async (modelName: TiktokenModel) => {
  return await encoding_for_model(modelName)
}
/**
 * Retrieves the token counter for a given model name.
 *
 * @param {TikTokenModel} modelName - The name of the Tiktoken model.
 * @returns A promise that resolves to a function that calculates the number of tokens in a given text.
 */
export const getTokenCounter = async (modelName: TiktokenModel) => {
  return getTikToken(modelName).then((tokenizer: BPE_Tokenizer) => (text: string) => {
    const tokens = tokenizer.encode(text)
    return tokens.length
  })
}
