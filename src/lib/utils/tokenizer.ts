import { encoding_for_model, get_encoding, TiktokenModel } from 'tiktoken'
import { findProviderDefinition } from '../langchain/providers/registry'

export type BPE_Tokenizer = Awaited<ReturnType<typeof getTikToken>>
export type TokenCounter = Awaited<ReturnType<typeof getTokenCounter>>

/**
 * `encoding_for_model` throws for any id outside tiktoken's compiled-in
 * model map — which includes Azure custom deployment names, OpenAI-compatible
 * baseURL models (OpenRouter/vLLM/LM Studio), and OpenAI model ids newer than
 * the pinned tiktoken release. Token counting only drives budget math, so an
 * approximate encoding is strictly better than crashing the whole command
 * (#1592). Newest-looking OpenAI ids (gpt-5.x, gpt-4o, oN reasoning models)
 * use o200k_base to match; everything else falls back to cl100k_base, the
 * encoding shared by gpt-4/gpt-3.5 and the closest general-purpose default.
 */
function fallbackEncodingForModel(modelName: string) {
  const looksLikeNewestOpenAiModel = /^(gpt-5|gpt-4o|o[1-9])/.test(modelName)
  return get_encoding(looksLikeNewestOpenAiModel ? 'o200k_base' : 'cl100k_base')
}

/**
 * Retrieves a TikToken for the specified model.
 *
 * @param {TiktokenModel} modelName - The name of the TiktokenModel.
 * @returns A Promise that resolves to the TikToken.
 */
export const getTikToken = async (modelName: TiktokenModel) => {
  try {
    return encoding_for_model(modelName)
  } catch {
    return fallbackEncodingForModel(modelName)
  }
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

/**
 * Resolves a token counter appropriate for the given provider/model pair.
 *
 * OpenAI and Azure use the real tiktoken encoding for their model directly.
 * Every other provider (Anthropic, Gemini, Mistral, Bedrock, Ollama) has no
 * synchronous local tokenizer, so this falls back to the gpt-4o tiktoken
 * count and applies that provider's `tokenCorrectionFactor` — a documented
 * approximation, not a precise per-model tokenizer. A real fix would call
 * each provider's own counting endpoint (e.g. Anthropic's `count_tokens`,
 * Gemini's `countTokens`), which would require making token counting async
 * across all budget-math call sites — out of scope here.
 *
 * @param {string} provider - The LLM provider id (e.g. 'openai', 'anthropic').
 * @param {string} model - The model id in use.
 * @returns A promise that resolves to a function that calculates the number of tokens in a given text.
 */
export const getTokenCounterForProvider = async (
  provider: string,
  model: string
): Promise<TokenCounter> => {
  const isTiktokenNative = provider === 'openai' || provider === 'azure'
  const baseCounter = await getTokenCounter(
    isTiktokenNative ? (model as TiktokenModel) : 'gpt-4o'
  )

  if (isTiktokenNative) return baseCounter

  const definition = findProviderDefinition(provider)
  const factor =
    typeof definition?.tokenCorrectionFactor === 'function'
      ? definition.tokenCorrectionFactor(model)
      : definition?.tokenCorrectionFactor ?? 1

  return factor === 1 ? baseCounter : (text: string) => Math.ceil(baseCounter(text) * factor)
}
