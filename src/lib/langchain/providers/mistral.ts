import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { DEFAULT_MAX_OUTPUT_TOKENS } from './constants'
import type { CreateLlmArgs, ProviderDefinition } from './types'

async function createMistralLlm({ model, config, apiKey }: CreateLlmArgs): Promise<BaseChatModel> {
  const { ChatMistralAI } = await import('@langchain/mistralai')
  const mistralConfig: ConstructorParameters<typeof ChatMistralAI>[0] = {
    apiKey,
    model,
    temperature: config.service.temperature ?? 0.2,
    maxConcurrency: config.service.maxConcurrent,
    // Disable LangChain's built-in AsyncCaller retries (#1677).
    maxRetries: config.service.requestOptions?.maxRetries ?? 0,
    maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  }

  // Merge Mistral-specific fields forwarded from service config.
  if ('fields' in config.service && config.service.fields) {
    Object.assign(mistralConfig, config.service.fields)
  }

  return new ChatMistralAI(mistralConfig)
}

export const mistralProvider: ProviderDefinition = {
  id: 'mistral',
  label: 'Mistral',
  requiresAuth: true,
  createLlm: createMistralLlm,
  // Approximation vs. the gpt-4o tiktoken baseline, per the AI-core
  // token-counting audit — no synchronous local Mistral tokenizer available.
  tokenCorrectionFactor: 1.15,
}
